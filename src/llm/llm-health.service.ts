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

/**
 * Задержка внеочередной проверки после восстановления провайдера (мс),
 * v1.3.0 S2, KI-621.
 *
 * Когда пинг после серии неудач снова успешен, провайдер уже возвращён в
 * роутинг, но очередного тика {@link LLM_HEALTH_INTERVAL_MS} (до 30 с) ждать
 * не нужно: внеочередной пинг через 5 с быстро подтверждает, что связь
 * стабильна, и не оставляет UI/оператора в неопределённости на полминуты.
 *
 * 5 с — компромисс: заметно меньше периода обычной проверки (не растягивает
 * подтверждение), но и не серия мгновенных пингов, которая нагружала бы LM
 * Studio сразу после загрузки модели. Значение — константа, а не env: как и
 * {@link LLM_HEALTH_INTERVAL_MS}, это параметр протокола проверки, а не
 * операторская настройка.
 */
export const LLM_HEALTH_RECOVERY_PING_DELAY_MS = 5_000;

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
 * После восстановления (переход `unavailable` → `available`) сервис не ждёт
 * очередного тика, а через {@link LLM_HEALTH_RECOVERY_PING_DELAY_MS} выполняет
 * внеочередной пинг (KI-621). Бесконечного цикла здесь нет: планирование
 * срабатывает только на самом переходе из `unavailable`, а внеочередной пинг
 * такого перехода не порождает — успех оставляет статус `available` (перехода
 * нет), неудача лишь увеличивает счётчик подряд идущих неудач, а статус
 * остаётся `available` до достижения порога.
 *
 * Таймер создаётся через `setInterval` и **не удерживает процесс живым**
 * (`unref()`): healthcheck — фоновая задача, и приложение должно завершаться,
 * даже если интервал ещё не сработал (RULES 4.12). Оба таймера — интервал и
 * отложенный внеочередной пинг — снимаются в `onModuleDestroy`.
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
   * Таймер внеочередной проверки после восстановления (KI-621); `null` — пинг
   * не запланирован.
   *
   * Отдельно от {@link timer}: периодический интервал продолжает идти, а этот
   * таймер живёт только до ближайшего внеочередного пинга (или до `stop()`).
   */
  private recoveryTimer: NodeJS.Timeout | null = null;

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

  /**
   * Останавливает периодическую проверку и снимает таймеры (идемпотентно).
   *
   * Вместе с интервалом снимается и запланированный внеочередной пинг
   * (KI-621): после `stop()` сервис не должен выполнять фоновых проверок до
   * следующего `start()`.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
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
        // Не ждём очередного тика: через 5 с подтверждаем, что связь стабильна
        // (KI-621).
        this.scheduleRecoveryPing();
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

  /**
   * Планирует внеочередной пинг через
   * {@link LLM_HEALTH_RECOVERY_PING_DELAY_MS} после восстановления провайдера
   * (KI-621).
   *
   * Планирует только при активном мониторинге (`this.timer !== null`): без
   * периодического healthcheck внеочередная проверка бессмысленна, а в тестах
   * и при ручных вызовах `checkAsync` не должна порождать «висящие» таймеры.
   * Если пинг уже запланирован, повторный вызов игнорируется — один переход
   * `unavailable` → `available` даёт ровно один внеочередной пинг.
   */
  private scheduleRecoveryPing(): void {
    if (this.timer === null || this.recoveryTimer !== null) {
      return;
    }

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.checkAsync();
    }, LLM_HEALTH_RECOVERY_PING_DELAY_MS);
    // Внеочередной пинг не должен удерживать event loop живым (RULES 4.12).
    this.recoveryTimer.unref();
  }
}
