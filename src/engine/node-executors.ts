/**
 * Исполнители узлов: преобразование `data` (+ входы) → outputs.
 *
 * `llm` здесь нет — с R3 узел ходит во внешний провайдер, поэтому живёт
 * в `src/llm/llm-node-executor.service.ts` (DI + `LlmService`). Здесь остаются
 * преобразования (`text`, `condition`, `output`, `compare`), сетевой `http`
 * (R6.5.1, KI-105) и заглушка `image_generation` (R4). С R7.5 (KI-364)
 * `condition` в режиме `sandbox` — асинхронный: выражение исполняет
 * QuickJS-WASM через переданный исполнитель. С R7.4a (KI-128) здесь же живут
 * `vector_upsert`/`vector_query`/`memory_read`/`memory_write`: они принимают
 * {@link VectorMemoryContext} (хранилище + эмбеддинги), поэтому остаются
 * тестируемыми без Nest-DI и без PostgreSQL.
 *
 * Правило для `data`: она приходит из jsonb-графа как `unknown` и валидируется
 * Zod'ом **внутри исполнителя**, а не в `NodeDto` (там `data` — свободный
 * `Record<string, unknown>`). Так строгая схема конкретного типа узла не ломает
 * forward-compat: UI может добавлять свои поля (`selected`, `measured`, …),
 * не роняя запуск (RULES 1.17 / 4.15).
 *
 * Узел `sub_workflow` (R6.7, KI-200) — исключение по природе: он не
 * преобразует входы, а **загружает другой граф**. Его исполнитель живёт здесь
 * же, но возвращает описание подграфа, который выполняет
 * `ExecutionEngineService` (см. `executeSubWorkflowNode`).
 */
import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  AGENT_MAX_ITERATIONS_LIMIT,
  AGENT_MAX_TOKENS_PER_STEP_LIMIT,
  AGENT_TOOL_NAMES,
  type AgentNodeData,
  type AgentRunResult,
  type AgentStep,
} from '../agent/agent.types.js';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '../llm/llm-constants.js';
import type { SandboxEvaluation, SandboxOptions } from '../sandbox/quickjs-runner.service.js';
import type { EdgeDto, GraphDto, NodeDto } from './dto/index.js';
import { inferInputPortName } from './node-ports.js';

/**
 * Исполнитель узла типа `text`: отдаёт значение из `data.value` как есть.
 *
 * @param node - узел графа типа `text`
 * @returns выходной порт `text` (пустая строка, если значение не строка)
 */
export function executeTextNode(node: NodeDto): Record<string, unknown> {
  const value = typeof node.data.value === 'string' ? node.data.value : '';

  return { text: value };
}

/**
 * ЗАГЛУШКА исполнителя узла типа `image_generation`.
 *
 * Реальный вызов провайдера генерации изображений появится в R4.
 *
 * @param _node - узел графа типа `image_generation` (в заглушке не используется)
 * @returns выходной порт `url` со значением `null`
 */
export function executeImageGenNodeStub(_node: NodeDto): Record<string, unknown> {
  return { url: null };
}

/* ──────────────── Заглушки узлов v0.10 S0 (Foundation) ──────────────── */

/**
 * ЗАГЛУШКА исполнителя узла `web_search` (v0.10 S0).
 *
 * Сам поиск (Tavily) появится в срезе S2. До этого узел должен падать
 * **понятной** ошибкой исполнителя, а не неизвестным типом: граф с новым узлом
 * остаётся валидным, а `node_runs.error` называет конкретный тип.
 *
 * @param _node - узел графа типа `web_search` (в заглушке не используется)
 * @throws UnsupportedNodeTypeException всегда: исполнитель ещё не реализован
 */
export function executeWebSearchNodeStub(_node: NodeDto): never {
  throw new UnsupportedNodeTypeException(
    'web_search',
    'Узел web_search ещё не реализован (v0.10 S0)',
  );
}

/**
 * ЗАГЛУШКА исполнителя узла `document_gen` (v0.10 S0).
 *
 * Генерация DOCX/PDF появится в срезе S6.
 *
 * @param _node - узел графа типа `document_gen` (в заглушке не используется)
 * @throws UnsupportedNodeTypeException всегда: исполнитель ещё не реализован
 */
export function executeDocumentGenNodeStub(_node: NodeDto): never {
  throw new UnsupportedNodeTypeException(
    'document_gen',
    'Узел document_gen ещё не реализован (v0.10 S0)',
  );
}

/**
 * ЗАГЛУШКА исполнителя узла `read_file` (v0.10 S0).
 *
 * Безопасное чтение из workspace появится в срезе S8.
 *
 * @param _node - узел графа типа `read_file` (в заглушке не используется)
 * @throws UnsupportedNodeTypeException всегда: исполнитель ещё не реализован
 */
export function executeReadFileNodeStub(_node: NodeDto): never {
  throw new UnsupportedNodeTypeException(
    'read_file',
    'Узел read_file ещё не реализован (v0.10 S0)',
  );
}

/**
 * ЗАГЛУШКА исполнителя узла `write_file` (v0.10 S0).
 *
 * Безопасная запись в workspace появится в срезе S8.
 *
 * @param _node - узел графа типа `write_file` (в заглушке не используется)
 * @throws UnsupportedNodeTypeException всегда: исполнитель ещё не реализован
 */
export function executeWriteFileNodeStub(_node: NodeDto): never {
  throw new UnsupportedNodeTypeException(
    'write_file',
    'Узел write_file ещё не реализован (v0.10 S0)',
  );
}

/**
 * Типы узлов-аннотаций (комментарии/стикеры, KI-266).
 *
 * Не участвуют в потоке выполнения: не попадают в executionMap/levels,
 * не создают node_runs. Хранятся в графе (workflows.nodes jsonb),
 * переносятся между Save/Load — но игнорируются при Run.
 *
 * Новые типы R6.5.1 (`http`, `condition`, `output`, `compare`) сюда **не**
 * входят: это исполняемые узлы, а не заметки на холсте. `sub_workflow` (R6.7)
 * — тоже исполняемый узел: он загружает и выполняет другой граф, поэтому его
 * здесь нет.
 */
export const ANNOTATION_NODE_TYPES: ReadonlySet<string> = new Set(['comment']);

/**
 * Ошибка: тип узла не поддерживается executor'ом.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение живёт в
 * контексте worker'а, а не HTTP-запроса, и должно приводить к `run.status='failed'`.
 */
export class UnsupportedNodeTypeException extends Error {
  /**
   * @param nodeType - неизвестный тип узла из графа
   * @param message - готовый текст ошибки; по умолчанию — «тип не поддерживается»
   */
  constructor(nodeType: string, message?: string) {
    super(message ?? `Неподдерживаемый тип узла: ${nodeType}`);
    this.name = 'UnsupportedNodeTypeException';
  }
}

/**
 * Ошибка: данные узла не прошли валидацию Zod-схемой (R6.5.1).
 *
 * Наследуется от {@link UnsupportedNodeTypeException}, потому что для движка это
 * один класс отказа: узел с таким `data` выполнить нельзя. Подкласс даёт точный
 * текст ошибки и позволяет тестам отличать «неизвестный тип» от «известный тип
 * с битыми данными»; `catch` на родителя ловит оба случая.
 */
export class NodeDataValidationException extends UnsupportedNodeTypeException {
  /**
   * @param nodeType - тип узла, чьи `data` не прошли валидацию
   * @param reason - причина отказа (текст ошибки Zod)
   */
  constructor(nodeType: string, reason: string) {
    super(nodeType, `Некорректные данные узла ${nodeType}: ${reason}`);
    this.name = 'NodeDataValidationException';
  }
}

/**
 * Разбирает `data` узла Zod-схемой и бросает единую ошибку при отказе.
 *
 * @param nodeType - тип узла (для текста ошибки)
 * @param schema - Zod-схема данных этого типа
 * @param data - сырые данные узла из jsonb
 * @returns разобранные (и нормализованные) данные
 * @throws NodeDataValidationException если данные не соответствуют схеме
 */
function parseNodeData<T>(
  nodeType: string,
  schema: z.ZodType<T>,
  data: unknown,
): T {
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join('.');

        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');

    throw new NodeDataValidationException(nodeType, reason);
  }

  return parsed.data;
}

/* ─────────────────────────────── Узел http ─────────────────────────────── */

/** Методы HTTP, поддержанные узлом `http` (KI-105). */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Данные узла `http`. */
export interface HttpNodeData {
  /** HTTP-метод запроса. */
  method: HttpMethod;
  /** Абсолютный URL (`http`/`https`); при отсутствии берётся из входа `prompt`. */
  url: string;
  /** Заголовки запроса (не логируются целиком — RULES 5.9). */
  headers?: Record<string, string>;
  /** Тело запроса (не логируется целиком — RULES 5.9). */
  body?: string;
  /** Таймаут запроса в мс (по умолчанию {@link HTTP_DEFAULT_TIMEOUT_MS}). */
  timeoutMs?: number;
  /**
   * Считать ли ответ 4xx/5xx ошибкой узла (KI-289).
   *
   * По умолчанию `false` — backward compat: узел завершается `completed` с
   * `{ status, body }`, а решение «это провал» принимает граф (например, узел
   * `condition`). При `true` ответ с кодом ≥ 400 переводит узел в `failed`.
   */
  failOnHttpError?: boolean;
}

