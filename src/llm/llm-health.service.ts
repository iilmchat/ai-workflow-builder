import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ILlmProvider } from './llm-provider.interface.js';
import { LlmRegistryService } from './llm-registry.service.js';

/**
 * Период проверки LM Studio (мс), v1.2 S1, DESIGN V120 § 3.2.
 *
 * Зафиксирован постановкой: раз в 30 секунд. Значение — константа, а не env:
 * операторских сценариев «почаще/пореже» пока нет, а лишняя переменная
 * окружения расширяет поверхность конфигурации.
 */
export const LLM_HEALTH_INTERVAL_MS = 30_000;

/**
 * Сколько подряд неудачных проверок переводят провайдера в `unavailable`.
 *
 * Три, а не одна: одиночный таймаут при загрузке модели или коротком
 * зависании сервера не должен выключать GPU-бэкенд из роутинга.
 */
export const LLM_HEALTH_FAILURE_THRESHOLD = 3;

/** Статус локального LLM-бэкенда (v1.2 S1). */
export type LlmHealthStatus =
  /** Проверок ещё не было (старт приложения) либо все попытки были неудачны, но порог не достигнут. */
  | 'unknown'
  /** Последняя проверка успешна. */
  | 'available'
  /** Порог подряд неудачных проверок достигнут: локальный провайдер выключен из роутинга. */
  | 'unavailable';

/**
 * Healthcheck локального LLM-бэкенда (LM Studio), v1.2 S1, DESIGN V120 § 3.2.
 *
 * Раз в {@link LLM_HEALTH_INTERVAL_MS} пингует `LMStudioProvider.isAvailableAsync()`
 * (`GET {baseURL}/models`). После {@link LLM_HEALTH_FAILURE_THRESHOLD} неудач
 * подряд статус становится `unavailable`, и `LlmRouterService` перестаёт
 * пытаться использовать GPU — вызовы сразу уходят в облако. Успешная проверка
 * возвращает провайдера в роутинг.
 *
 * Таймер создаётся через `setInterval` и **не удерживает процесс живым**
 * (`unref()`): healthcheck — фоновая задача, и приложение должно завершаться,
 * даже если интервал ещё не сработал (RULES 4.12). Таймер снимается в
 * `onModuleDestroy`.
 *
 * Статус намеренно in-memory: healthcheck — свойство процесса, который
 * вызывает LM Studio. При нескольких backend-инстансах каждый проверяет сервер
 * сам (см. KI-620).
 */
