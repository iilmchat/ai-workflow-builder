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

/** Схема аргументов `http_request`. */
const HttpRequestInputSchema = z.object({
  // Метод ограничен теми же четырьмя, что у узла `http` (R6.5.1/KI-105):
  // PATCH/HEAD не поддержаны исполнителем узла, не расширяем их и здесь.
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  url: z.url('url должен быть абсолютным http(s)-адресом'),
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