/** Таймаут HTTP-запроса по умолчанию, мс (RULES 4.19). */
const HTTP_DEFAULT_TIMEOUT_MS = 30_000;
/** Верхняя граница таймаута запроса, мс (защита от «вечного» узла). */
const HTTP_MAX_TIMEOUT_MS = 120_000;
/** Таймаут HTTP-запроса не может быть меньше 1 мс. */
const HTTP_MIN_TIMEOUT_MS = 1;
/** Максимальный размер сохраняемого тела ответа — 1 МБ. */
const HTTP_MAX_BODY_BYTES = 1_000_000;

/**
 * Zod-схема данных узла `http`.
 *
 * `url` необязателен: узел умеет брать адрес из входа (`inputs.prompt`), поэтому
 * требование «url есть» проверяется уже в исполнителе — с учётом входов.
 */
const HttpNodeDataSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  url: z.string().trim().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(HTTP_MAX_TIMEOUT_MS, `таймаут не может превышать ${HTTP_MAX_TIMEOUT_MS} мс`)
    .optional(),
  // KI-289: необязательное поле — старые графы (без него) сохраняют прежнее
  // поведение «4xx/5xx — не ошибка узла».
  failOnHttpError: z.boolean().optional(),
});

/**
 * Ищет исходную причину ошибки `fetch`.
 *
 * И `AbortSignal.timeout()`, и отмена через `AbortController` в undici
 * проявляются по-разному: иногда это `DOMException` с `name='AbortError'` или
 * `'TimeoutError'`, иногда — `TypeError`, у которого настоящая причина лежит
 * в `cause`. Смотрим оба уровня, чтобы не потерять факт отмены.
 *
 * @param error - значение из `catch`
 * @returns объект-подобная ошибка или `null`
 */
function asErrorLike(error: unknown): { name?: unknown; message?: unknown } | null {
  return typeof error === 'object' && error !== null
    ? (error as { name?: unknown; message?: unknown })
    : null;
}

/**
 * Распознаёт ошибку отмены/таймаута запроса.
 *
 * @param error - значение из `catch` вокруг `fetch`
 * @returns `true`, если запрос был прерван (сигналом или таймаутом)
 */
function isAbortLikeError(error: unknown): boolean {
  const direct = asErrorLike(error);

  if (direct?.name === 'AbortError' || direct?.name === 'TimeoutError') {
    return true;
  }

  const cause = asErrorLike((error as { cause?: unknown } | null)?.cause);

  return cause?.name === 'AbortError' || cause?.name === 'TimeoutError';
}

/**
 * Обрезает строку до лимита в байтах UTF-8, не разрезая символ.
 *
 * Длина в байтах ≠ длине в символах: `Buffer.byteLength` считает байты, а
 * срез делается по кодовым точкам. Если усечение попадает в середину
 * суррогатной пары, лишняя code unit отбрасывается — иначе получился бы
 * «битый» символ (RULES 1.17: наружу не уходит невалидный текст).
 *
 * @param value - исходный текст ответа
 * @param maxBytes - предельный размер в байтах UTF-8
 * @returns текст, у которого `Buffer.byteLength` не больше `maxBytes`
 */
function truncateToBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }

  let usedBytes = 0;
  let end = 0;

  for (const symbol of value) {
    const symbolBytes = Buffer.byteLength(symbol, 'utf8');

    if (usedBytes + symbolBytes > maxBytes) {
      break;
    }

    usedBytes += symbolBytes;
    end += symbol.length;
  }

  return value.slice(0, end);
}

/**
 * Исполнитель узла `http` (KI-105, KI-289, RULES 4.19 / 5.9).
 *
 * Запрос уходит через глобальный `fetch` (Node 18+) с жёстким таймаутом
 * `AbortSignal.timeout`. По умолчанию коды 4xx/5xx **не** считаются ошибкой
 * узла: узел возвращает `{ status, body }`, а решение «это провал» принимает
 * граф (например, узел `condition`). Если в `data.failOnHttpError` стоит `true`
 * (KI-289), ответ с кодом ≥ 400 переводит узел в `failed` — текст ошибки
 * намеренно короткий, без тела и заголовков. Наружу в обоих случаях
 * пробрасываются сетевые ошибки и таймаут — движок запишет их в
 * `node_runs.error`.
 *
 * Тело и заголовки запроса сознательно не логируются: в них попадают токены
 * авторизации (RULES 5.9). Тело **ответа** тоже не попадает в текст ошибки:
 * `failOnHttpError` бросает только код, поэтому PII/секреты из чужого ответа не
 * оседают ни в `node_runs.error`, ни в логах.
 *
 * @param data - распарсенные данные узла (`method`/`url`/`headers`/`body`/`timeoutMs`/`failOnHttpError`)
 * @param inputs - входы узла; `inputs.prompt` используется как URL-фолбэк
 * @returns `{ status, body }`, где `body` обрезано до 1 МБ
 * @throws NodeDataValidationException если данные не проходят Zod-схему
 * @throws Error если URL не задан, запрос прерван по таймауту либо
 *   `failOnHttpError=true` и сервер ответил кодом ≥ 400 (`HTTP <код>`)
 */
export async function executeHttpNode(
  data: unknown,
  inputs: Record<string, unknown> = {},
): Promise<{ status: number; body: string }> {
  const parsed = parseNodeData('http', HttpNodeDataSchema, data);

  const url = parsed.url && parsed.url.length > 0
    ? parsed.url
    : typeof inputs.prompt === 'string'
      ? inputs.prompt.trim()
      : '';

  if (url.length === 0) {
    throw new Error('Узел http: не задан url (ни в data.url, ни во входе prompt)');
  }

  const timeoutMs = parsed.timeoutMs ?? HTTP_DEFAULT_TIMEOUT_MS;

  // RULES 4.19: длительная операция обязана иметь таймаут. `AbortSignal.timeout`
  // не оставляет висеть ни сам запрос, ни таймер после его завершения.
  const signal = AbortSignal.timeout(Math.max(timeoutMs, HTTP_MIN_TIMEOUT_MS));

  // `RequestInit.body` недопустим для GET: undici бросает TypeError, поэтому
  // тело подставляется только для методов, которые его поддерживают.
  const init: RequestInit = { method: parsed.method, signal };

  if (parsed.headers) {
    init.headers = parsed.headers;
  }

  if (parsed.body !== undefined && parsed.method !== 'GET') {
    init.body = parsed.body;
  }

  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error: unknown) {
    if (isAbortLikeError(error)) {
      throw new Error(`Узел http: запрос прерван по таймауту ${timeoutMs} мс`);
    }

    throw error;
  }

  // Тело ответа читается целиком и обрезается до лимита: `node_runs.outputs`
  // — jsonb, и мегабайтные ответы не должны раздувать БД (KI-025). Чтение идёт
  // и при `failOnHttpError`: незакрытый ответ держал бы соединение undici, а
  // `await response.text()` заодно сливает поток до конца.
  const rawBody = await response.text();
  const body = truncateToBytes(rawBody, HTTP_MAX_BODY_BYTES);

  // KI-289: явный заказ «4xx/5xx — это падение». Сравнение с `true` строгое:
  // отсутствие поля (старые графы) и `false` сохраняют прежнее поведение.
  if (parsed.failOnHttpError === true && response.status >= 400) {
    throw new Error(`HTTP ${response.status}`);
  }

  return { status: response.status, body };
}

/* ──────────────── Узел condition (MVP, без маршрутизации) ──────────────── */

/** Поддержанные операции MVP-DSL (DESIGN § 8.2, § 14 — решение 4). */
export type ConditionOperator = '>' | '<' | '>=' | '<=' | '===' | 'includes';

/**
 * Режим вычисления условия (R7.5, KI-364).
 *
 * `dsl` — прежний MVP-DSL (`left`/`operator`/`right`), работает всегда;
 * `sandbox` — произвольное JS-выражение в QuickJS-WASM. Дефолт — `dsl`:
 * старые графы не имеют поля `mode` и должны выполняться как раньше.
 */
export type ConditionMode = 'dsl' | 'sandbox';

/** Данные узла `condition` (объединение двух режимов). */
export interface ConditionNodeData {
  /** Режим вычисления; отсутствует в старых графах → `dsl`. */
  mode?: ConditionMode;
  /** Левая часть DSL: `input.X` либо литерал. */
  left?: string;
  /** Операция сравнения MVP-DSL. */
  operator?: ConditionOperator;
  /** Правая часть DSL: `input.X` либо литерал. */
  right?: string;
  /** JS-выражение для режима `sandbox`. */
  expression?: string;
}

