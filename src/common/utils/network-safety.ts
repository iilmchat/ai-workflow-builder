/**
 * Сетевая безопасность: единая SSRF-защита исходящих HTTP-запросов.
 *
 * Модуль появился в v0.10.2 (hardening): проверка «адрес публичный?» была
 * только у инструмента агента `http_request` (KI-409), а узел `http` ходил в
 * сеть без неё (KI-478), редиректы не проверялись ни там, ни там (KI-434).
 * Теперь оба потребителя используют один код:
 *
 * - {@link isPrivateIp} — предикат «адрес из приватного/локального диапазона»;
 * - {@link isBlockedIpAddress} — более строгий SSRF-денлист: кроме приватных
 *   блокируются служебные, multicast и документационные диапазоны;
 * - {@link assertPublicHttpUrlAsync} — проверка URL до сетевого вызова
 *   (имя хоста → DNS-резолв `all: true` → проверка каждого адреса);
 * - {@link fetchWithSsrfGuardAsync} — `fetch` с `redirect: 'manual'` и
 *   повторной проверкой каждого `Location`: ровно то, чего не хватало для
 *   KI-434/478.
 *
 * **Остаточный риск DNS rebinding (KI-435).** Имя резолвится в проверке, а
 * `fetch` резолвит его повторно; при TTL=0 злоумышленник может отдать публичный
 * адрес на первом запросе и приватный на втором. Закрыть это без pinning IP на
 * уровне HTTP-клиента (`undici`/`lookup`) нельзя — риск задокументирован и
 * остаётся открытым. Ручной обход редиректов его не устраняет, но убирает
 * самый дешёвый вектор (KI-434): публичный хост с `302 Location:
 * http://169.254.169.254/`.
 *
 * **Env `ALLOW_PRIVATE_IPS`.** Для локальной разработки и тестов (LM Studio,
 * внутренние сервисы) защиту можно осознанно выключить: `true` — проверки
 * пропускаются. Дефолт `false` (fail closed). Флаг читает вызывающий код через
 * `ConfigService` (RULES 4.6) и передаёт сюда параметром — модуль не читает
 * `process.env` сам.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Резолвер DNS для SSRF-проверки.
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
 * Максимум переходов по редиректам в {@link fetchWithSsrfGuardAsync}.
 *
 * Каждый хоп — отдельный сетевой вызов и отдельная SSRF-проверка; лимит
 * защищает от бесконечной цепочки (`A → B → A → …`).
 */
export const HTTP_MAX_REDIRECTS = 5;

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
 * HTTP-коды, которые клиент обязан обработать как редирект.
 *
 * `300`/`304` сюда не входят: `fetch` по спецификации их не переходит, и
 * трактовать их как редирект значило бы поменять поведение.
 */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/**
 * Ошибка: запрос к локальному/внутреннему адресу запрещён (KI-409/434/478).
 *
 * Наследуется от `Error`, а не Nest-исключения: проверка живёт на границе
 * сетевого вызова, и вызывающий код сам решает, как показать сбой (у агента —
 * tool-шаг с текстом ошибки, у узла — `node_runs.error`). Текст намеренно не
 * содержит тела ответа и не делает запрос вовсе.
 */
export class SsrfBlockedException extends Error {
  /** Хост из URL, к которому пытались обратиться. */
  readonly hostname: string;
  /** Приватный IP после резолва; `null`, если запрещено само имя. */
  readonly address: string | null;
  /** Исходный URL, с которого пришёл редирект; `null` — запрос прямой. */
  readonly redirectFrom: string | null;

  /**
   * @param hostname - имя хоста из URL
   * @param address - приватный адрес после DNS-резолва (если был)
   * @param redirectFrom - URL, с которого пришёл небезопасный редирект
   */
  constructor(
    hostname: string,
    address: string | null = null,
    redirectFrom: string | null = null,
  ) {
    const prefix =
      redirectFrom === null
        ? 'SSRF: запрос'
        : `SSRF: редирект с '${redirectFrom}'`;

    super(
      address === null
        ? `${prefix} к '${hostname}' запрещён — локальное или внутреннее имя`
        : `${prefix} к '${hostname}' запрещён — резолвится в приватный адрес ${address}`,
    );
    this.name = 'SsrfBlockedException';
    this.hostname = hostname;
    this.address = address;
    this.redirectFrom = redirectFrom;
  }
}

/**
 * Ошибка: цепочка редиректов превысила {@link HTTP_MAX_REDIRECTS}.
 *
 * Отдельный класс, а не `SsrfBlockedException`: это не попытка обойти guard, а
 * сломанная/зацикленная конфигурация удалённого хоста.
 */
export class TooManyRedirectsException extends Error {
  /** Сколько переходов разрешено. */
  readonly maxRedirects: number;

