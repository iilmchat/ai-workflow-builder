/**
 * Реестр инструментов агента (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Семь базовых инструментов: `http_request`, `vector_query`, `vector_upsert`,
 * `memory_read`, `memory_write`, `code_eval`, `llm_call`. Это тонкие обёртки
 * над уже существующими сервисами (R7.4a `VectorStoreService`, R7.5
 * `QuickJsRunnerService`, `LlmService`), а не новая инфраструктура: агент
 * переиспользует те же SQL и ту же песочницу, что и обычные узлы.
 *
 * Зависимости приходят через {@link AgentToolContext}, поэтому реестр —
 * обычная константа без Nest-DI: юнит-тесты подставляют моки хранилища и
 * `fetch`, не поднимая ни модуль, ни приложение (RULES 4.13/4.14).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '../llm/llm-constants.js';
import {
  AGENT_TOOL_NAMES,
  type AgentTool,
  type AgentToolContext,
  type AgentToolName,
} from './agent.types.js';

/** Таймаут HTTP-инструмента, мс (RULES 4.19 — длительные вызовы с лимитом). */
export const AGENT_HTTP_TIMEOUT_MS = 15_000;

/**
 * Максимум символов тела HTTP-ответа в транскрипте агента.
 *
 * Ответ на мегабайт раздул бы промпт следующей итерации и стоимость вызова;
 * остаток отбрасывается с явной пометкой, чтобы модель знала об обрезке.
 */
export const AGENT_HTTP_BODY_MAX_CHARS = 4_000;

/** Максимум `topK` инструмента `vector_query` (как у узла `vector_query`). */
const AGENT_VECTOR_TOPK_LIMIT = 100;

/**
 * Резолвер DNS для SSRF-проверки (KI-409).
 *
 * Возвращает **все** адреса хоста: `dns.lookup` с `all: true` отдаёт IPv4 и
 * IPv6 записи, и проверять нужно каждую — клиент выберет любую из них.
 */
export type DnsLookupAsync = (hostname: string) => Promise<readonly string[]>;

/**
 * Резолвит хост через системный `dns.lookup` (продакшен-реализация).
 *
 * @param hostname - имя хоста из URL
 * @returns IP-адреса всех семейств
 * @throws Error при сбое DNS (`ENOTFOUND`, `EAI_AGAIN`) — валидатор решает,
 *   что с этим делать (см. {@link assertPublicHttpUrlAsync})
 */
export async function defaultDnsLookupAsync(
  hostname: string,
): Promise<readonly string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });

  return addresses.map((entry) => entry.address);
}

/**
 * Имена хостов, которые запрещены без резолва (KI-409).
 *
 * `localhost` и его поддомены (RFC 6761) — сам хост; `metadata.google.internal`
 * и `instance-data` — документированные алиасы metadata-сервисов облаков.
 * Список проверяется по нормализованному имени (lowercase, без точки в конце).
 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

/**
 * Ошибка: `http_request` запрошен к локальному/внутреннему адресу (KI-409).
 *
 * Наследуется от `Error`, а не Nest-исключения: инструмент живёт в цикле
 * агента, и `AgentService` превращает этот сбой в tool-шаг с текстом ошибки.
 * Текст намеренно не содержит тела ответа и не делает запрос вовсе.
 */
export class SsrfBlockedException extends Error {
  /** Хост из URL, к которому пытались обратиться. */
  readonly hostname: string;
  /** Приватный IP после резолва; `null`, если запрещено само имя. */
  readonly address: string | null;

  /**
   * @param hostname - имя хоста из URL
   * @param address - приватный адрес после DNS-резолва (если был)
   */
  constructor(hostname: string, address: string | null = null) {
    super(
      address === null
        ? `SSRF: запрос к '${hostname}' запрещён — локальное или внутреннее имя`
        : `SSRF: запрос к '${hostname}' запрещён — резолвится в приватный адрес ${address}`,
    );
    this.name = 'SsrfBlockedException';
    this.hostname = hostname;
    this.address = address;
  }
}

/**
 * Приводит имя хоста из URL к сравнимому виду.
 *
 * URL может отдать IPv6 в скобках (`[::1]`), а DNS/FQDN — с точкой в конце
 * (`localhost.`). Оба варианта должны попадать под запрет.
 *
 * @param hostname - `url.hostname`
 * @returns имя в нижнем регистре без скобок и завершающей точки
 */
function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  const withoutBrackets =
    lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  return withoutBrackets.endsWith('.')
    ? withoutBrackets.slice(0, -1)
    : withoutBrackets;
}

