/**
 * Исполнители узлов: преобразование `data` (+ входы) → outputs.
 *
 * `llm` здесь нет — с R3 узел ходит во внешний провайдер, поэтому живёт
 * в `src/llm/llm-node-executor.service.ts` (DI + `LlmService`). Здесь остаются
 * чистые преобразования (`text`, `condition`, `output`, `compare`), сетевой
 * `http` (R6.5.1, KI-105) и заглушка `image_generation` (R4).
 *
 * Правило для `data`: она приходит из jsonb-графа как `unknown` и валидируется
 * Zod'ом **внутри исполнителя**, а не в `NodeDto` (там `data` — свободный
 * `Record<string, unknown>`). Так строгая схема конкретного типа узла не ломает
 * forward-compat: UI может добавлять свои поля (`selected`, `measured`, …),
 * не роняя запуск (RULES 1.17 / 4.15).
 */
import { z } from 'zod';
import type { NodeDto } from './dto/index.js';
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

/**
 * Типы узлов-аннотаций (комментарии/стикеры, KI-266).
 *
 * Не участвуют в потоке выполнения: не попадают в executionMap/levels,
 * не создают node_runs. Хранятся в графе (workflows.nodes jsonb),
 * переносятся между Save/Load — но игнорируются при Run.
 *
 * Новые типы R6.5.1 (`http`, `condition`, `output`, `compare`) сюда **не**
 * входят: это исполняемые узлы, а не заметки на холсте.
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
 * Исполнитель узла `http` (KI-105, RULES 4.19 / 5.9).
 *
 * Запрос уходит через глобальный `fetch` (Node 18+) с жёстким таймаутом
 * `AbortSignal.timeout`. Коды 4xx/5xx **не** считаются ошибкой узла: узел
 * возвращает `{ status, body }`, а решение «это провал» принимает граф
 * (например, узел `condition`). Наружу пробрасываются только сетевые ошибки
 * и таймаут — движок запишет их в `node_runs.error`.
 *
 * Тело и заголовки запроса сознательно не логируются: в них попадают токены
 * авторизации (RULES 5.9).
 *
 * @param data - распарсенные данные узла (`method`/`url`/`headers`/`body`/`timeoutMs`)
 * @param inputs - входы узла; `inputs.prompt` используется как URL-фолбэк
 * @returns `{ status, body }`, где `body` обрезано до 1 МБ
 * @throws NodeDataValidationException если данные не проходят Zod-схему
 * @throws Error если URL не задан или запрос прерван по таймауту
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
  // — jsonb, и мегабайтные ответы не должны раздувать БД (KI-025).
  const rawBody = await response.text();

  return { status: response.status, body: truncateToBytes(rawBody, HTTP_MAX_BODY_BYTES) };
}

/* ──────────────── Узел condition (MVP, без маршрутизации) ──────────────── */

/** Поддержанные операции MVP-DSL (DESIGN § 8.2, § 14 — решение 4). */
export type ConditionOperator = '>' | '<' | '>=' | '<=' | '===' | 'includes';

/** Данные узла `condition`. */
export interface ConditionNodeData {
  /** Левая часть: `input.X` либо литерал. */
  left: string;
  /** Операция сравнения MVP-DSL. */
  operator: ConditionOperator;
  /** Правая часть: `input.X` либо литерал. */
  right: string;
}

/** Zod-схема данных узла `condition`. */
const ConditionNodeDataSchema = z.object({
  left: z.string().min(1, 'left обязателен'),
  operator: z.enum(['>', '<', '>=', '<=', '===', 'includes']),
  right: z.string().min(1, 'right обязателен'),
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
 * Вычисляет условие узла `condition` (MVP, DESIGN § 14 — без sandbox).
 *
 * Маршрутизация веток в этом подшаге **не** реализуется: узел просто отдаёт
 * `outputs = { result }`, а обе ветки продолжают выполняться на уровне движка.
 * Пропуск узлов непройденной ветки — отдельная задача v0.8.x (требует правок
 * `buildExecutionPlanAsync` + `executeAsync`).
 *
 * @param data - данные узла (`left`/`operator`/`right`)
 * @param inputs - собранные входы узла (`inputs.prompt`, `inputs.text`, …)
 * @returns `{ result, evaluated }`, где `evaluated` — разрешённые операнды
 * @throws NodeDataValidationException если данные не проходят Zod-схему
 * @throws Error если операция неприменима к типам операндов
 */
export function executeConditionNode(
  data: unknown,
  inputs: Record<string, unknown> = {},
): { result: boolean; evaluated: { left: unknown; right: unknown } } {
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
