/**
 * Типы agent-узла и его цикла (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Здесь живут **только** контракты: массив шагов, интерфейс инструмента,
 * контекст выполнения инструмента, данные узла и исключения. Реализации —
 * в `agent-tools.ts` (реестр из семи инструментов) и `agent.service.ts`
 * (сам цикл LLM → tool → … → final).
 *
 * Модуль намеренно не зависит от Nest и от БД: его импортируют и исполнитель
 * узла (`node-executors.ts`), и сервис, и тесты. Единственная «внешняя»
 * зависимость — структурные типы хранилища из `node-executors.ts`; импорт
 * только типовый, поэтому runtime-цикла между модулями нет.
 */
import type { ZodType } from 'zod';
import type { LlmUsage } from '../llm/llm-provider.interface.js';
import type { McpToolRef } from '../mcp/mcp.types.js';
import type {
  VectorMatch,
  VectorMemoryStore,
} from '../engine/node-executors.js';

/**
 * Имена инструментов агента (DESIGN v0.9 § 3.4).
 *
 * Список — единственный источник правды для backend-схемы узла: Zod-схема
 * `AgentNodeDataSchema` строится из него, поэтому «неизвестный инструмент»
 * отсекается ещё на валидации `data`, а не в середине цикла.
 */
export const AGENT_TOOL_NAMES = [
  'http_request',
  'vector_query',
  'vector_upsert',
  'memory_read',
  'memory_write',
  'code_eval',
  'llm_call',
] as const;

/** Имя инструмента агента. */
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** Лимит итераций по умолчанию (DESIGN § 3.4, env `AGENT_MAX_ITERATIONS_DEFAULT`). */
export const AGENT_DEFAULT_MAX_ITERATIONS = 5;

/** Лимит токенов на шаг по умолчанию (env `AGENT_MAX_TOKENS_PER_STEP_DEFAULT`). */
export const AGENT_DEFAULT_MAX_TOKENS_PER_STEP = 2048;

/**
 * Верхняя граница итераций.
 *
 * Совпадает с UI-диапазоном (1–10): больше десяти шагов агента — это или
 * зацикливание модели, или задача, которую в workflow решают явным графом.
 */
export const AGENT_MAX_ITERATIONS_LIMIT = 10;

/** Верхняя граница токенов на шаг: защита от «случайного» значения в `data`. */
export const AGENT_MAX_TOKENS_PER_STEP_LIMIT = 8192;

/**
 * Данные узла `agent` (DESIGN § 3.4).
 *
 * Поля приходят из jsonb-графа как `unknown` и нормализуются Zod-схемой в
 * исполнителе (`executeAgentNodeAsync`). Здесь — уже проверенная форма.
 */
export interface AgentNodeData {
  /** Дискриминатор типа узла. */
  readonly kind: 'agent';
  /** id модели, которая ведёт цикл (провайдер резолвится `LlmService`). */
  readonly model: string;
  /** Пользовательская системная инструкция; добавляется перед протоколом. */
  readonly systemPrompt?: string;
  /** Включённые инструменты: от 0 до {@link AGENT_TOOL_NAMES}.length. */
  readonly tools: readonly AgentToolName[];
  /**
   * MCP-инструменты узла (v0.11 S7, DESIGN § 3.2.5).
   *
   * Узел хранит **имена** сервера и инструмента, а не URL: реестр серверов
   * задаётся только оператором в env `MCP_SERVERS` (DESIGN § 2.3). Вместе с
   * `tools` должен давать хотя бы один инструмент; суммарный предел — 20
   * ({@link MCP_MAX_TOOLS_PER_NODE_LIMIT}). `undefined` трактуется как пустой
   * список — старые узлы и прямые вызовы сервиса остаются совместимыми.
   */
  readonly mcpTools?: readonly McpToolRef[];
  /** Предел итераций цикла; default — {@link AGENT_DEFAULT_MAX_ITERATIONS}. */
  readonly maxIterations?: number;
  /** Лимит токенов ответа на шаг; default — {@link AGENT_DEFAULT_MAX_TOKENS_PER_STEP}. */
  readonly maxTokensPerStep?: number;
}

