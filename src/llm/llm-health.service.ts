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
 * Период внеочередных проверок, пока провайдер `unavailable` (мс),
 * v1.4.0 S3, KI-632.
 *
 * Пока LM Studio выключен, обычный тик {@link LLM_HEALTH_INTERVAL_MS} (30 с)
 * обнаружил бы восстановление слишком поздно: всё это окно вызовы уходили бы
 * в облако, хотя локальный сервер уже поднялся. Поэтому при переходе в
 * `unavailable` сервис переключается на короткий пинг каждые 5 с.
 *
 * 5 с — компромисс: достаточно быстро, чтобы UI/роутер почти сразу увидели
 * восстановление, но не серия мгновенных пингов, которая нагружала бы LM
 * Studio во время загрузки модели. Первый успешный пинг возвращает
 * `available` и обычный 30-секундный ритм — внеочередные проверки после этого
 * не планируются (KI-632, в отличие от KI-621).
 *
 * Значение — константа, а не env: как и {@link LLM_HEALTH_INTERVAL_MS}, это
 * параметр протокола проверки, а не операторская настройка.
 */
export const LLM_HEALTH_UNAVAILABLE_RETRY_MS = 5_000;

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
 * Пока провайдер `unavailable`, обычного 30-секундного тика недостаточно:
 * восстановление обнаруживалось бы слишком поздно. Поэтому в этом состоянии
 * сервис пингует каждые {@link LLM_HEALTH_UNAVAILABLE_RETRY_MS} (5 с). Первый
 * успех возвращает `available`, снимает внеочередной таймер и перезапускает
 * обычный интервал — следующий пинг будет ровно через
 * {@link LLM_HEALTH_INTERVAL_MS} (30 с), и бесконечного 5-секундного цикла
 * после восстановления нет (KI-621, KI-632).
 *
 * Таймеры создаются через `setInterval`/`setTimeout` и **не удерживают процесс
 * живым** (`unref()`): healthcheck — фоновая задача, и приложение должно
 * завершаться, даже если интервал ещё не сработал (RULES 4.12). Оба таймера —
 * интервал и внеочередной пинг — снимаются в `onModuleDestroy`.
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
   * Таймер внеочередной проверки, пока статус `unavailable` (KI-621, KI-632);
   * `null` — пинг не запланирован.
   *
   * Отдельно от {@link timer}: периодический интервал продолжает идти, а этот
   * таймер живёт только до ближайшего внеочередного пинга (или до `stop()`).
   */
  private unavailableTimer: NodeJS.Timeout | null = null;

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
    this.startInterval();
  }

  /**
   * Останавливает периодическую проверку и снимает таймеры (идемпотентно).
   *
   * Вместе с интервалом снимается и запланированный внеочередной пинг
   * (KI-621/KI-632): после `stop()` сервис не должен выполнять фоновых
   * проверок до следующего `start()`.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.unavailableTimer !== null) {
      clearTimeout(this.unavailableTimer);
      this.unavailableTimer = null;
    }
  }

  /**
   * Создаёт обычный интервал проверок (30 с) и не удерживает им event loop.
   *
   * Вынесено отдельным методом, потому что после восстановления интервал
   * перезапускается: следующий обычный пинг должен быть через
   * {@link LLM_HEALTH_INTERVAL_MS} от момента успеха, а не от старта процесса
   * (KI-632).
   */
  private startInterval(): void {
    this.timer = setInterval(() => {
      void this.checkAsync();
    }, LLM_HEALTH_INTERVAL_MS);
    // Healthcheck не должен удерживать event loop живым (RULES 4.12).
    this.timer.unref();
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

      // Внеочередные 5-секундные проверки нужны только пока провайдер
      // недоступен. После успеха снимаем их и перезапускаем обычный интервал:
      // следующий пинг — ровно через 30 с, бесконечного цикла нет (KI-632).
      this.clearUnavailableTimer();

      if (wasUnavailable && this.timer !== null) {
        clearInterval(this.timer);
        this.startInterval();
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

    // Пока статус `unavailable`, проверяем чаще обычного тика — иначе
    // восстановление замечалось бы с задержкой до 30 с. Повторное планирование
    // после неудачного внеочередного пинга и есть цикл «до восстановления»;
    // успех его снимает (см. ветку выше).
    if (this.status === 'unavailable') {
      this.scheduleUnavailableRetry();
    }
  }

  /**
   * Планирует внеочередной пинг через
   * {@link LLM_HEALTH_UNAVAILABLE_RETRY_MS}, пока провайдер `unavailable`
   * (KI-621, KI-632).
   *
   * Планирует только при активном мониторинге (`this.timer !== null`): без
   * периодического healthcheck внеочередная проверка бессмысленна, а в тестах
   * и при ручных вызовах `checkAsync` не должна порождать «висящие» таймеры.
   * Если пинг уже запланирован, повторный вызов игнорируется — один статус
   * `unavailable` даёт не больше одного таймера за раз.
   */
  private scheduleUnavailableRetry(): void {
    if (this.timer === null || this.unavailableTimer !== null) {
      return;
    }

    this.unavailableTimer = setTimeout(() => {
      // Сбрасываем поле до проверки: неудачный пинг в `applyResult` снова
      // запланирует следующий, а успешный — снимет цикл.
      this.unavailableTimer = null;
      void this.checkAsync();
    }, LLM_HEALTH_UNAVAILABLE_RETRY_MS);
    // Внеочередной пинг не должен удерживать event loop живым (RULES 4.12).
    this.unavailableTimer.unref();
  }

  /** Снимает запланированный внеочередной пинг, если он есть. */
  private clearUnavailableTimer(): void {
    if (this.unavailableTimer === null) {
      return;
    }

    clearTimeout(this.unavailableTimer);
    this.unavailableTimer = null;
  }
}