/**
 * Проверяет, что имя хоста — заведомо локальное (до DNS-резолва).
 *
 * @param hostname - нормализованное имя
 * @returns `true` для `localhost`, его поддоменов и известных metadata-алиасов
 */
function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Разбирает IPv4-адрес в октеты.
 *
 * @param address - строка, которую `isIP` уже признал IPv4
 * @returns четыре октета либо `null`, если формат неверный
 */
function parseIpv4(address: string): readonly number[] | null {
  const parts = address.split('.');

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );

  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? octets
    : null;
}

/**
 * Проверяет, что IPv4-адрес приватный/недоступный извне.
 *
 * Блокируются: `0.0.0.0/8` («this network»), `10/8`, `127/8` (loopback),
 * `169.254/16` (link-local, включая `169.254.169.254` — AWS/GCP metadata),
 * `172.16/12`, `192.168/16`, `100.64/10` (CGNAT), `192.0.0/24`,
 * `198.18/15` (бенчмарки), multicast `224/4` и зарезервированный `240/4`.
 *
 * @param octets - четыре октета адреса
 * @returns `true`, если адрес нельзя запрашивать
 */
function isBlockedIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;

  if (a === undefined || b === undefined || c === undefined) {
    return true;
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Разбирает группу IPv6 (в т. ч. встроенный IPv4 в последней группе) в байты.
 *
 * @param groups - группы через `:` (после разбора `::`)
 * @returns байты либо `null`, если группа невалидна
 */
function ipv6GroupsToBytes(groups: readonly string[]): number[] | null {
  const bytes: number[] = [];

  for (const group of groups) {
    if (group.includes('.')) {
      const octets = parseIpv4(group);

      if (octets === null) {
        return null;
      }

      bytes.push(...octets);

      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }

    const value = Number.parseInt(group, 16);

    bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  return bytes;
}

/**
 * Разбирает IPv6-адрес в 16 байт.
 *
 * Поддерживает сжатие `::`, встроенный IPv4 (`::ffff:127.0.0.1`) и zone id
 * (`fe80::1%eth0`) — зона отбрасывается: адрес всё равно link-local.
 *
 * @param address - строка, которую `isIP` уже признал IPv6
 * @returns 16 байт либо `null` при неверном формате
 */
function parseIpv6(address: string): readonly number[] | null {
  const withoutZone = address.split('%')[0] ?? '';
  const halves = withoutZone.split('::');

  if (halves.length > 2) {
    return null;
  }

  const splitGroups = (part: string): string[] =>
    part.length === 0 ? [] : part.split(':');
  const head = ipv6GroupsToBytes(splitGroups(halves[0] ?? ''));

  if (head === null) {
    return null;
  }

  if (halves.length === 1) {
    return head.length === 16 ? head : null;
  }

  const tail = ipv6GroupsToBytes(splitGroups(halves[1] ?? ''));

  if (tail === null) {
    return null;
  }

  const zeros = 16 - head.length - tail.length;

  return zeros < 0
    ? null
    : [...head, ...Array.from({ length: zeros }, () => 0), ...tail];
}

/**
 * Проверяет, что IPv6-адрес приватный/недоступный извне.
 *
 * Блокируются: `::` (unspecified), `::1` (loopback), `fc00::/7` (ULA),
 * `fe80::/10` (link-local), multicast `ff00::/8`, `2001:db8::/32`
 * (документация) и IPv4-mapped/IPv4-compatible адреса с приватным IPv4
 * внутри — иначе `[::ffff:127.0.0.1]` обходил бы проверку.
 *
 * @param bytes - 16 байт адреса
 * @returns `true`, если адрес нельзя запрашивать
 */
function isBlockedIpv6(bytes: readonly number[]): boolean {
  if (bytes.length !== 16) {
    return true;
  }

  const zeroPrefix = (length: number): boolean =>
    bytes.slice(0, length).every((byte) => byte === 0);

  if (bytes.every((byte) => byte === 0)) {
    return true;
  }

  // `::1` — loopback.
  if (zeroPrefix(15) && bytes[15] === 1) {
    return true;
  }

  // IPv4-mapped (`::ffff:a.b.c.d`) — проверяем вложенный IPv4.
  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIpv4(bytes.slice(12));
  }

  // IPv4-compatible (`::a.b.c.d`, устаревшая форма).
  if (zeroPrefix(12) && !bytes.slice(12).every((byte) => byte === 0)) {
    return isBlockedIpv4(bytes.slice(12));
  }

  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;

  // `fe80::/10` — link-local.
  if (first === 0xfe && (second & 0xc0) === 0x80) {
    return true;
  }

  // `fc00::/7` — unique local (аналог приватных IPv4).
  if ((first & 0xfe) === 0xfc) {
    return true;
  }

  // `ff00::/8` — multicast.
  if (first === 0xff) {
    return true;
  }

  // `2001:db8::/32` — документация (не маршрутизируется).
  return (
    first === 0x20 &&
    second === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  );
}

/**
 * Проверяет, что IP-адрес (любого семейства) приватный или служебный.
 *
 * @param address - IPv4/IPv6-литерал
 * @returns `true`, если адрес нельзя запрашивать; `false` для публичного
 *   адреса **и** для строки, которая не является IP
 */
export function isBlockedIpAddress(address: string): boolean {
  // IPv6-литералы могут прийти в верхнем регистре (`2001:DB8::1`): `isIP`
  // принимает оба варианта, а разбор групп — только нижний.
  const normalized = address.toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const octets = parseIpv4(normalized);

    return octets === null || isBlockedIpv4(octets);
  }

  if (family === 6) {
    const bytes = parseIpv6(normalized);

    return bytes === null || isBlockedIpv6(bytes);
  }

  return false;
}