/**
 * Структурный контракт песочницы, который нужен исполнителю условия.
 *
 * Нарочно не импортирует `QuickJsRunnerService` как значение: движок получает
 * готовый экземпляр через DI, а сам модуль исполнителей остаётся свободным от
 * runtime-зависимости на `quickjs-emscripten` (WASM грузится только когда
 * реально запрошен режим `sandbox`).
 */
export interface ConditionSandboxEvaluator {
  /**
   * Вычисляет выражение в песочнице.
   *
   * @param expression - JS-выражение
   * @param input - значение входа узла
   * @param options - лимиты и allowlist
   * @returns результат либо текст ошибки
   */
  evaluateSandboxedAsync(
    expression: string,
    input: unknown,
    options?: SandboxOptions,
  ): Promise<SandboxEvaluation>;
}

/** Результат вычисления условия. */
export interface ConditionResult extends Record<string, unknown> {
  /** Итог условия. */
  result: boolean;
  /**
   * Разрешённые операнды DSL. В режиме `sandbox` отсутствует: выражение может
   * обращаться к любым полям входа, и восстановить «левый/правый операнд»
   * нельзя (KI-282).
   */
  evaluated?: { left: unknown; right: unknown };
}

/** Zod-схема данных узла `condition` в режиме DSL (R6.5.1). */
const ConditionNodeDataSchema = z.object({
  left: z.string().min(1, 'left обязателен'),
  operator: z.enum(['>', '<', '>=', '<=', '===', 'includes']),
  right: z.string().min(1, 'right обязателен'),
});

/** Zod-схема данных узла `condition` в режиме `sandbox` (R7.5). */
const ConditionSandboxDataSchema = z.object({
  expression: z
    .string({ error: 'expression обязателен' })
    .trim()
    .min(1, 'expression обязателен'),
});

/** Запасные ключи входов, среди которых ищется значение по умолчанию. */
const INPUT_FALLBACK_KEYS = ['prompt', 'text', 'value'] as const;

/**
 * Числовая запись без кавычек: `5`, `-1.5`, `1e3`.
 *
 * Нужна, чтобы `input.value`, пришедший от `text`-узла (а тот всегда отдаёт
 * строку), сравнивался как число: иначе `'5' > 3` работало бы, а
 * `evaluated.left` показывал строку вместо числа (DESIGN § 8.2).
 */
const NUMERIC_LITERAL_RE = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Возвращает ключи-кандидаты для значения входа.
 *
 * Первым идёт нормализованный входной порт узла из `NODE_PORT_CONTRACT`
 * (`input` для `condition`, `prompt` для `http`/`output`): движок кладёт чужой
 * выход именно под этим ключом (KI-034), поэтому без него узел не увидел бы
 * данные текстового предшественника. Дальше — общие запасные ключи, чтобы узел
 * работал и с графом, собранным вручную.
 *
 * @param nodeType - тип узла, для которого резолвится вход
 * @returns ключи-кандидаты в порядке приоритета
 */
function fallbackInputKeys(nodeType: string): string[] {
  return [
    inferInputPortName(nodeType),
    ...INPUT_FALLBACK_KEYS.filter((key) => key !== inferInputPortName(nodeType)),
  ];
}

/**
 * Разрешённый операнд условия.
 *
 * `numericEligible` отмечает значения, пришедшие из входов узла: `text`-узел
 * всегда отдаёт строку, поэтому для числовых операций (`>` `<` `>=` `<=`) такую
 * строку нужно привести к числу — иначе `'5' > 3` дало бы нечисловое сравнение,
 * а `evaluated.left` показал бы строку вместо числа (DESIGN § 8.2).
 */
interface ResolvedOperand {
  /** Значение операнда. */
  value: unknown;
  /** Пришло ли значение из входов узла (а не из литерала). */
  numericEligible: boolean;
}

/**
 * Разрешает операнд условия в конкретное значение.
 *
 * Поддержаны четыре формы (DESIGN § 8.2):
 * 1. `input.X` — значение из входов узла; если `input.X` нет, берётся первый
 *    поданный вход из {@link fallbackInputKeys} (входной порт узла, затем
 *    `prompt`/`text`/`value`) — так узел работает и с `text`-предшественником,
 *    чей порт называется `input`/`text`;
 * 2. строка в кавычках (`'abc'` или `"abc"`) — строковый литерал;
 * 3. число (`42`, `-1.5`) — числовой литерал;
 * 4. `true` / `false` — булев литерал.
 *
 * Всё остальное остаётся строкой как есть, а не «вычисляется»: никакого
 * `new Function`/`eval` — DSL намеренно не исполняет пользовательский код
 * (DESIGN § 14, решение 4).
 *
 * @param raw - сырой операнд из `data.left` / `data.right`
 * @param inputs - собранные входы узла
 * @param nodeType - тип узла (определяет приоритетный входной ключ)
 * @param side - сторона операнда (для понятного текста ошибки)
 * @returns значение операнда и признак «пришло из входа»
 * @throws Error если `input.X` не найден и запасных входов тоже нет
 */
function resolveConditionOperand(
  raw: string,
  inputs: Record<string, unknown>,
  nodeType: string,
  side: 'left' | 'right',
): ResolvedOperand {
  const operand = raw.trim();
  const candidates = fallbackInputKeys(nodeType);

  if (operand.startsWith('input.')) {
    const key = operand.slice('input.'.length);

    if (key.length > 0 && Object.hasOwn(inputs, key)) {
      return { value: inputs[key], numericEligible: true };
    }

    for (const candidate of candidates) {
      if (Object.hasOwn(inputs, candidate)) {
        return { value: inputs[candidate], numericEligible: true };
      }
    }

    throw new Error(
      `Узел condition: ${side}='${raw}' — вход '${key}' не найден, ` +
        `а запасных входов (${candidates.join('/')}) нет`,
    );
  }

  const quoted = /^(['"])(.*)\1$/s.exec(operand);

  if (quoted) {
    // Кавычки — явный приказ «это строка»: авто-нормализация к числу её не
    // касается, иначе `input.text === '5'` ломалось бы на строке `'5'`.
    return { value: quoted[2] ?? '', numericEligible: false };
  }

  if (operand === 'true') {
    return { value: true, numericEligible: false };
  }

  if (operand === 'false') {
    return { value: false, numericEligible: false };
  }

  if (NUMERIC_LITERAL_RE.test(operand)) {
    return { value: Number(operand), numericEligible: false };
  }

  return { value: operand, numericEligible: false };
}

/**
 * Приводит операнд к числу для операций `>` `<` `>=` `<=`.
 *
 * Строка из входа узла (`text`-узел отдаёт текст) допускается, если она похожа
 * на число; строковый литерал в кавычках и любой другой тип — нет.
 *
 * @param operand - разрешённый операнд с признаком «пришло из входа»
 * @param side - сторона операнда (для текста ошибки)
 * @returns число
 * @throws Error если значение не приводится к конечному числу
 */
function requireFiniteNumber(operand: ResolvedOperand, side: 'left' | 'right'): number {
  const { value, numericEligible } = operand;
  const numeric =
    typeof value === 'number'
      ? value
      : numericEligible && typeof value === 'string' && NUMERIC_LITERAL_RE.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    throw new Error(
      `Узел condition: ${side} (${JSON.stringify(value)}) не является числом — ` +
        'операции >, <, >=, <= требуют чисел',
    );
  }

  return numeric;
}

/**
 * Вычисляет условие узла `condition` (R6.5.1 + R7.5, KI-364).
 *
 * Режим выбирается полем `data.mode`:
 * - `dsl` (default) — прежняя логика MVP-DSL без исполнения кода;
 * - `sandbox` — JS-выражение в QuickJS-WASM через переданный
 *   {@link ConditionSandboxEvaluator}. Вход узла кладётся в единственную
 *   переменную `input`; значение из `inputs.input` (порт узла) имеет
 *   приоритет, затем `prompt`/`text`/`value` — та же эвристика, что у DSL
 *   (KI-283).
 *
 * Маршрутизация веток в этом подшаге **не** реализуется: узел просто отдаёт
 * `outputs = { result }`, а обе ветки продолжают выполняться на уровне движка.
 *
 * @param data - данные узла (`mode`, `left`/`operator`/`right` либо `expression`)
 * @param inputs - собранные входы узла (`inputs.input`, `inputs.text`, …)
 * @param sandbox - исполнитель песочницы (обязателен для `mode='sandbox'`)
 * @returns `{ result, evaluated? }`; `evaluated` есть только у DSL
 * @throws NodeDataValidationException если данные не проходят Zod-схему
 * @throws Error если операция неприменима к типам операндов
 * @throws SandboxUnavailableException если `mode='sandbox'`, а песочница
 *   выключена/не загрузилась (пробрасывается из исполнителя песочницы)
 */
export async function executeConditionNode(
  data: unknown,
  inputs: Record<string, unknown> = {},
  sandbox?: ConditionSandboxEvaluator,
): Promise<ConditionResult> {
  const mode = readConditionMode(data);

  if (mode === 'sandbox') {
    return executeSandboxConditionAsync(data, inputs, sandbox);
  }

  return executeDslCondition(data, inputs);
}

/**
 * Вычисляет условие в режиме `dsl` (прежняя логика MVP-DSL).
 *
 * @param data - данные узла (`left`/`operator`/`right`)
 * @param inputs - собранные входы узла
 * @returns `{ result, evaluated }`
 * @throws NodeDataValidationException если данные не проходят Zod-схему
 * @throws Error если операция неприменима к типам операндов
 */
function executeDslCondition(
  data: unknown,
  inputs: Record<string, unknown>,
): ConditionResult & { evaluated: { left: unknown; right: unknown } } {
  const parsed = parseNodeData('condition', ConditionNodeDataSchema, data);
  const resolvedLeft = resolveConditionOperand(parsed.left, inputs, 'condition', 'left');
  const resolvedRight = resolveConditionOperand(parsed.right, inputs, 'condition', 'right');
  const left = resolvedLeft.value;
  const right = resolvedRight.value;

  // Числовые операции отдают в `evaluated` ровно те значения, которые
  // сравнивались (то есть приведённые к числу), остальные — исходные.
  let evaluated: { left: unknown; right: unknown } = { left, right };
  let result: boolean;

  switch (parsed.operator) {
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const a = requireFiniteNumber(resolvedLeft, 'left');
      const b = requireFiniteNumber(resolvedRight, 'right');

      evaluated = { left: a, right: b };

      result =
        parsed.operator === '>'
          ? a > b
          : parsed.operator === '<'
            ? a < b
            : parsed.operator === '>='
              ? a >= b
              : a <= b;
      break;
    }
    case '===':
      // Строгое равенство примитивов. Объекты/массивы не поддержаны осознанно:
      // сравнение по ссылке почти всегда не то, что имел в виду автор графа.
      if (isNonPrimitive(left) || isNonPrimitive(right)) {
        throw new Error(
          'Узел condition: операция === поддержана только для примитивов ' +
            '(строка, число, boolean)',
        );
      }

      result = left === right;
      break;
    case 'includes': {
      result = evaluateIncludes(left, right);
      break;
    }
    default: {
      // Недостижимо: набор операций ограничен Zod-схемой. Ветка нужна, чтобы
      // `result` был точно инициализирован (RULES 4.15: без `any` и без `!`).
      throw new NodeDataValidationException(
        'condition',
        `неподдерживаемая операция: ${String(parsed.operator)}`,
      );
    }
  }

  return { result, evaluated };
}