  /**
   * @param maxRedirects - предельное число переходов
   */
  constructor(maxRedirects: number) {
    super(`Превышен лимит редиректов (${maxRedirects})`);
    this.name = 'TooManyRedirectsException';
    this.maxRedirects = maxRedirects;
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
 * Проверяет, что IPv4-адрес из приватного/локального диапазона.
 *
 * Диапазоны — ровно те, что перечислены в ТЗ v0.10.2: `10/8`, `172.16/12`,
 * `192.168/16`, `127/8` (loopback), `169.254/16` (link-local, включая
 * metadata-адрес `169.254.169.254`).
 *
 * @param octets - четыре октета адреса
 * @returns `true`, если адрес приватный
 */
function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;

  if (a === undefined || b === undefined) {
    return true;
  }

  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Проверяет, что IPv4-адрес — служебный/немаршрутизируемый (сверх приватных).
 *
 * SSRF-денлист строже определения «private»: `0.0.0.0/8`, CGNAT `100.64/10`,
 * `192.0.0/24`, бенчмарк `198.18/15`, multicast `224/4` и зарезервированный
 * `240/4` тоже не должны быть целью запроса.
 *
 * @param octets - четыре октета адреса
 * @returns `true`, если адрес нельзя запрашивать
 */
function isUnsafeIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;

  if (a === undefined || b === undefined || c === undefined) {
    return true;
  }

  return (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Возвращает встроенный IPv4 из IPv6-адреса, если он там есть.
 *
 * Разбираются две формы: IPv4-mapped (`::ffff:a.b.c.d`) и устаревшая
 * IPv4-compatible (`::a.b.c.d`). Иначе `null`.
 *
 * @param bytes - 16 байт адреса
 * @returns четыре октета встроенного IPv4 либо `null`
 */
function embeddedIpv4(bytes: readonly number[]): readonly number[] | null {
  const zeroPrefix = (length: number): boolean =>
    bytes.slice(0, length).every((byte) => byte === 0);

  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return bytes.slice(12);
  }

  if (zeroPrefix(12) && !bytes.slice(12).every((byte) => byte === 0)) {
    return bytes.slice(12);
  }

  return null;
}

/**
 * Проверяет, что IPv6-адрес из приватного/локального диапазона.
 *
 * Диапазоны из ТЗ: `::1` (loopback) и `fc00::/7` (unique local). Встроенный
 * IPv4 проверяется по IPv4-правилам, иначе `::ffff:127.0.0.1` обходил бы guard.
 *
 * @param bytes - 16 байт адреса
 * @returns `true`, если адрес приватный
 */
function isPrivateIpv6(bytes: readonly number[]): boolean {
  if (bytes.length !== 16) {
    return true;
  }

  const zeroPrefix = (length: number): boolean =>
    bytes.slice(0, length).every((byte) => byte === 0);

  // `::1` — loopback.
  if (zeroPrefix(15) && bytes[15] === 1) {
    return true;
  }

  const embedded = embeddedIpv4(bytes);

  if (embedded !== null) {
    return isPrivateIpv4(embedded);
  }

  // `fc00::/7` — unique local (аналог приватных IPv4).
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) {
    return true;
  }

  return false;
}

/**
 * Проверяет, что IPv6-адрес — служебный/немаршрутизируемый (сверх приватных).
 *
 * Блокируются: `::` (unspecified), `fe80::/10` (link-local), multicast
 * `ff00::/8`, `2001:db8::/32` (документация) и встроенный IPv4 из служебных
 * диапазонов.
 *
 * @param bytes - 16 байт адреса
 * @returns `true`, если адрес нельзя запрашивать
 */
function isUnsafeIpv6(bytes: readonly number[]): boolean {
  if (bytes.length !== 16) {
    return true;
  }

  if (bytes.every((byte) => byte === 0)) {
    return true;
  }

  const embedded = embeddedIpv4(bytes);

  if (embedded !== null) {
    return isPrivateIpv4(embedded) || isUnsafeIpv4(embedded);
  }

  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;

  // `fe80::/10` — link-local.
  if (first === 0xfe && (second & 0xc0) === 0x80) {
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
 * Проверяет, что IP-адрес (любого семейства) приватный или локальный.
 *
 * Публичная функция с контрактом из ТЗ v0.10.2: `10.0.0.0/8`, `172.16.0.0/12`,
 * `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`.
 * Встроенный IPv4 (`::ffff:a.b.c.d`) проверяется по IPv4-правилам.
 *
 * Для проверки «можно ли делать запрос» используйте более строгий
 * {@link isBlockedIpAddress}: он дополнительно закрывает служебные диапазоны.
 *
 * @param address - IPv4/IPv6-литерал
 * @returns `true` для приватного адреса; `false` для публичного **и** для
 *   строки, которая не является IP
 */
export function isPrivateIp(address: string): boolean {
  // IPv6-литералы могут прийти в верхнем регистре (`FC00::1`): `isIP` принимает
  // оба варианта, а разбор групп — только нижний.
  const normalized = address.toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const octets = parseIpv4(normalized);

    return octets === null || isPrivateIpv4(octets);
  }

  if (family === 6) {
    const bytes = parseIpv6(normalized);

    return bytes === null || isPrivateIpv6(bytes);
  }

  return false;
}

/**
 * Проверяет, что IP-адрес нельзя использовать как цель исходящего запроса.
 *
 * Более строгий предикат, чем {@link isPrivateIp}: SSRF-денлист включает ещё
 * служебные/multicast/документационные диапазоны (историческое поведение
 * `isBlockedIpAddress` из KI-409 — регрессию допускать нельзя).
 *
 * @param address - IPv4/IPv6-литерал
 * @returns `true`, если адрес нельзя запрашивать; `false` для публичного
 *   адреса **и** для строки, которая не является IP
 */
export function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const octets = parseIpv4(normalized);

    return (
      octets === null || isPrivateIpv4(octets) || isUnsafeIpv4(octets)
    );
  }

