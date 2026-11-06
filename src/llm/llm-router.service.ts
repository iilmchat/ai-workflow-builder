import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmProviderException,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
} from './llm-provider.interface.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmRegistryService } from './llm-registry.service.js';
import {
  createProviderSemaphoreRegistry,
  type ProviderSemaphoreRegistry,
} from './provider-semaphore.js';
import { withSpanAsync, type TraceSpan } from '../observability/tracing.js';

/**
 * Таймаут одного вызова LLM (RULES 4.19, KI-088).
 *
 * Ставится **на каждую попытку**, а не на весь маршрут: иначе таймаут
 * локального LM Studio истёк бы вместе с signal, и fallback-вызов в облако
 * стартовал бы уже отменённым. Явный `options.signal` вызывающего кода имеет
 * приоритет и общий для обеих попыток — это отмена пользователя, а не
 * технический таймаут.
 */
const LLM_TIMEOUT_MS = 60_000;

/** Модель облачного fallback по умолчанию (DESIGN V120 § 3.1). */
const DEFAULT_FALLBACK_MODEL = 'gpt-4o-mini';

/** Маршрут вызова: провайдер и модель, которая уйдёт в upstream. */
interface LlmRoute {
  /** Провайдер, обслуживающий вызов. */
  provider: ILlmProvider;
  /** id модели, который получит провайдер. */
  model: string;
}

/** Результат одной попытки вызова с временем ожидания слота. */
interface LlmAttempt {
  /** Ответ провайдера. */
  result: LlmGenerateResult;
  /** Сколько миллисекунд занял вызов, включая ожидание семафора. */
  waitMs: number;
}

/**
 * Читает boolean-флаг из `ConfigService` строго (RULES 4.35).
 *
 * `z.coerce.boolean()` превращает строку `'false'` в `true`; здесь значение
 * принимается только как boolean или литералы `'true'`/`'false'`. Всё
 * остальное (включая отсутствие переменной) — `fallback`. В штатном пути
 * `validateEnv` уже применил Zod-схему, поэтому сюда попадает boolean.
 *
 * @param config - доступ к env (может отсутствовать в тестах)
 * @param key - имя переменной
 * @param fallback - значение по умолчанию
 * @returns разобранный флаг
 */
function readBooleanFlag(
  config: ConfigService | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = config?.get<unknown>(key);

  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
}

/**
 * Читает непустую строку из `ConfigService`.
 *
 * @param config - доступ к env (может отсутствовать в тестах)
 * @param key - имя переменной
 * @param fallback - значение по умолчанию
 * @returns trimmed-значение либо `fallback`
 */