/**
 * Читает режим условия из недоверенных `data`.
 *
 * Отсутствующее/пустое поле — `dsl` (обратная совместимость со старыми
 * графами). Неизвестное значение — ошибка, а не молчаливый откат в DSL: иначе
 * опечатка в `mode` исполняла бы выражение не тем способом, чем ожидал автор.
 *
 * @param data - сырые данные узла
 * @returns режим вычисления
 * @throws NodeDataValidationException если `mode` — неизвестная строка
 */
function readConditionMode(data: unknown): ConditionMode {
  if (typeof data !== 'object' || data === null) {
    return 'dsl';
  }

  const mode = (data as Record<string, unknown>).mode;

  if (mode === undefined || mode === null || mode === '') {
    return 'dsl';
  }

  if (mode === 'dsl' || mode === 'sandbox') {
    return mode;
  }

  const description =
    typeof mode === 'string' ? `'${mode}'` : (JSON.stringify(mode) ?? 'undefined');

  throw new NodeDataValidationException(
    'condition',
    `mode: неизвестный режим ${description}`,
  );
}

/**
 * Вычисляет условие в режиме `sandbox` (R7.5).
 *
 * Ошибка песочницы (timeout/OOM/исключение выражения) превращается в обычный
 * `Error` с её текстом: движок ловит исключение исполнителя и пишет
 * `node_runs.error`, то есть узел становится `failed` ровно с этим текстом.
 *
 * @param data - данные узла (`expression`)
 * @param inputs - собранные входы узла
 * @param sandbox - исполнитель песочницы
 * @returns `{ result }` — результат выражения, приведённый к boolean
 * @throws NodeDataValidationException если `expression` пуст/не строка
 * @throws Error если песочница вернула ошибку либо исполнитель не передан
 */
async function executeSandboxConditionAsync(
  data: unknown,
  inputs: Record<string, unknown>,
  sandbox: ConditionSandboxEvaluator | undefined,
): Promise<ConditionResult> {
  const parsed = parseNodeData('condition', ConditionSandboxDataSchema, data);

  if (sandbox === undefined) {
    throw new Error('Sandbox unavailable: evaluator is not configured');
  }

  const evaluation = await sandbox.evaluateSandboxedAsync(
    parsed.expression,
    pickPrimaryInput(inputs),
  );

  if (evaluation.error !== undefined) {
    throw new Error(evaluation.error);
  }

  // Приведение к boolean — семантика условия: `input.length` (число) или
  // `input.text` (непустая строка) тоже осмысленны как «истина/ложь».
  return { result: Boolean(evaluation.result) };
}

/**
 * Выбирает «главный» вход узла для переменной `input` в песочнице.
 *
 * Порядок ключей совпадает с {@link fallbackInputKeys}: сначала
 * нормализованный порт узла (`input`), затем `prompt`/`text`/`value`. Это та же
 * эвристика, что у DSL (KI-283), поэтому переключение режима не меняет смысл
 * входа для типового графа `text → condition`.
 *
 * @param inputs - собранные входы узла
 * @returns значение первого найденного входа либо `null`
 */
function pickPrimaryInput(inputs: Record<string, unknown>): unknown {
  for (const key of fallbackInputKeys('condition')) {
    if (Object.hasOwn(inputs, key)) {
      return inputs[key] ?? null;
    }
  }

  return null;
}

/**
 * Проверяет, что значение — объект или массив (не примитив).
 *
 * @param value - проверяемое значение
 * @returns `true` для `object`/массива/функции
 */
function isNonPrimitive(value: unknown): boolean {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Применяет операцию `includes`.
 *
 * Поддержаны массивы (вхождение элемента) и строки (подстрока); `right` для
 * массива должен быть примитивом. Для остальных типов — ошибка с понятным
 * текстом, а не молчаливый `false`.
 *
 * @param left - левый операнд (массив или строка)
 * @param right - правый операнд (искомое значение)
 * @returns результат проверки вхождения
 * @throws Error если `left` не массив и не строка, либо `right` — объект
 */
function evaluateIncludes(left: unknown, right: unknown): boolean {
  if (Array.isArray(left)) {
    if (isNonPrimitive(right)) {
      throw new Error(
        'Узел condition: includes для массива требует примитив справа ' +
          '(строку, число или boolean)',
      );
    }

    return left.includes(right);
  }

  if (typeof left === 'string') {
    if (typeof right !== 'string') {
      throw new Error(
        'Узел condition: includes для строки требует строку справа',
      );
    }

    return left.includes(right);
  }

  throw new Error(
    `Узел condition: includes не поддерживает тип '${typeof left}' слева ` +
      '(нужен массив или строка)',
  );
}

/* ────────────────────────────── Узел output ────────────────────────────── */

/** Данные узла `output`. */
export interface OutputNodeData {
  /** Имя ключа, под которым результат попадёт в `outputs`. */
  name: string;
}

/** Zod-схема данных узла `output`. */
const OutputNodeDataSchema = z.object({
  name: z.string().trim().min(1, 'name обязателен'),
});

/** Порядок ключей, среди которых ищется «первое непустое» значение. */
const OUTPUT_VALUE_KEYS = [
  'prompt',
  'text',
  'value',
  'input',
  'result',
  'mediaUrl',
  'url',
] as const;

/**
 * Считает значение пустым для целей узла `output`.
 *
 * Пустыми считаются `null`/`undefined`, пустая (или пробельная) строка,
 * пустой массив и пустой объект: терминальный узел должен пропустить дальше
 * осмысленное значение, а не «ничего».
 *
 * @param value - проверяемое значение
 * @returns `true`, если значение пустое
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
}

/**
 * Терминальный узел `output` (KI-105, DESIGN § 8.3).
 *
 * Пропускает первый непустой вход насквозь и подписывает его именем из
 * `data.name`: `{ [name]: value }`. Именно этот объект попадает в
 * `node_runs.outputs` — сборщик `workflow_runs.outputs` (движок) не меняется и
 * по-прежнему собирает `nodeId → outputs` по всем узлам.
 *
 * @param data - данные узла (`name`)
 * @param inputs - собранные входы узла
 * @returns `{ [name]: value }`, где `value` — первый непустой вход либо `null`
 * @throws NodeDataValidationException если `name` не задан или пуст
 */
export function executeOutputNode(
  data: unknown,
  inputs: Record<string, unknown> = {},
): Record<string, unknown> {
  const parsed = parseNodeData('output', OutputNodeDataSchema, data);

  for (const key of OUTPUT_VALUE_KEYS) {
    const value = inputs[key];

    if (!isEmptyValue(value)) {
      return { [parsed.name]: value };
    }
  }

  // Ни одного осмысленного входа: узел не падает — терминальный результат
  // просто пуст, и это видно в outputs как `{ name: null }`.
  return { [parsed.name]: null };
}

/* ───────────────────────────── Узел compare ───────────────────────────── */

/** Данные узла `compare`. */
export interface CompareNodeData {
  /** Режим сравнения; `llm-judge` появится в v0.8.x (нужен доступ к LLM). */
  mode: 'diff';
}

/** Zod-схема данных узла `compare`: пока поддержан только `diff`. */
const CompareNodeDataSchema = z.object({
  mode: z.literal('diff', {
    error: "поддержан только mode='diff' (llm-judge — задача v0.8.x)",
  }),
});
/** Ключи входов, из которых узел `compare` берёт операнды `a` и `b`. */
const COMPARE_LEFT_KEYS = ['a', 'left', 'true'] as const;
/** Ключи входов для правого операнда `b`. */
const COMPARE_RIGHT_KEYS = ['b', 'right', 'false'] as const;

/**
 * Приводит операнд сравнения к строке для diff'а.
 *
 * Объекты и массивы сериализуются в JSON: иначе `String(объект)` дал бы
 * бесполезное `[object Object]`.
 *
 * @param value - значение операнда
 * @returns строковое представление
 */
function stringifyOperand(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      // Круговые ссылки невозможны в jsonb-графе, но исполнитель не должен
      // падать из-за сериализации: отдаём общее представление.
      return Object.prototype.toString.call(value);
    }
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.description ?? 'symbol';
  }

  // Сюда попадают только функции: остальные типы разобраны выше.
  return 'function';
}