  if (family === 6) {
    const bytes = parseIpv6(normalized);

    return (
      bytes === null || isPrivateIpv6(bytes) || isUnsafeIpv6(bytes)
    );
  }

  return false;
}

/**
 * Разбирает URL и проверяет схему (`http`/`https`).
 *
 * @param rawUrl - строка URL
 * @returns разобранный URL
 * @throws Error если строка не является абсолютным http(s)-адресом
 */
function parseHttpUrl(rawUrl: string): URL {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      'Некорректный URL: ожидался абсолютный http(s)-адрес',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL должен использовать протокол http или https');
  }

  return url;
}

/**
 * Проверяет URL на SSRF (KI-409/434/478).
 *
 * **Как.** Сначала блокируются заведомо локальные имена (`localhost`,
 * metadata-алиасы), затем IP-литерал проверяется напрямую, а для домена
 * выполняется DNS-резолв и проверяется **каждый** полученный адрес.
 *
 * **Сбой DNS не блокирует запрос.** Если имя не резолвится, соединения с
 * приватным адресом всё равно не будет, а `fetch` вернёт понятную сетевую
 * ошибку. Блокировать здесь означало бы ломать валидные запросы при
 * временном сбое резолвера. Остаточный риск DNS-rebinding (первый резолв —
 * публичный, второй в `fetch` — приватный) задокументирован в шапке модуля:
 * закрыть его без pinning IP на уровне HTTP-клиента нельзя (KI-435).
 *
 * **`allowPrivateIps`.** Осознанное выключение защиты для локальной
 * разработки/тестов (`ALLOW_PRIVATE_IPS=true`); проверка схемы при этом
 * остаётся.
 *
 * @param rawUrl - абсолютный URL из аргументов инструмента/узла
 * @param lookupAsync - резолвер DNS (по умолчанию системный `dns.lookup`)
 * @param options - `allowPrivateIps`: пропустить проверку приватных адресов
 * @returns промис без значения
 * @throws SsrfBlockedException если имя/адрес локальный или приватный
 * @throws Error если URL невалиден или схема не http(s)
 */
export async function assertPublicHttpUrlAsync(
  rawUrl: string,
  lookupAsync: DnsLookupAsync = defaultDnsLookupAsync,
  options: { readonly allowPrivateIps?: boolean } = {},
): Promise<void> {
  const url = parseHttpUrl(rawUrl);

  if (options.allowPrivateIps === true) {
    return;
  }

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

/**
 * Освобождает тело ответа-редиректа, чтобы не держать соединение.
 *
 * Тело редиректа не нужно вызывающему коду; если его не закрыть, `undici`
 * держит сокет до сборки мусора.
 *
 * @param response - ответ с 3xx
 * @returns промис без значения (ошибки закрытия проглатываются)
 */
async function discardResponseBodyAsync(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Поток мог быть уже закрыт/прочитан — это не повод ронять запрос.
  }
}

/**
 * Собирает `RequestInit` для следующего хопа редиректа.
 *
 * Повторяет поведение браузера/`fetch`: `303` всегда превращается в `GET`,
 * `301`/`302` с `POST` — тоже (у остальных методов тело сохраняется);
 * `307`/`308` метод и тело сохраняют.
 *
 * @param init - текущие опции запроса
 * @param status - код редиректа
 * @returns опции для следующего запроса
 */