/**
 * Вызов инструмента, который вернула модель.
 *
 * `id` нужен для сообщения `role: 'tool'`: протокол chat-completions связывает
 * результат с конкретным вызовом, и без него модель не понимает, на какой
 * запрос отвечает транскрипт.
 */
export interface AgentToolCall {
  /** Идентификатор вызова внутри итерации (`call_<iteration>`). */
  readonly id: string;
  /** Имя инструмента (проверяется по реестру и списку включённых). */
  readonly name: string;
  /** Аргументы вызова; валидируются Zod-схемой инструмента. */
  readonly input: unknown;
}

/**
 * Шаг выполнения агента — единица timeline в UI и строка в `node_runs.logs`.
 *
 * Размеченное объединение (DESIGN § 3.4): LLM-шаг несёт промпт и usage,
 * tool-шаг — имя, вход, выход и (при сбое) текст ошибки, final-шаг — ответ.
 */
export type AgentStep =
  | {
      /** Шаг обращения к модели. */
      kind: 'llm';
      /** Транскрипт, фактически отправленный провайдеру на этой итерации. */
      prompt: string;
      /** Метрики вызова; при отсутствии usage у провайдера — нули/null. */
      usage: LlmUsage;
    }
  | {
      /** Шаг выполнения инструмента. */
      kind: 'tool';
      /** Имя инструмента. */
      name: string;
      /** Валидированный вход инструмента. */
      input: unknown;
      /** Результат инструмента (`null`, если выполнение упало). */
      output: unknown;
      /** Текст ошибки инструмента; отсутствует при успехе. */
      error?: string;
    }
  | {
      /** Финальный ответ агента. */
      kind: 'final';
      /** Текст, который уйдёт в выход узла `result`. */
      answer: string;
    };

/**
 * Сообщение транскрипта агента.
 *
 * Формат — **OpenAI chat-completions** (`role` + `content` + `tool_calls` /
 * `tool_call_id`), а не Anthropic content-blocks. Причина: `ILlmProvider`
 * принимает плоский `prompt: string` и не умеет нативные `tools`, поэтому
 * транскрипт сериализуется в текст. OpenAI-форма выбрана как де-факто
 * стандарт JSON-транскрипта: её понимают модели всех провайдеров, и при
 * появлении нативного tool-calling (v0.10) её можно передать провайдеру
 * без переписывания цикла (см. отчёт R7.4b, § 7).
 */
export type AgentMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly tool_calls?: readonly AgentToolCall[];
    }
  | {
      readonly role: 'tool';
      readonly tool_call_id: string;
      readonly content: string;
    };

/**
 * Контекст выполнения инструмента.
 *
 * Зависимости передаются сюда, а не в конструктор инструмента: реестр
 * (`TOOL_REGISTRY`) остаётся обычной константой без DI, а тесты подставляют
 * моки (хранилище, fetch, песочницу) в одном месте.
 */