/**
 * Строит короткое человекочитаемое описание различия.
 *
 * Внешние diff-библиотеки не привлекаются намеренно: для MVP достаточно
 * построчного сравнения, а полноценный diff — задача UI-слоя (R6.5.2).
 *
 * @param left - левый операнд
 * @param right - правый операнд
 * @returns текст различия (пустая строка не возвращается — вызывающий код
 *   проверяет `equal` раньше)
 */
function buildDiffDescription(left: unknown, right: unknown): string {
  const leftText = stringifyOperand(left);
  const rightText = stringifyOperand(right);

  if (leftText.includes('\n') || rightText.includes('\n')) {
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');
    const total = Math.max(leftLines.length, rightLines.length);

    for (let index = 0; index < total; index += 1) {
      const a = leftLines[index] ?? '';
      const b = rightLines[index] ?? '';

      if (a !== b) {
        return (
          `различие в строке ${index + 1}: ` +
          `${JSON.stringify(a)} ≠ ${JSON.stringify(b)} ` +
          `(строк: ${leftLines.length} vs ${rightLines.length})`
        );
      }
    }
  }

  // Для позиции различия строка режется на кодовые точки (`Array.from`), а не
  // на code units: иначе позиция в UTF-16 не совпадала бы с видимым символом.
  // Составные эмодзи могут распасться на части — для отчёта о различии это
  // допустимо, а grapheme-сегментация здесь избыточна.
  const leftChars = Array.from(leftText);
  const rightChars = Array.from(rightText);
  const shortest = Math.min(leftChars.length, rightChars.length);

  for (let index = 0; index < shortest; index += 1) {
    if (leftChars[index] !== rightChars[index]) {
      return (
        `первое различие на позиции ${index}: ` +
        `${JSON.stringify(leftChars[index])} ≠ ${JSON.stringify(rightChars[index])} ` +
        `(длины: ${leftChars.length} vs ${rightChars.length})`
      );
    }
  }

  return `длины различаются: ${leftChars.length} vs ${rightChars.length}`;
}

/**
 * Ищет операнд узла `compare` в его входах.
 *
 * @param inputs - собранные входы узла
 * @param keys - допустимые ключи в порядке приоритета
 * @returns найденное значение либо `undefined`
 */
function pickCompareOperand(
  inputs: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(inputs, key)) {
      return inputs[key];
    }
  }

  return undefined;
}

/**
 * Сравнивает два входа (KI-105, DESIGN § 8.5) — только `mode='diff'`.
 *
 * Режим `llm-judge` не реализуется: движок не имеет доступа к LLM (провайдер
 * инжектится только в LLM-узлы через DI), это отдельная задача v0.8.x.
 *
 * Операнды берутся из входов по контракту портов (`a`/`b`), с запасными
 * ключами `left`/`right` и `true`/`false` — последние нужны, если узел
 * подключён к веткам `condition` до появления реальной маршрутизации.
 *
 * @param data - данные узла (`mode`)
 * @param inputs - входы узла (`inputs.a` и `inputs.b`)
 * @returns `{ diff, equal }`; при равенстве `diff` — пустая строка
 * @throws NodeDataValidationException если `mode` не `diff`
 * @throws Error если хотя бы один вход не подан
 */
export function executeCompareNode(
  data: unknown,
  inputs: Record<string, unknown> = {},
): { diff: string; equal: boolean } {
  const parsed = parseNodeData('compare', CompareNodeDataSchema, data);

  // `parsed` пока читается только для валидации режима; ветвление по `mode`
  // появится вместе с `llm-judge` в v0.8.x.
  void parsed;

  const left = pickCompareOperand(inputs, COMPARE_LEFT_KEYS);
  const right = pickCompareOperand(inputs, COMPARE_RIGHT_KEYS);

  if (left === undefined || right === undefined) {
    const missing: string[] = [];

    if (left === undefined) {
      missing.push(`a (искали: ${COMPARE_LEFT_KEYS.join('/')})`);
    }

    if (right === undefined) {
      missing.push(`b (искали: ${COMPARE_RIGHT_KEYS.join('/')})`);
    }

    throw new Error(
      `Узел compare: не подан вход ${missing.join(', ')} — ` +
        `получены ключи: ${Object.keys(inputs).join(', ') || '(нет)'}`,
    );
  }

  const equal = stringifyOperand(left) === stringifyOperand(right);

  return { diff: equal ? '' : buildDiffDescription(left, right), equal };
}

/* ──────────────────── Узлы vector_* / memory_* (R7.4a) ──────────────────── */

/**
 * Запись для INSERT в `workflow_vectors`.
 *
 * Интерфейс объявлен здесь, а не в сервисе БД: исполнители тестируются без
 * Nest-DI и без PostgreSQL, поэтому им достаточно структурного контракта
 * (тот же приём, что у {@link SubWorkflowLookup}).
 */
export interface VectorRecordInput {
  /** Владелец данных — workflow запуска (изоляция коллекций). */
  readonly workflowId: string;
  /** Логическая коллекция внутри workflow. */
  readonly collection: string;
  /** Вектор эмбеддинга; длина проверяется исполнителем. */
  readonly embedding: number[];
  /** Содержимое записи (`{ text }` — текст, ушедший в эмбеддинг). */
  readonly content: Record<string, unknown>;
  /** Произвольные метаданные (по умолчанию `{}`). */
  readonly metadata: Record<string, unknown>;
}

/** Параметры косинусного поиска по коллекции. */
export interface VectorQueryInput {
  /** Владелец данных — workflow запуска. */
  readonly workflowId: string;
  /** Логическая коллекция внутри workflow. */
  readonly collection: string;
  /** Вектор запроса. */
  readonly embedding: number[];
  /** Сколько ближайших записей вернуть (LIMIT). */
  readonly topK: number;
  /** Порог косинусной близости: результаты ниже отбрасываются. */
  readonly scoreThreshold: number;
}

/** Совпадение векторного поиска. */
export interface VectorMatch {
  /** uuid записи `workflow_vectors`. */
  readonly id: string;
  /** Содержимое записи. */
  readonly content: Record<string, unknown>;
  /** Метаданные записи. */
  readonly metadata: Record<string, unknown>;
  /** Косинусная близость `1 - (embedding <=> query)` в диапазоне [-1, 1]. */
  readonly score: number;
}

/**
 * Хранилище vector/memory-данных (реализация — `VectorStoreService`).
 *
 * Методы с суффиксом `Async` (RULES 1.4). `readMemoryAsync` возвращает
 * `undefined` для отсутствующего ключа, а не `null`: `null` — валидное
 * сохранённое JSON-значение, и различать эти случаи обязан вызывающий.
 */
export interface VectorMemoryStore {
  /**
   * Добавляет вектор в коллекцию workflow.
   *
   * @param record - workflow, коллекция, вектор, содержимое и метаданные
   * @returns `id` созданной строки
   */
  insertVectorAsync(record: VectorRecordInput): Promise<{ id: string }>;

  /**
   * Ищет ближайшие векторы коллекции по косинусной близости.
   *
   * @param query - workflow, коллекция, вектор запроса, topK и порог
   * @returns совпадения, отсортированные по убыванию `score`
   */
  queryVectorsAsync(query: VectorQueryInput): Promise<VectorMatch[]>;