/**
 * Проверяет URL инструмента `http_request` на SSRF (KI-409).
 *
 * **Зачем.** `url` приходит от модели — это недоверенный ввод. Без проверки
 * агент по промпту пользователя мог бы дёрнуть `http://127.0.0.1:3000`,
 * внутренний сервис в Docker-сети или `http://169.254.169.254` (metadata
 * облака с токенами инстанса).
 *
 * **Как.** Сначала блокируются заведомо локальные имена (`localhost`,
 * metadata-алиасы), затем IP-литерал проверяется напрямую, а для домена
 * выполняется DNS-резолв и проверяется **каждый** полученный адрес.
 *
 * **Сбой DNS не блокирует запрос.** Если имя не резолвится, соединения с
 * приватным адресом всё равно не будет, а `fetch` вернёт понятную сетевую
 * ошибку. Блокировать здесь означало бы ломать валидные запросы при
 * временном сбое резолвера. Остаточный риск DNS-rebinding (первый резолв —
 * публичный, второй в `fetch` — приватный) задокументирован в отчёте:
 * закрыть его без pinning IP на уровне HTTP-клиента нельзя.
 *
 * @param rawUrl - абсолютный URL из аргументов инструмента
 * @param lookupAsync - резолвер DNS (по умолчанию системный `dns.lookup`)
 * @throws SsrfBlockedException если имя/адрес локальный или приватный
 * @throws TypeError если URL невалиден (вызывается после Zod-валидации)
 */
export async function assertPublicHttpUrlAsync(
  rawUrl: string,
  lookupAsync: DnsLookupAsync = defaultDnsLookupAsync,
): Promise<void> {
  const url = new URL(rawUrl);
  const hostname = normalizeHostname(url.hostname);

  if (hostname.length === 0 || isBlockedHostname(hostname)) {
    throw new SsrfBlockedException(hostname);
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedIpAddress(hostname)) {
      throw new SsrfBlockedException(hostname, hostname);
    }

    return;
  }

  let addresses: readonly string[];

  try {
    addresses = await lookupAsync(hostname);
  } catch {
    // См. JSDoc: нерезолвящееся имя не даёт соединения, fetch сам сообщит
    // об ошибке; здесь важно не превратить сетевой сбой DNS в отказ узла.
    return;
  }

  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new SsrfBlockedException(hostname, address);
    }
  }
}

/** Схема аргументов `http_request`. */
const HttpRequestInputSchema = z.object({
  // Метод ограничен теми же четырьмя, что у узла `http` (R6.5.1/KI-105):
  // PATCH/HEAD не поддержаны исполнителем узла, не расширяем их и здесь.
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  url: z
    .url('url должен быть абсолютным http(s)-адресом')
    // `z.url()` принимает любой абсолютный URL, включая `file:`/`ftp:`:
    // fetch их всё равно отвергнет, но SSRF-проверка (KI-409) имеет смысл
    // только для http(s) — сужаем протокол на границе валидации.
    .refine(
      (value) => /^https?:\/\//i.test(value),
      'url должен использовать протокол http или https',
    ),
  // Тело принимается любым JSON-значением: модель может прислать объект,
  // а не готовую строку. Строка уходит как есть, остальное — JSON.stringify.
  body: z.unknown().optional(),
});