export interface AgentToolContext {
  /** uuid запуска (для логов и будущих ограничений по run). */
  readonly runId: string;
  /** id узла в графе (для логов). */
  readonly nodeId: string;
  /** Владелец векторов и памяти — workflow запуска. */
  readonly workflowId: string;
  /** Модель агента: дефолт для инструмента `llm_call`. */
  readonly model: string;
  /** Хранилище vector/memory (`VectorStoreService` в продакшене). */
  readonly store: VectorMemoryStore;
  /**
   * Эмбеддинг текстов (провайдер резолвится лениво).
   *
   * @param texts - тексты для векторизации
   * @param model - id модели эмбеддингов
   * @returns векторы в порядке `texts`
   */
  readonly embedAsync: (texts: string[], model: string) => Promise<number[][]>;
  /**
   * Вызов LLM для инструмента `llm_call`.
   *
   * @param prompt - пользовательский промпт
   * @param model - id модели
   * @returns текст ответа и метрики (usage может быть `null`)
   */
  readonly llmGenerateAsync: (
    prompt: string,
    model: string,
  ) => Promise<{ text: string; usage: LlmUsage | null }>;
  /**
   * WASM-песочница для инструмента `code_eval`.
   *
   * Структурный контракт `QuickJsRunnerService.evaluateSandboxedAsync`.
   */
  readonly sandbox: {
    /**
     * @param expression - JS-выражение
     * @param input - значение входа
     * @returns результат либо текст ошибки
     */
    evaluateSandboxedAsync(
      expression: string,
      input: unknown,
    ): Promise<{ result: unknown; error?: string }>;
  };
  /** HTTP-клиент для `http_request` (в продакшене — глобальный `fetch`). */
  readonly fetchAsync: typeof fetch;
  /**
   * Резолвер DNS для проверки SSRF (KI-409).
   *
   * Инструмент `http_request` обязан проверить **фактический** адрес после
   * резолва: строка `https://internal.example` может указывать на
   * `10.0.0.5`. В продакшене — `dns.lookup` (`defaultDnsLookupAsync` в
   * `common/utils/network-safety.ts`), в тестах — мок, чтобы не ходить в сеть.
   *
   * Отсутствие поля — «использовать реальный `dns.lookup`»: контракт остаётся
   * обратно совместимым для тестов и альтернативных реализаций.
   */
  readonly dnsLookupAsync?: (hostname: string) => Promise<readonly string[]>;
  /**
   * Пропускать ли приватные/локальные адреса в `http_request` (v0.10.2).
   *
   * Читается из env `ALLOW_PRIVATE_IPS` (default `false`). `true` — осознанное
   * выключение SSRF-защиты для локальной разработки/тестов; отсутствие поля
   * трактуется как `false` (fail closed).
   */
  readonly allowPrivateIps?: boolean;
}

/**
 * Инструмент агента (DESIGN § 3.4).
 *
 * `inputSchema` — Zod-схема: аргументы приходят от модели, то есть являются
 * внешними данными и валидируются на границе (RULES 1.17). `executeAsync`
 * с суффиксом `Async` по RULES 1.4.
 */
export interface AgentTool {
  /**
   * Имя инструмента.
   *
   * Нативные инструменты используют {@link AgentToolName}; MCP-инструменты —
   * динамическую строку `mcp__<server>__<tool>` (DESIGN § 3.2.5), поэтому тип
   * расширен до `string`. `AgentToolName` остаётся типом **нативных** имён и
   * используется в `TOOL_REGISTRY`/Zod-схеме узла.
   */
  readonly name: string;
  /** Описание для системного промпта и UI. */
  readonly description: string;
  /** Схема аргументов; `.parse()` бросает ZodError на мусоре. */
  readonly inputSchema: ZodType<unknown>;
  /**
   * MCP-подсказка «инструмент только читает данные» (v0.11 S7, DESIGN § 3.3.2).
   *
   * Используется retry-политикой: read-only MCP-инструмент не считается
   * побочным эффектом, поэтому узел можно повторить. У нативных инструментов
   * поле отсутствует — их классификация зашита в `AgentService`.
   */
  readonly readOnlyHint?: boolean;
  /** MCP-подсказка «инструмент может изменять внешние данные». */
  readonly destructiveHint?: boolean;
  /** MCP-подсказка «повторный вызов идемпотентен». */
  readonly idempotentHint?: boolean;
  /** MCP-подсказка «инструмент работает с внешним миром». */
  readonly openWorldHint?: boolean;
  /**
   * Выполняет инструмент.
   *
   * @param input - аргументы от модели (валидируются `inputSchema`)
   * @param context - зависимости и идентификаторы запуска
   * @returns произвольный JSON-результат (уходит в транскрипт и в шаг)
   * @throws Error если аргументы невалидны или выполнение упало
   */
  executeAsync(input: unknown, context: AgentToolContext): Promise<unknown>;
}

/** Суммарный usage цикла агента. */
export interface AgentUsage {
  /** Сумма входных токенов по шагам (`null`, если провайдер их не отдал). */
  readonly inputTokens: number | null;
  /** Сумма выходных токенов по шагам (`null`, если провайдер их не отдал). */
  readonly outputTokens: number | null;
}