  /**
   * Читает значение памяти workflow по ключу.
   *
   * @param workflowId - владелец памяти
   * @param key - ключ записи
   * @returns сохранённое значение либо `undefined`, если ключа нет
   */
  readMemoryAsync(workflowId: string, key: string): Promise<unknown>;

  /**
   * Записывает значение памяти (UPSERT по `workflow_id` + `key`).
   *
   * @param workflowId - владелец памяти
   * @param key - ключ записи
   * @param value - произвольное JSON-значение
   */
  writeMemoryAsync(workflowId: string, key: string, value: unknown): Promise<void>;
}

/**
 * Контекст выполнения vector/memory-узлов.
 *
 * Собирается движком: он знает `runId` → `workflow_id`, имеет доступ к БД и
 * к реестру LLM-провайдеров. Исполнители остаются чистыми функциями, поэтому
 * их юнит-тесты не поднимают Nest-модуль и не ходят в сеть.
 */
export interface VectorMemoryContext {
  /** workflow, которому принадлежат векторы и память. */
  readonly workflowId: string;
  /** Хранилище (в продакшене — `VectorStoreService`). */
  readonly store: VectorMemoryStore;
  /**
   * Эмбеддинг текста.
   *
   * @param texts - тексты для векторизации
   * @param model - id модели эмбеддингов
   * @returns векторы в порядке `texts`
   */
  embedAsync(texts: string[], model: string): Promise<number[][]>;
}

/** Zod-схема данных узла `vector_upsert`. */
const VectorUpsertNodeDataSchema = z.object({
  kind: z.literal('vector_upsert').optional(),
  collection: z.string().trim().min(1, 'collection обязателен'),
  embeddingModel: z.string().trim().min(1).default(DEFAULT_EMBEDDING_MODEL),
  contentField: z.string().trim().min(1).optional(),
  // Текст, введённый прямо в узле (textarea). Связь `inputs.prompt` важнее.
  prompt: z.string().optional(),
});

/** Zod-схема данных узла `vector_query`. */
const VectorQueryNodeDataSchema = z.object({
  kind: z.literal('vector_query').optional(),
  collection: z.string().trim().min(1, 'collection обязателен'),
  embeddingModel: z.string().trim().min(1).default(DEFAULT_EMBEDDING_MODEL),
  // DESIGN § 3.4: default topK = 5, scoreThreshold = 0.7. Верхняя граница
  // topK — защита от запроса «вся таблица»: HNSW всё равно сканирует индекс,
  // но в память попадут все строки.
  topK: z.number().int().positive().max(100).default(5),
  scoreThreshold: z.number().min(-1).max(1).default(0.7),
  prompt: z.string().optional(),
});

/** Zod-схема данных узла `memory_read`. */
const MemoryReadNodeDataSchema = z.object({
  kind: z.literal('memory_read').optional(),
  key: z.string().trim().min(1, 'key обязателен'),
});

/** Zod-схема данных узла `memory_write`. */
const MemoryWriteNodeDataSchema = z.object({
  kind: z.literal('memory_write').optional(),
  key: z.string().trim().min(1, 'key обязателен'),
  valueField: z.string().trim().min(1).optional(),
  // Текст, введённый прямо в узле (textarea), — fallback без связи.
  value: z.unknown().optional(),
});

/** Ключи входов, из которых берётся текст, если поле не задано явно. */
const VECTOR_INPUT_FALLBACK_KEYS = ['prompt', 'text', 'value', 'input'] as const;

/**
 * Приводит значение входа к тексту для эмбеддинга.
 *
 * Строка уходит как есть, объект/массив — в JSON: иначе `String(объект)` дал бы
 * `[object Object]` и вектор не нёс бы смысла.
 *
 * @param value - значение входа узла (`unknown`)
 * @returns текст либо `null`, если значение пустое/не представимо
 */
function toVectorText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);

      return serialized !== undefined && serialized !== '{}' && serialized !== '[]'
        ? serialized
        : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Выбирает текст для эмбеддинга из входов и данных узла.
 *
 * Приоритет: явное поле `field` (если задано — его отсутствие ошибка, а не
 * молчаливая подмена), затем стандартные входы `prompt`/`text`/`value`/`input`,
 * затем текст из `data.prompt` (textarea узла).
 *
 * @param nodeType - тип узла (для текста ошибки)
 * @param field - имя поля входа из `data.contentField`/`valueField`
 * @param inputs - собранные входы узла
 * @param fallback - текст из данных узла
 * @returns непустой текст
 * @throws Error если текст не найден ни в одном источнике
 */
function pickVectorText(
  nodeType: string,
  field: string | undefined,
  inputs: Record<string, unknown>,
  fallback: string | undefined,
): string {
  if (field !== undefined) {
    const value = toVectorText(inputs[field]);

    if (value === null) {
      throw new Error(
        `Узел ${nodeType}: поле входа '${field}' не найдено или пусто ` +
          `(получены ключи: ${Object.keys(inputs).join(', ') || '(нет)'})`,
      );
    }

    return value;
  }

  for (const key of VECTOR_INPUT_FALLBACK_KEYS) {
    const value = toVectorText(inputs[key]);

    if (value !== null) {
      return value;
    }
  }

  const own = fallback !== undefined ? toVectorText(fallback) : null;

  if (own !== null) {
    return own;
  }

  throw new Error(
    `Узел ${nodeType}: не задан текст (ни во входе prompt, ни в поле узла)`,
  );
}

/**
 * Получает один эмбеддинг и проверяет его размерность.
 *
 * Размерность фиксирована колонкой `vector(1536)`: модель `3-large` (3072)
 * дала бы ошибку PostgreSQL на INSERT, поэтому проверка делается раньше —
 * с понятным текстом и без «грязной» записи.
 *
 * @param nodeType - тип узла (для текста ошибки)
 * @param context - контекст с `embedAsync`
 * @param text - текст для векторизации
 * @param model - id модели эмбеддингов
 * @returns вектор длины {@link DEFAULT_EMBEDDING_DIMENSIONS}
 * @throws Error если провайдер вернул не ровно один вектор или неверную длину
 */