function buildRedirectInit(init: RequestInit, status: number): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const becomesGet =
    status === 303 ||
    ((status === 301 || status === 302) && method === 'POST');

  if (!becomesGet) {
    return init;
  }

  return { ...init, method: 'GET', body: undefined };
}

/**
 * Разрешает `Location` редиректа относительно текущего URL и проверяет схему.
 *
 * @param location - заголовок `Location`
 * @param currentUrl - URL, который вернул редирект
 * @returns абсолютный URL следующего хопа
 * @throws Error если `Location` не является абсолютным http(s)-адресом
 */
function resolveRedirectUrl(location: string, currentUrl: string): string {
  let url: URL;

  try {
    url = new URL(location, currentUrl);
  } catch {
    throw new Error('Некорректный Location в ответе-редиректе');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Location редиректа должен использовать http или https');
  }

  return url.href;
}

/** Опции SSRF-защиты запроса. */
export interface SsrfGuardOptions {
  /** Резолвер DNS (по умолчанию системный `dns.lookup`). */
  readonly lookupAsync?: DnsLookupAsync;
  /**
   * Пропускать приватные/локальные адреса (env `ALLOW_PRIVATE_IPS=true`).
   *
   * Дефолт `false`: защита включена, пока её не выключили осознанно.
   */
  readonly allowPrivateIps?: boolean;
}

/** Опции {@link fetchWithSsrfGuardAsync}. */
export interface SafeFetchOptions extends SsrfGuardOptions {
  /** Максимум переходов по редиректам (по умолчанию {@link HTTP_MAX_REDIRECTS}). */
  readonly maxRedirects?: number;
}

/**
 * Выполняет HTTP-запрос с SSRF-защитой и ручной обработкой редиректов.
 *
 * **Зачем.** `fetch` по умолчанию идёт по 3xx сам, поэтому проверка исходного
 * URL ничего не гарантирует: публичный хост отвечает
 * `302 Location: http://169.254.169.254/…`, и запрос уходит во внутреннюю
 * сеть (KI-434). Здесь `redirect: 'manual'`, каждый `Location` разрешается
 * относительно текущего URL и **проверяется заново** — как обычный хост
 * (KI-478).
 *
 * **Редирект без `Location`** возвращается вызывающему коду как есть (это
 * валидный, хотя и необычный ответ). **Лимит хопов** —
 * {@link HTTP_MAX_REDIRECTS} либо `maxRedirects` из опций.
 *
 * @param fetchAsync - HTTP-клиент (глобальный `fetch` либо мок в тестах)
 * @param rawUrl - абсолютный http(s)-URL
 * @param init - опции запроса (метод, заголовки, тело, `signal`)
 * @param options - резолвер DNS, `allowPrivateIps`, лимит редиректов
 * @returns финальный ответ (не 3xx, если цепочка завершилась)
 * @throws SsrfBlockedException если любой хоп ведёт на приватный адрес
 * @throws TooManyRedirectsException если цепочка длиннее лимита
 * @throws Error если URL/Location невалиден или схема не http(s)
 */
export async function fetchWithSsrfGuardAsync(
  fetchAsync: typeof fetch,
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? HTTP_MAX_REDIRECTS;
  const lookupAsync = options.lookupAsync ?? defaultDnsLookupAsync;
  const allowPrivateIps = options.allowPrivateIps === true;
  // RULES 4.19: таймаут (`signal`) приходит от вызывающего и действует на всю
  // цепочку — отдельный таймер на каждый хоп не нужен.
  let currentInit: RequestInit = { ...init, redirect: 'manual' };
  let currentUrl = rawUrl;
  /** URL, с которого пришёл текущий хоп; `null` — исходный запрос. */
  let redirectFrom: string | null = null;

  for (let hop = 0; ; hop += 1) {
    try {
      await assertPublicHttpUrlAsync(currentUrl, lookupAsync, {
        allowPrivateIps,
      });
    } catch (error: unknown) {
      // Контекст «редирект с какого URL» важен в логе узла/агента: прямой
      // запрос и переход по чужому `Location` — разные диагнозы.
      if (error instanceof SsrfBlockedException && redirectFrom !== null) {
        throw new SsrfBlockedException(
          error.hostname,
          error.address,
          redirectFrom,
        );
      }

      throw error;
    }

    const response = await fetchAsync(currentUrl, currentInit);

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');

    // 3xx без Location — не цепочка: отдаём как есть (как и браузер).
    if (location === null || location.trim().length === 0) {
      return response;
    }

    await discardResponseBodyAsync(response);

    if (hop >= maxRedirects) {
      throw new TooManyRedirectsException(maxRedirects);
    }

    redirectFrom = currentUrl;
    currentUrl = resolveRedirectUrl(location.trim(), currentUrl);
    currentInit = buildRedirectInit(currentInit, response.status);
  }
}