/**
 * Результат выполнения агента (DESIGN § 3.4).
 *
 * `iterations` — сколько LLM-шагов реально сделано (1…maxIterations),
 * `usage` — сумма токенов, `steps` — timeline для панели и логов.
 */
export interface AgentRunResult {
  /** Финальный ответ (он же выход узла `result`). */
  readonly answer: string;
  /** Все шаги в порядке выполнения. */
  readonly steps: AgentStep[];
  /** Число выполненных итераций LLM. */
  readonly iterations: number;
  /** Суммарные токены по всем итерациям. */
  readonly usage: AgentUsage;
  /**
   * Входные токены для `node_runs.tokens_in` (KI-407).
   *
   * Дублирует `usage.inputTokens` отдельным полем: исполнителю узла нужен
   * плоский контракт метрик (`tokensIn`/`tokensOut`/`costUsd`), как у
   * `LlmNodeMetrics`, чтобы записать их в `node_runs` без разбора шагов.
   * Если часть шагов не отдала токены, возвращается сумма известных;
   * `null` — токенов не отдал ни один шаг.
   */
  readonly tokensIn: number | null;
  /**
   * Выходные токены для `node_runs.tokens_out` (KI-407).
   *
   * @see tokensIn
   */
  readonly tokensOut: number | null;
  /**
   * Стоимость цикла в USD для `node_runs.cost_usd` (KI-407).
   *
   * Сумма стоимостей LLM-шагов по прайсу (`calculateCostUsd`). `0` — вызов
   * обслужен локальным провайдером (бесплатно), `null` — цену посчитать
   * нельзя: модели нет в прайсе или провайдер не отдал usage (KI-052).
   * Если часть шагов оценена, а часть — нет, возвращается сумма известных:
   * «частичная» стоимость полезнее для бюджета, чем `null` на всё.
   */
  readonly costUsd: number | null;
}

/**
 * Ошибка: агент исчерпал лимит итераций, не дойдя до финального ответа.
 *
 * Наследуется от `Error` (не Nest `HttpException`): исключение возникает в
 * worker'е и должно перевести узел в `failed`, а запуск — в `failed`, с
 * понятным текстом (RULES 1.7).
 */
export class AgentIterationLimitException extends Error {
  /** Сколько итераций было выполнено до отказа. */
  readonly iterations: number;

  /**
   * @param iterations - выполненное число итераций (оно же лимит)
   * @param steps - шаги, сделанные до отказа (для диагностики в тексте)
   */
  constructor(iterations: number, steps: readonly AgentStep[] = []) {
    const tools = steps.filter((step) => step.kind === 'tool').length;

    super(
      `Агент исчерпал лимит итераций (${iterations}): финальный ответ не получен ` +
        `(вызовов инструментов: ${tools})`,
    );
    this.name = 'AgentIterationLimitException';
    this.iterations = iterations;
  }
}

/**
 * Ошибка: запуск агента прерван, повтор узла небезопасен (v0.11 S7).
 *
 * Появляется из retry-guard'а `AgentService` (DESIGN § 3.3.2): если во время
 * цикла уже выполнялся инструмент с побочным эффектом, повтор всего узла
 * повторно выполнит его (запись файла, HTTP POST, клик в браузере). Ошибка
 * non-retryable: движок не увидит ни `LlmProviderException.retryable`, ни
 * `RetryableNodeException` и не повторит узел.
 */
export class AgentRunException extends Error {
  /**
   * @param message - текст ошибки для пользователя/лога
   * @param options - стандартные опции `Error` (в первую очередь `cause`)
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentRunException';
  }
}

/**
 * Структурный тип хранилища, которое используют инструменты.
 *
 * Псевдоним нужен, чтобы импорт из `node-executors.ts` был явным и
 * тесты могли собрать контекст без реального `VectorStoreService`.
 */
export type AgentVectorStore = VectorMemoryStore;

/**
 * Совпадение векторного поиска в ответе инструмента `vector_query`.
 *
 * Реэкспорт: потребителю шага не нужно тянуть `node-executors.ts` ради типа.
 */
export type AgentVectorMatch = VectorMatch;