async function embedVectorAsync(
  nodeType: string,
  context: VectorMemoryContext,
  text: string,
  model: string,
): Promise<number[]> {
  const vectors = await context.embedAsync([text], model);
  const vector = vectors[0];

  if (vectors.length !== 1 || vector === undefined) {
    throw new Error(
      `Узел ${nodeType}: провайдер вернул ${vectors.length} векторов на 1 текст`,
    );
  }

  if (vector.length !== DEFAULT_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Узел ${nodeType}: модель '${model}' вернула вектор размерности ` +
        `${vector.length}, ожидается ${DEFAULT_EMBEDDING_DIMENSIONS} ` +
        '(колонка vector(1536)); используйте text-embedding-3-small',
    );
  }

  return vector;
}

/**
 * Исполнитель узла `vector_upsert` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Текст берётся из входа (`data.contentField` либо `prompt`/`text`/`value`/
 * `input`) или из textarea узла, векторизуется и пишется в
 * `workflow_vectors`. Повторный запуск **добавляет** новую строку: ключа
 * идемпотентности у коллекции нет (см. отчёт R7.4a — решение обосновано).
 *
 * @param data - данные узла (`collection`, `embeddingModel`, `contentField?`, `prompt?`)
 * @param inputs - входы узла (`prompt` от Text/LLM)
 * @param context - workflow, хранилище и провайдер эмбеддингов
 * @returns `{ result: { id, collection } }`
 * @throws NodeDataValidationException если `data` не проходят Zod-схему
 * @throws Error если текст не найден, провайдер вернул неверную размерность
 *   или запись в БД упала
 */
export async function executeVectorUpsertNodeAsync(
  data: unknown,
  inputs: Record<string, unknown>,
  context: VectorMemoryContext,
): Promise<Record<string, unknown>> {
  const parsed = parseNodeData('vector_upsert', VectorUpsertNodeDataSchema, data);
  const text = pickVectorText(
    'vector_upsert',
    parsed.contentField,
    inputs,
    parsed.prompt,
  );
  const embedding = await embedVectorAsync(
    'vector_upsert',
    context,
    text,
    parsed.embeddingModel,
  );
  const { id } = await context.store.insertVectorAsync({
    workflowId: context.workflowId,
    collection: parsed.collection,
    embedding,
    content: { text },
    metadata: {},
  });

  return { result: { id, collection: parsed.collection } };
}

/**
 * Исполнитель узла `vector_query` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Косинусный поиск (`embedding <=> $1`) с `LIMIT topK`; порог `scoreThreshold`
 * применяется к `1 - distance` уже после topK — так узел не отбрасывает
 * «лучшее из плохого», если коллекция ещё пустая по смыслу.
 *
 * @param data - данные узла (`collection`, `embeddingModel`, `topK?`, `scoreThreshold?`, `prompt?`)
 * @param inputs - входы узла (`prompt` — текст запроса)
 * @param context - workflow, хранилище и провайдер эмбеддингов
 * @returns `{ result: VectorMatch[] }` — совпадения по убыванию `score`
 * @throws NodeDataValidationException если `data` не проходят Zod-схему
 * @throws Error если текст запроса не найден или провайдер вернул неверную размерность
 */
export async function executeVectorQueryNodeAsync(
  data: unknown,
  inputs: Record<string, unknown>,
  context: VectorMemoryContext,
): Promise<Record<string, unknown>> {
  const parsed = parseNodeData('vector_query', VectorQueryNodeDataSchema, data);
  const text = pickVectorText('vector_query', undefined, inputs, parsed.prompt);
  const embedding = await embedVectorAsync(
    'vector_query',
    context,
    text,
    parsed.embeddingModel,
  );
  const matches = await context.store.queryVectorsAsync({
    workflowId: context.workflowId,
    collection: parsed.collection,
    embedding,
    topK: parsed.topK,
    scoreThreshold: parsed.scoreThreshold,
  });

  return { result: matches };
}

/**
 * Исполнитель узла `memory_read` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * @param data - данные узла (`key`)
 * @param _inputs - входы узла (не используются: ключ задан в узле)
 * @param context - workflow и хранилище
 * @returns `{ result, found }`: `result` — значение либо `null`,
 *   `found` — был ли ключ в памяти
 * @throws NodeDataValidationException если `key` пуст
 */
export async function executeMemoryReadNodeAsync(
  data: unknown,
  _inputs: Record<string, unknown>,
  context: VectorMemoryContext,
): Promise<Record<string, unknown>> {
  const parsed = parseNodeData('memory_read', MemoryReadNodeDataSchema, data);
  const value = await context.store.readMemoryAsync(context.workflowId, parsed.key);

  if (value === undefined) {
    return { result: null, found: false };
  }

  return { result: value, found: true };
}

/**
 * Исполнитель узла `memory_write` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Значение берётся из входа `data.valueField` (если задан), иначе из
 * `prompt`/`text`/`value`/`input`/`result`, иначе из textarea узла. UPSERT по
 * `(workflow_id, key)`: повторный запуск обновляет значение, а не плодит ключи.
 *
 * @param data - данные узла (`key`, `valueField?`, `value?`)
 * @param inputs - входы узла
 * @param context - workflow и хранилище
 * @returns `{ result: value, key }`
 * @throws NodeDataValidationException если `key` пуст
 * @throws Error если значение не найдено ни в одном источнике
 */
export async function executeMemoryWriteNodeAsync(
  data: unknown,
  inputs: Record<string, unknown>,
  context: VectorMemoryContext,
): Promise<Record<string, unknown>> {
  const parsed = parseNodeData('memory_write', MemoryWriteNodeDataSchema, data);
  const value = pickMemoryValue(parsed.valueField, inputs, parsed.value);

  await context.store.writeMemoryAsync(context.workflowId, parsed.key, value);

  return { result: value, key: parsed.key };
}

/**
 * Выбирает значение для записи в память.
 *
 * @param field - явное поле входа (`data.valueField`); если задано, его
 *   отсутствие — ошибка, а не тихая подмена другим значением
 * @param inputs - входы узла
 * @param fallback - значение из textarea узла
 * @returns JSON-значение для `workflow_memory.value`
 * @throws Error если значение не найдено
 */
function pickMemoryValue(
  field: string | undefined,
  inputs: Record<string, unknown>,
  fallback: unknown,
): unknown {
  if (field !== undefined) {
    if (!Object.hasOwn(inputs, field)) {
      throw new Error(
        `Узел memory_write: поле входа '${field}' не найдено ` +
          `(получены ключи: ${Object.keys(inputs).join(', ') || '(нет)'})`,
      );
    }

    return inputs[field];
  }

  const keys = [...VECTOR_INPUT_FALLBACK_KEYS, 'result'] as const;

  for (const key of keys) {
    if (Object.hasOwn(inputs, key) && inputs[key] !== undefined) {
      return inputs[key];
    }
  }

  if (fallback !== undefined && fallback !== null) {
    return fallback;
  }

  throw new Error(
    'Узел memory_write: не задано значение (ни во входах, ни в поле узла)',
  );
}

/* ────────────────────────────── Узел agent (R7.4b) ────────────────────────────── */

/**
 * Zod-схема данных узла `agent` (R7.4b, DESIGN v0.9 § 3.4).
 *
 * `tools` обязателен и непуст: агент без инструментов — это LLM-узел с лишним
 * циклом. Дубли имён отсекаются refine'ом (повтор в чекбоксах не должен
 * удваивать вызов), а порог `AGENT_TOOL_NAMES.length` соответствует UI (7).
 */
const AgentNodeDataSchema = z.object({
  // `kind` обязателен (в отличие от старых узлов): agent появился в v0.9,
  // графов без дискриминатора не существует, а совпадение с `AgentNodeData`
  // проверяет tsc.
  kind: z.literal('agent'),
  model: z.string().trim().min(1, 'model обязателен'),
  systemPrompt: z.string().optional(),
  tools: z
    .array(z.enum(AGENT_TOOL_NAMES))
    .min(1, 'нужен хотя бы один инструмент')
    .max(AGENT_TOOL_NAMES.length)
    .refine(
      (tools) => new Set(tools).size === tools.length,
      'инструменты не должны повторяться',
    ),
  // Границы совпадают с UI и env-схемой (R7.4b): больше 10 итераций — это
  // зацикливание модели, а не сценарий workflow.
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(AGENT_MAX_ITERATIONS_LIMIT)
    .optional(),
  maxTokensPerStep: z
    .number()
    .int()
    .min(1)
    .max(AGENT_MAX_TOKENS_PER_STEP_LIMIT)
    .optional(),
});

/**
 * Исполнитель цикла агента (реализация — `AgentService`).
 *
 * Интерфейс объявлен здесь, а не в сервисе: исполнитель узла — чистая
 * функция, и ему достаточно структурного контракта (тот же приём, что у
 * `VectorMemoryContext` и `SubWorkflowLookup`). Благодаря этому юнит-тесты
 * executor'а не поднимают Nest-модуль.
 */
export interface AgentRunner {
  /**
   * Выполняет агента до финального ответа.
   *
   * @param node - валидированные данные узла
   * @param inputs - входы узла (уходят в первое user-сообщение)
   * @param runId - uuid запуска (нужен для `workflow_id` и логов)
   * @param nodeId - id узла в графе (для логов и контекста инструментов)
   * @returns ответ, шаги, число итераций и usage
   */
  runAgentAsync(
    node: AgentNodeData,
    inputs: unknown,
    runId: string,
    nodeId?: string,
  ): Promise<AgentRunResult>;
}

/** Результат исполнителя узла `agent`: выходы и шаги для timeline/логов. */
export interface AgentNodeExecution {
  /** Выходы узла: `{ result: answer, steps }` (DESIGN § 3.4). */
  outputs: Record<string, unknown>;
  /** Шаги в порядке выполнения — они же пишутся в `node_runs.logs`. */
  steps: AgentStep[];
}

/**
 * Исполнитель узла `agent` (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Валидирует `data` Zod-схемой и делегирует цикл {@link AgentRunner}. Шаги
 * возвращаются и в `outputs.steps` (для timeline в панели результата), и
 * отдельным полем — движок пишет их в `node_runs.logs` как JSON-строки.
 *
 * @param node - узел графа типа `agent`
 * @param inputs - нормализованные входы узла (после KI-034 ключ — `prompt`)
 * @param runId - uuid запуска
 * @param runner - цикл агента (`AgentService` в продакшене)
 * @returns `{ outputs: { result, steps }, steps }`
 * @throws NodeDataValidationException если `data` не проходят Zod-схему
 * @throws AgentIterationLimitException если лимит итераций исчерпан
 * @throws LlmProviderException если вызов модели упал
 */
export async function executeAgentNodeAsync(
  node: NodeDto,
  inputs: Record<string, unknown>,
  runId: string,
  runner: AgentRunner,
): Promise<AgentNodeExecution> {
  const data = parseNodeData('agent', AgentNodeDataSchema, node.data);
  const result = await runner.runAgentAsync(data, inputs, runId, node.id);

  return {
    outputs: { result: result.answer, steps: result.steps },
    steps: result.steps,
  };
}

/* ─────────────────────────── Узел sub_workflow ─────────────────────────── */

/**
 * Предельная глубина вложенности под-воркфлоу (DESIGN v0.8 § 5.6, KI-200).
 *
 * Считается по числу **вложенных** уровней: узел верхнего графа выполняется на
 * глубине 0, его подграф — на глубине 1, и так далее. Узел, который попытался
 * бы загрузить шестой уровень, падает с ошибкой «Максимальная глубина
 * вложенности». Ограничение защищает от бесконечной цепочки разных workflow
 * (цикл ловится отдельно — по {@link SubWorkflowContext.visitedWorkflows}).
 */
export const SUB_WORKFLOW_MAX_DEPTH = 5;

/**
 * Данные узла `sub_workflow`: ссылка на другой workflow того же владельца.
 *
 * `version` — снимок версии графа на момент, когда автор выбрал подграф
 * (DESIGN § 5.5): расхождение не блокирует запуск, а показывается в UI как
 * «есть новая версия» — иначе правка дочернего workflow молча ломала бы
 * родительский запуск.
 *
 * `inputsMap` — маппинг «имя входа родителя → ключ в `inputs` подграфа».
 * В v0.8 поле хранится и переносится между Save/Load, но execитор его пока не
 * применяет: у подграфа один вход (`prompt`), а сам маппинг имеет смысл только
 * вместе с именованными портами входов (KI-278/KI-279).
 */
export interface SubWorkflowNodeData {
  kind: 'sub_workflow';
  /** uuid workflow-подграфа. */
  workflowId: string;
  /** Снимок версии графа (опционально). */
  version?: number;
  /** Маппинг: имя входа родителя → ключ в inputs подграфа. */
  inputsMap?: Record<string, string>;
}

/**
 * Zod-схема данных узла `sub_workflow`.
 *
 * `workflowId` — обязательный uuid: пустая строка (узел, который ещё не
 * настроили) приводит к внятной ошибке валидации узла, а не к походу в БД с
 * мусорным ключом. `version`/`inputsMap` необязательны.
 */
const SubWorkflowNodeDataSchema = z.object({
  kind: z.literal('sub_workflow'),
  workflowId: z.uuid(),
  version: z.number().int().positive().optional(),
  inputsMap: z.record(z.string(), z.string()).optional(),
});

/**
 * Минимальная запись workflow, которой достаточно исполнителю под-воркфлоу.
 *
 * Структурно ей удовлетворяет `Workflow` из `src/db/schema.ts` (там есть и
 * `userId`, и служебные даты) — поэтому `WorkflowService` подходит на роль
 * {@link SubWorkflowLookup} без адаптеров и без импорта схемы БД в executor.
 */
export interface SubWorkflowRecord {
  id: string;
  name: string;
  version: number;
  nodes: NodeDto[];
  edges: EdgeDto[];
}

/**
 * Источник workflow для узла `sub_workflow`.
 *
 * Объявлен как интерфейс, а не как `WorkflowService`: executor остаётся
 * свободным от Nest-DI и БД (его тестируют без `TestingModule`), а
 * `ExecutionEngineService` передаёт в контекст настоящий сервис.
 */
export interface SubWorkflowLookup {
  findOneAsync(id: string, userId?: string): Promise<SubWorkflowRecord | null>;
}

/**
 * Контекст выполнения ветки графа для узла `sub_workflow`.
 *
 * Контекст неизменяем: при спуске в подграф создаётся новый объект с
 * дополненным `visitedWorkflows` и увеличенной `depth` — так параллельные
 * ветки одного уровня не видят чужих пометок (см.
 * `ExecutionEngineService.executeSubWorkflowGraphAsync`).
 */
export interface SubWorkflowContext {
  /** Источник workflow (в движке — `WorkflowService`). */
  readonly lookup: SubWorkflowLookup;
  /**
   * Владелец корневого запуска.
   *
   * `null` — владельца определить не удалось; в этом случае любой подграф
   * считается недоступным (404): молчаливая загрузка «без фильтра по
   * владельцу» раскрыла бы чужой workflow.
   */
  readonly rootUserId: string | null;
  /** Workflow, уже посещённые в текущей ветке (защита от рекурсии). */
  readonly visitedWorkflows: ReadonlySet<string>;
  /** Текущая глубина вложенности (0 — корневой граф). */
  readonly depth: number;
}

/** Результат загрузки подграфа: сам граф плюс метаданные ссылки. */
export interface SubWorkflowTarget {
  /** Граф под-воркфлоу (id узлов — «как в БД», без префикса). */
  subGraph: GraphDto;
  /** uuid подграфа. */
  workflowId: string;
  /** Человекочитаемое имя подграфа (для логов). */
  name: string;
  /** Версия подграфа в БД (для сравнения со снимком `data.version`). */
  version: number;
}

/** Ошибка: под-воркфлоу ссылается на workflow, уже выполняющийся в ветке. */
export class SubWorkflowRecursionException extends Error {
  /**
   * @param workflowId - uuid workflow, на который пришла повторная ссылка
   */
  constructor(workflowId: string) {
    super(`Циклическая ссылка на workflow: ${workflowId}`);
    this.name = 'SubWorkflowRecursionException';
  }
}

/** Ошибка: превышена предельная глубина вложенности под-воркфлоу. */
export class SubWorkflowDepthException extends Error {
  /** @param depth - глубина, на которой узел попытался загрузить подграф */
  constructor(depth: number) {
    super(
      `Максимальная глубина вложенности ${SUB_WORKFLOW_MAX_DEPTH} ` +
        `(попытка загрузить подграф на глубине ${depth})`,
    );
    this.name = 'SubWorkflowDepthException';
  }
}

/**
 * Загружает подграф узла `sub_workflow` (R6.7, KI-200, DESIGN v0.8 § 5.3).
 *
 * Сам граф **не выполняет**: executor возвращает описание подграфа, а
 * рекурсивный обход уровней делает `ExecutionEngineService` — только у него
 * есть доступ к `node_runs`, событиям и остальным исполнителям.
 *
 * Проверки по порядку:
 * 1. `data` проходит Zod-схему (`parseNodeData`);
 * 2. `workflowId` уже встречался в этой ветке → {@link SubWorkflowRecursionException};
 * 3. глубина достигла {@link SUB_WORKFLOW_MAX_DEPTH} → {@link SubWorkflowDepthException};
 * 4. владелец корневого запуска неизвестен или подграф ему не принадлежит →
 *    `NotFoundException` (404): чужой workflow неотличим от несуществующего,
 *    существование не раскрывается (как в `WorkflowService.findOneAsync`).
 *
 * @param data - сырые `data` узла из jsonb-графа
 * @param context - контекст ветки: доступ к workflow, владелец, стек и глубина
 * @returns подграф и его метаданные
 * @throws NodeDataValidationException если `data` не соответствуют схеме
 *   (в том числе пустой/не-uuid `workflowId`)
 * @throws SubWorkflowRecursionException при циклической ссылке
 * @throws SubWorkflowDepthException при превышении глубины вложенности
 * @throws NotFoundException если workflow не найден или принадлежит другому владельцу
 */
export async function executeSubWorkflowNode(
  data: unknown,
  context: SubWorkflowContext,
): Promise<SubWorkflowTarget> {
  const parsed = parseNodeData('sub_workflow', SubWorkflowNodeDataSchema, data);

  if (context.visitedWorkflows.has(parsed.workflowId)) {
    throw new SubWorkflowRecursionException(parsed.workflowId);
  }

  if (context.depth >= SUB_WORKFLOW_MAX_DEPTH) {
    throw new SubWorkflowDepthException(context.depth);
  }

  // Владельца нет — считаем подграф недоступным: `findOneAsync` без фильтра по
  // владельцу вернул бы чужой workflow (RULES 5.1 — доступ только свои).
  if (context.rootUserId === null) {
    throw new NotFoundException(`Workflow ${parsed.workflowId} не найден`);
  }

  const workflow = await context.lookup.findOneAsync(
    parsed.workflowId,
    context.rootUserId,
  );

  // Чужой workflow неотличим от несуществующего: 404, а не 403 (DESIGN § 5,
  // тот же приём, что в `WorkflowService.exportAsync`).
  if (workflow === null) {
    throw new NotFoundException(`Workflow ${parsed.workflowId} не найден`);
  }

  return {
    subGraph: { nodes: workflow.nodes, edges: workflow.edges },
    workflowId: workflow.id,
    name: workflow.name,
    version: workflow.version,
  };
}

/**
 * Добавляет к id узлов и связей подграфа префикс `sub_<nodeId>__` (DESIGN § 5.3).
 *
 * Префикс изолирует строки `node_runs` подграфа от строк родительского графа:
 * `node_runs` уникален по (`run_id`, `node_id`), а id узлов внутри workflow
 * произвольны и в родителе могут совпасть. Вложенный под-воркфлоу получает
 * префикс дважды (`sub_A__sub_B__node`) — id остаётся уникальным на любой
 * глубине.
 *
 * @param graph - граф под-воркфлоу с исходными id
 * @param nodeId - id узла `sub_workflow` в родительском графе
 * @returns копия графа с префиксованными id узлов и связей
 */
export function prefixSubWorkflowGraph(graph: GraphDto, nodeId: string): GraphDto {
  const prefix = `sub_${nodeId}__`;

  return {
    nodes: graph.nodes.map((node) => ({ ...node, id: `${prefix}${node.id}` })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      // id связи тоже префиксуем: он участвует в fallback-ключе входа для
      // узлов без контракта портов (KI-003), и дубли между подграфами
      // склеили бы входы разных узлов.
      id: `${prefix}${edge.id}`,
      source: `${prefix}${edge.source}`,
      target: `${prefix}${edge.target}`,
    })),
  };
}