function readString(
  config: ConfigService | undefined,
  key: string,
  fallback: string,
): string {
  const value = config?.get<unknown>(key);

  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Приводит неизвестную ошибку к тексту для лога (RULES 5.9: промпт не пишем).
 *
 * @param error - значение из `catch`
 * @returns сообщение ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Умный роутер LLM-вызовов: локальный GPU-бэкенд → облачный fallback
 * (v1.2 S1, DESIGN V120 § 3.1).
 *
 * Логика при `LLM_ROUTER_ENABLED=true`:
 * 1. Если сконфигурирован локальный провайдер (LM Studio) и healthcheck не
 *    пометил его недоступным — вызов идёт в него;
 * 2. ошибка локального вызова (сеть, 5xx, таймаут, пустой ответ) — WARN и
 *    повтор в облако моделью `LLM_ROUTER_FALLBACK_MODEL`;
 * 3. локального провайдера нет или он помечен `unavailable` — сразу облако.
 *
 * При `LLM_ROUTER_ENABLED=false` (дефолт) поведение прежнее: провайдер
 * резолвится по id модели, как до v1.2.
 *
 * Здесь же живут семафоры провайдеров (R7.7, KI-067) и span `llm.call`
 * (KI-365): span должен охватывать и попытку, и fallback, а семафор — именно
 * фактически использованного провайдера. Поэтому `LlmService` делегирует сюда
 * весь вызов, а не только выбор провайдера.
 *
 * Промпты в логи не пишутся: WARN содержит только имя/модель провайдера и
 * текст ошибки (RULES 5.9).
 */
@Injectable()
export class LlmRouterService {
  private readonly logger = new Logger(LlmRouterService.name);

  /** Включён ли роутинг на локальный бэкенд (`LLM_ROUTER_ENABLED`). */
  private readonly enabled: boolean;

  /** Модель облачного fallback (`LLM_ROUTER_FALLBACK_MODEL`). */
  private readonly fallbackModel: string;

  /** Лимиты одновременных вызовов по провайдерам (R7.7, KI-067). */
  private readonly semaphores: ProviderSemaphoreRegistry;

  /**
   * @param registry - реестр провайдеров (резолв по модели и поиск локального)
   * @param health - healthcheck LM Studio; `@Optional()` — в юнит-тестах его
   *   может не быть, тогда роутер пингует провайдера напрямую
   * @param config - доступ к env (RULES 4.6); `@Optional()` — тесты создают
   *   сервис без `ConfigModule`, тогда действуют дефолты (роутер выключен)
   */
  constructor(
    private readonly registry: LlmRegistryService,
    @Optional() private readonly health?: LlmHealthService,
    @Optional() config?: ConfigService,
  ) {
    this.enabled = readBooleanFlag(config, 'LLM_ROUTER_ENABLED', false);
    this.fallbackModel = readString(
      config,
      'LLM_ROUTER_FALLBACK_MODEL',
      DEFAULT_FALLBACK_MODEL,
    );
    this.semaphores = createProviderSemaphoreRegistry(
      config === undefined
        ? undefined
        : { get: (key: string) => config.get<unknown>(key) },
    );
  }

  /**
   * Текущее значение флага `LLM_ROUTER_ENABLED` (KI-618).
   *
   * Нужно ручке `GET /llm/health`: UI-индикатор по этому полю объясняет,
   * участвует ли локальный GPU в маршрутизации; при выключенном роутере
   * healthcheck локального провайдера на вызовы не влияет. Значение читается
   * один раз при создании сервиса: env меняется только рестартом процесса.
   *
   * @returns `true`, если включён маршрут «локальный → облачный»
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Вызывает LLM по маршруту «локальный → облачный».
   *
   * @param prompt - пользовательский промпт (в логи целиком не попадает)
   * @param options - модель, system, лимиты, отмена; `model` обязателен
   * @returns текст ответа и метрики с фактическим флагом `isLocal`
   * @throws LlmProviderException если маршрут не удалось построить или
   *   провайдер вернул ошибку
   */
  async generateAsync(
    prompt: string,
    options: LlmGenerateOptions,
  ): Promise<LlmGenerateResult> {
    // R7.7 (KI-365): один span на весь маршрут, включая ожидание слота и
    // fallback; атрибуты фактического провайдера проставляются после вызова.
    return withSpanAsync(
      'llm.call',
      { 'llm.model': options.model, 'llm.local': false },
      (span) => this.routeAsync(prompt, options, span),
    );
  }

  /**
   * Выполняет вызов по выбранному маршруту.
   *
   * @param prompt - пользовательский промпт
   * @param options - опции вызова
   * @param span - span `llm.call` для атрибутов фактического маршрута
   * @returns результат вызова
   */
  private async routeAsync(
    prompt: string,
    options: LlmGenerateOptions,
    span: TraceSpan,
  ): Promise<LlmGenerateResult> {
    if (!this.enabled) {
      const provider = this.registry.resolveByModel(options.model);
      const attempt = await this.callAsync(
        provider,
        prompt,
        options,
        options.model,
      );

      this.recordSpan(span, provider, options.model, attempt);

      return { ...attempt.result, isLocal: provider.isLocal ?? false };
    }

    const local = this.registry.findLocalProvider();

    if (local) {
      const available = await this.isLocalAvailableAsync(local);

      if (available) {
        let localModel = options.model;

        try {
          localModel = this.pickLocalModel(local, options.model);

          const attempt = await this.callAsync(
            local,
            prompt,
            options,
            localModel,
          );

          this.recordSpan(span, local, localModel, attempt);

          return { ...attempt.result, isLocal: true };
        } catch (error: unknown) {
          // Отмена пользователя — не повод идти в облако: signal общий.
          if (options.signal?.aborted === true) {
            throw error;
          }

          this.logger.warn(
            `LM Studio: вызов модели "${localModel}" не удался (${toMessage(error)}) — fallback на облачную модель "${this.fallbackModel}"`,
          );
        }
      } else {
        // Healthcheck уже писал WARN при смене статуса; здесь — debug, чтобы
        // выключенный LM Studio не спамил WARN на каждый LLM-вызов.
        this.logger.debug(
          `LM Studio помечен недоступным — вызов уходит в облако ("${this.fallbackModel}")`,
        );
      }
    }

    const route = this.resolveCloudRoute(options.model);
    const attempt = await this.callAsync(
      route.provider,
      prompt,
      options,
      route.model,
    );

    this.recordSpan(span, route.provider, route.model, attempt);

    return { ...attempt.result, isLocal: false };
  }

  /**
   * Проверяет доступность локального провайдера.
   *
   * Если healthcheck подключён, используется его кэш статуса (без пинга на
   * каждый вызов); иначе — прямой пинг провайдера (тесты, ручная сборка).
   *
   * @param local - локальный провайдер
   * @returns `true`, если вызов в него имеет смысл
   */
  private isLocalAvailableAsync(local: ILlmProvider): Promise<boolean> {
    if (this.health !== undefined) {
      return this.health.isAvailableAsync();
    }

    return local.isAvailableAsync();
  }

  /**
   * Выбирает модель для локального вызова.
   *
   * Если пользователь выбрал модель, которую LM Studio объявил, — она и
   * уходит. Иначе берётся первая модель локального каталога: id облачных
   * моделей (`gpt-4o-mini`, `claude-*`) в LM Studio отсутствуют, и отправка
   * такого id гарантированно вернула бы 400/404. Это осознанная подмена —
   * см. KI-617.
   *
   * @param local - локальный провайдер
   * @param requestedModel - модель, выбранная в графе/агенте
   * @returns id модели, которую понимает LM Studio
   * @throws LlmProviderException если локальный провайдер не объявил моделей
   */
  private pickLocalModel(
    local: ILlmProvider,
    requestedModel: string,
  ): string {
    if (local.models.some((model) => model.id === requestedModel)) {
      return requestedModel;
    }

    const first = local.models[0];

    if (first === undefined) {
      throw new LlmProviderException(
        'router',
        `локальный провайдер "${local.name}" не объявил ни одной модели`,
      );
    }

    this.logger.debug(
      `Модель "${requestedModel}" не объявлена LM Studio — использую локальную "${first.id}"`,
    );

    return first.id;
  }

  /**
   * Строит облачный маршрут для fallback.
   *
   * Приоритет:
   * 1. `LLM_ROUTER_FALLBACK_MODEL`, если модель объявлена облачным провайдером
   *    (локальный не подходит — мы как раз уходим с локального);
   * 2. первая модель первого облачного провайдера — с WARN, потому что это
   *    подмена модели из env;
   * 3. ошибка: облака нет вовсе.
   *
   * @param requestedModel - исходная модель (для текста ошибки и лога)
   * @returns облачный маршрут
   * @throws LlmProviderException если облачный провайдер не сконфигурирован
   */
  private resolveCloudRoute(requestedModel: string): LlmRoute {
    if (this.registry.hasModel(this.fallbackModel)) {
      const provider = this.registry.resolveByModel(this.fallbackModel);

      if (provider.isLocal !== true) {
        return { provider, model: this.fallbackModel };
      }
    }

    const provider = this.registry.findCloudProvider();
    const model = provider?.models[0]?.id;

    if (provider === undefined || model === undefined) {
      throw new LlmProviderException(
        'router',
        `нет облачного провайдера для fallback (запрошена модель "${requestedModel}")`,
      );
    }

    this.logger.warn(
      `Модель fallback "${this.fallbackModel}" не поддерживается — использую "${model}" (${provider.name})`,
    );

    return { provider, model };
  }

  /**
   * Выполняет одну попытку под семафором провайдера.
   *
   * Таймаут создаётся заново на каждую попытку (см. {@link LLM_TIMEOUT_MS});
   * явный signal вызывающего кода сохраняется.
   *
   * @param provider - провайдер попытки
   * @param prompt - пользовательский промпт
   * @param options - опции вызова
   * @param model - модель, которую получит провайдер
   * @returns ответ и время ожидания/вызова
   * @throws LlmProviderException ошибку провайдера без переоборачивания
   */
  private async callAsync(
    provider: ILlmProvider,
    prompt: string,
    options: LlmGenerateOptions,
    model: string,
  ): Promise<LlmAttempt> {
    const startedAt = Date.now();
    const signal = options.signal ?? AbortSignal.timeout(LLM_TIMEOUT_MS);

    const result = await this.semaphores.runAsync(provider.name, () =>
      provider.generateAsync(prompt, { ...options, signal, model }),
    );

    return { result, waitMs: Date.now() - startedAt };
  }

  /**
   * Проставляет атрибуты span'а фактического маршрута (KI-365).
   *
   * @param span - span `llm.call`
   * @param provider - провайдер, обслуживший вызов
   * @param model - модель, ушедшая в upstream
   * @param attempt - результат попытки и время ожидания
   */
  private recordSpan(
    span: TraceSpan,
    provider: ILlmProvider,
    model: string,
    attempt: LlmAttempt,
  ): void {
    span.setAttribute('llm.provider', provider.name);
    span.setAttribute('llm.local', provider.isLocal ?? false);
    span.setAttribute('llm.model_used', model);
    span.setAttribute('llm.wait_ms', attempt.waitMs);
    span.setAttribute('llm.input_tokens', attempt.result.usage?.inputTokens ?? null);
    span.setAttribute(
      'llm.output_tokens',
      attempt.result.usage?.outputTokens ?? null,
    );
    span.setAttribute(
      'llm.cache_read_tokens',
      attempt.result.usage?.cacheReadTokens ?? null,
    );
  }
}