/** Схема аргументов `vector_query`. */
const VectorQueryToolInputSchema = z.object({
  collection: z.string().trim().min(1, 'collection обязателен'),
  query: z.string().trim().min(1, 'query обязателен'),
  topK: z.number().int().min(1).max(AGENT_VECTOR_TOPK_LIMIT).default(5),
});

/** Схема аргументов `vector_upsert`. */
const VectorUpsertToolInputSchema = z.object({
  collection: z.string().trim().min(1, 'collection обязателен'),
  content: z.string().trim().min(1, 'content обязателен'),
});

/** Схема аргументов `memory_read`. */
const MemoryReadToolInputSchema = z.object({
  key: z.string().trim().min(1, 'key обязателен'),
});

/** Схема аргументов `memory_write`. */
const MemoryWriteToolInputSchema = z.object({
  key: z.string().trim().min(1, 'key обязателен'),
  value: z.unknown(),
});

/** Схема аргументов `code_eval`. */
const CodeEvalToolInputSchema = z.object({
  expression: z.string().min(1, 'expression обязателен'),
  input: z.unknown().optional(),
});

/** Схема аргументов `llm_call`. */
const LlmCallToolInputSchema = z.object({
  // Модель необязательна: без неё инструмент вызывает ту же модель, что ведёт
  // цикл агента (частый случай «подумать ещё раз»), не заставляя модель
  // угадывать собственный id.
  model: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1, 'prompt обязателен'),
});

/**
 * Получает эмбеддинг и проверяет его размерность.
 *
 * Колонка `workflow_vectors.embedding` — `vector(1536)`: несовместимую модель
 * (`3-large`, 3072) PostgreSQL отвергнет на INSERT. Проверка до записи даёт
 * понятный текст ошибки и не оставляет «грязных» строк.
 *
 * @param context - контекст инструмента (содержит `embedAsync`)
 * @param text - текст для векторизации
 * @returns вектор длины {@link DEFAULT_EMBEDDING_DIMENSIONS}
 * @throws Error если провайдер вернул неверную размерность
 */