@Injectable()
export class LlmHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmHealthService.name);

  /** Текущий статус локального провайдера. */
  private status: LlmHealthStatus = 'unknown';

  /** Сколько проверок подряд завершились неудачей. */
  private consecutiveFailures = 0;

  /**
   * Момент последней завершённой проверки; `null` — проверок ещё не было.
   *
   * Хранится, чтобы отдать наружу `GET /llm/health` (`lastCheck`, KI-618):
   * UI-индикатор показывает, когда статус GPU обновлялся в последний раз, и
   * отличает «проверка была давно» от «проверки не было вовсе».
   */
  private lastCheckedAt: Date | null = null;

  /** Таймер периодической проверки; `null` — healthcheck не запущен. */
  private timer: NodeJS.Timeout | null = null;

  /**
   * Проверка «в полёте»: параллельные вызовы `isAvailableAsync` при статусе
   * `unknown` не должны порождать несколько одновременных HTTP-пингов.
   */
  private probeInFlight: Promise<boolean> | null = null;

  /**
   * @param registry - реестр провайдеров; локальный ищется по флагу `isLocal`
   */
  constructor(private readonly registry: LlmRegistryService) {}

  /** Запускает периодический healthcheck при инициализации модуля. */
  onModuleInit(): void {
    this.start();
  }

  /** Останавливает healthcheck при завершении приложения (RULES 4.12). */
  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Текущий статус локального провайдера.
   *
   * Нужен healthcheck'у и будущему UI-индикатору (DESIGN V120 § 3.4): сам по
   * себе статус не является ошибкой, поэтому не бросает исключение.
   *
   * @returns `unknown` | `available` | `unavailable`
   */
  getStatus(): LlmHealthStatus {
    return this.status;
  }

  /**
   * ISO-строка момента последней **завершённой** проверки (KI-618).
   *
   * Нужна ручке `GET /llm/health` (`local.lastCheck`): по ней UI-индикатор
   * показывает, насколько свежим является статус. Пустая строка — проверок ещё
   * не было: ни таймер не сработал, ни `isAvailableAsync` не выполнил пинг
   * (например, локальный провайдер не сконфигурирован).
   *
   * @returns `Date.toISOString()` последней проверки либо `''`, если проверок
   *   ещё не было
   */
  getLastCheckAt(): string {
    return this.lastCheckedAt?.toISOString() ?? '';
  }

  /**
   * Запускает периодическую проверку (идемпотентно).
   *
   * Сразу делает первую проверку, не дожидаясь первого интервала: иначе
   * `GET /llm/models` сразу после старта показывал бы «неизвестно», а роутер
   * пинговал бы LM Studio внутри первого пользовательского вызова.
   */
  start(): void {
    if (this.timer !== null) {
      return;
    }

    void this.checkAsync();
    this.timer = setInterval(() => {
      void this.checkAsync();
    }, LLM_HEALTH_INTERVAL_MS);
    // Healthcheck не должен удерживать event loop живым (RULES 4.12).
    this.timer.unref();
  }

  /** Останавливает периодическую проверку и снимает таймер (идемпотентно). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Выполняет одну проверку и обновляет статус.
   *
   * Публичный, а не приватный: тесты вызывают проверку напрямую, не полагаясь
   * на реальные 30-секундные интервалы.
   *
   * @returns `true`, если локальный провайдер ответил 2xx
   */
  async checkAsync(): Promise<boolean> {
    const provider = this.registry.findLocalProvider();

    if (!provider) {
      // Локального провайдера нет — проверять нечего. Статус остаётся
      // `unknown`: «не настроен» и «недоступен» — разные состояния.
      return false;
    }

    const available = await this.probeAsync(provider);
    this.applyResult(available);

    return available;
  }

  /**
   * Отвечает, доступен ли локальный провайдер сейчас.
   *
   * При известном статусе сетевого запроса нет: `available` — доверяем
   * последней проверке (следующая будет через ≤30 с), `unavailable` — не
   * дёргаем сервер до следующего цикла. При `unknown` (старт или первые
   * неудачи) выполняется проверка, чтобы роутер принял решение по факту, а не
   * по умолчанию.
   *
   * @returns `true`, если локальный провайдер можно использовать
   */
  async isAvailableAsync(): Promise<boolean> {
    if (!this.registry.findLocalProvider()) {
      return false;
    }

    if (this.status === 'available') {
      return true;
    }

    if (this.status === 'unavailable') {
      return false;
    }

    return this.checkAsync();
  }

  /**
   * Пингует провайдера, объединяя параллельные проверки в одну.
   *
   * @param provider - локальный провайдер
   * @returns результат пинга; исключение провайдера трактуется как `false`
   */
  private probeAsync(provider: ILlmProvider): Promise<boolean> {
    if (this.probeInFlight !== null) {
      return this.probeInFlight;
    }

    this.probeInFlight = provider
      .isAvailableAsync()
      .catch(() => false)
      .finally(() => {
        this.probeInFlight = null;
      });

    return this.probeInFlight;
  }

  /**
   * Применяет результат проверки к счётчику, статусу и времени последней
   * проверки.
   *
   * WARN пишется только при переходе в `unavailable` — иначе при выключенном
   * LM Studio лог получал бы запись каждые 30 секунд.
   *
   * @param available - результат последней проверки
   */
  private applyResult(available: boolean): void {
    // Время фиксируется до ветвления: «последняя проверка» — это завершившийся
    // пинг, независимо от его исхода (KI-618).
    this.lastCheckedAt = new Date();

    if (available) {
      const wasUnavailable = this.status === 'unavailable';

      this.consecutiveFailures = 0;
      this.status = 'available';

      if (wasUnavailable) {
        this.logger.log(
          'LM Studio снова доступен — локальный провайдер возвращён в роутинг',
        );
      }

      return;
    }

    this.consecutiveFailures += 1;

    if (
      this.status !== 'unavailable' &&
      this.consecutiveFailures >= LLM_HEALTH_FAILURE_THRESHOLD
    ) {
      this.status = 'unavailable';
      this.logger.warn(
        `LM Studio недоступен ${this.consecutiveFailures} проверки подряд — локальный провайдер исключён из роутинга до восстановления`,
      );
    }
  }
}