async function embedOneAsync(
  context: AgentToolContext,
  text: string,
): Promise<number[]> {
  const vectors = await context.embedAsync([text], DEFAULT_EMBEDDING_MODEL);
  const vector = vectors[0];

  if (vectors.length !== 1 || vector === undefined) {
    throw new Error(
      `Инструмент vector_*: провайдер вернул ${vectors.length} векторов на 1 текст`,
    );
  }

  if (vector.length !== DEFAULT_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Инструмент vector_*: модель '${DEFAULT_EMBEDDING_MODEL}' вернула вектор ` +
        `размерности ${vector.length}, ожидается ${DEFAULT_EMBEDDING_DIMENSIONS}`,
    );
  }

  return vector;
}

/**
 * Обрезает тело HTTP-ответа до {@link AGENT_HTTP_BODY_MAX_CHARS}.
 *
 * @param body - полный текст ответа
 * @returns текст (с пометкой об обрезке, если она произошла)
 */
function truncateBody(body: string): string {
  return body.length <= AGENT_HTTP_BODY_MAX_CHARS
    ? body
    : `${body.slice(0, AGENT_HTTP_BODY_MAX_CHARS)}… (truncated)`;
}

/**
 * Реестр инструментов агента: имя → реализация.
 *
 * Ключи совпадают с {@link AGENT_TOOL_NAMES} — `Record` заставляет tsc найти
 * рассинхрон при добавлении инструмента (RULES 1.15: один инструмент = одна
 * запись в реестре).
 */
export const TOOL_REGISTRY: Readonly<Record<AgentToolName, AgentTool>> = {
  http_request: {
    name: 'http_request',
    description:
      'Perform an HTTP request (method, url, optional body) and return ' +
      'status, ok and response body (truncated to 4000 chars).',
    inputSchema: HttpRequestInputSchema,
    async executeAsync(input, context) {
      const parsed = HttpRequestInputSchema.parse(input);

      // KI-409: URL — недоверенный ввод модели. Проверяем фактический адрес
      // до сетевого вызова: иначе агент может дёрнуть внутренний сервис или
      // metadata облака, обойдя все остальные границы доверия.
      await assertPublicHttpUrlAsync(
        parsed.url,
        context.dnsLookupAsync ?? defaultDnsLookupAsync,
      );

      const hasBody = parsed.body !== undefined && parsed.method !== 'GET';
      const serializedBody =
        hasBody && typeof parsed.body !== 'string'
          ? JSON.stringify(parsed.body)
          : hasBody
            ? (parsed.body as string)
            : undefined;

      const response = await context.fetchAsync(parsed.url, {
        method: parsed.method,
        ...(serializedBody === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: serializedBody,
            }),
        // RULES 4.19: у внешнего вызова всегда есть таймаут.
        signal: AbortSignal.timeout(AGENT_HTTP_TIMEOUT_MS),
      });
      const body = truncateBody(await response.text());

      // Не-2xx — это данные, а не сбой инструмента: агент сам решит, повторять
      // запрос, менять URL или отвечать пользователю (DESIGN § 3.4).
      return { status: response.status, ok: response.ok, body };
    },
  },
  vector_query: {
    name: 'vector_query',
    description:
      'Search the workflow vector collection (collection, query, topK) and ' +
      'return the nearest matches with cosine score.',
    inputSchema: VectorQueryToolInputSchema,
    async executeAsync(input, context) {
      const parsed = VectorQueryToolInputSchema.parse(input);
      const embedding = await embedOneAsync(context, parsed.query);
      const matches = await context.store.queryVectorsAsync({
        workflowId: context.workflowId,
        collection: parsed.collection,
        embedding,
        topK: parsed.topK,
        // Порог не применяется: инструмент отдаёт topK ближайших, а решает о
        // релевантности агент. Иначе при пустой по смыслу коллекции он получил
        // бы пустой список и не смог бы отличить «нет данных» от «плохой порог».
        scoreThreshold: -1,
      });

      return matches;
    },
  },
  vector_upsert: {
    name: 'vector_upsert',
    description:
      'Embed text content and store it in the workflow vector collection ' +
      '(collection, content). Returns the new record id.',
    inputSchema: VectorUpsertToolInputSchema,
    async executeAsync(input, context) {
      const parsed = VectorUpsertToolInputSchema.parse(input);
      const embedding = await embedOneAsync(context, parsed.content);
      const { id } = await context.store.insertVectorAsync({
        workflowId: context.workflowId,
        collection: parsed.collection,
        embedding,
        content: { text: parsed.content },
        metadata: {},
      });

      return { id, collection: parsed.collection };
    },
  },
  memory_read: {
    name: 'memory_read',
    description:
      'Read a value from the workflow memory by key. Returns found and value.',
    inputSchema: MemoryReadToolInputSchema,
    async executeAsync(input, context) {
      const parsed = MemoryReadToolInputSchema.parse(input);
      const value = await context.store.readMemoryAsync(
        context.workflowId,
        parsed.key,
      );

      return value === undefined
        ? { found: false, value: null }
        : { found: true, value };
    },
  },
  memory_write: {
    name: 'memory_write',
    description:
      'Write a JSON value to the workflow memory by key (upsert). ' +
      'Returns key and saved=true.',
    inputSchema: MemoryWriteToolInputSchema,
    async executeAsync(input, context) {
      const parsed = MemoryWriteToolInputSchema.parse(input);

      await context.store.writeMemoryAsync(
        context.workflowId,
        parsed.key,
        parsed.value,
      );

      return { key: parsed.key, saved: true };
    },
  },
  code_eval: {
    name: 'code_eval',
    description:
      'Evaluate a JavaScript expression in the QuickJS-WASM sandbox ' +
      '(expression, optional input). Returns result or error.',
    inputSchema: CodeEvalToolInputSchema,
    async executeAsync(input, context) {
      const parsed = CodeEvalToolInputSchema.parse(input);

      // Песочница бросает SandboxUnavailableException, если режим выключен
      // администратором (SANDBOX_ENABLED=false). Ошибка не глушится: сервис
      // агента превращает её в tool-шаг с `error`, и цикл продолжается.
      return context.sandbox.evaluateSandboxedAsync(
        parsed.expression,
        parsed.input ?? null,
      );
    },
  },
  llm_call: {
    name: 'llm_call',
    description:
      'Call an LLM with a prompt (optional model). Returns the answer text. ' +
      'Without model, the agent model is used.',
    inputSchema: LlmCallToolInputSchema,
    async executeAsync(input, context) {
      const parsed = LlmCallToolInputSchema.parse(input);
      const model = parsed.model ?? context.model;
      const result = await context.llmGenerateAsync(parsed.prompt, model);

      return {
        model,
        text: result.text,
        usage: result.usage,
      };
    },
  },
};

/**
 * Проверяет, что строка — известное имя инструмента.
 *
 * @param value - имя из `data.tools` (jsonb, `unknown`)
 * @returns `true`, если имя есть в {@link AGENT_TOOL_NAMES}
 */
export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value);
}
