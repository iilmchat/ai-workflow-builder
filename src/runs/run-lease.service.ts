import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns } from '../db/schema.js';

/**
 * Приводит неизвестную ошибку к тексту для логов.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Аренда запуска (heartbeat) — продлевает `workflow_runs.lease_expires_at`,
 * пока запуск действительно выполняется (DESIGN v0.11 § 3.3.1, KI-066).
 *
 * Зачем: `RunsProcessor` считает `running`-запуск зависшим и переигрывает граф.
 * Раньше «живость» определялась только по `started_at`, поэтому легитимно
 * долгий запуск (LLM/медиа/30 узлов) выглядел мёртвым через
 * `WORKFLOW_RUNS_STALE_THRESHOLD_MS`, и второй worker мог запустить граф
 * параллельно — двойные траты. Heartbeat раз в `WORKFLOW_RUN_HEARTBEAT_MS`
 * продлевает аренду на `WORKFLOW_RUN_LEASE_TTL_MS`, а падение worker'а
 * обнаруживается за TTL (≤ 90 с по умолчанию), а не за 5 минут.
 *
 * `started_at` не меняется: это время старта для истории/UI, а «живость»
 * живёт в отдельной колонке (DESIGN § 2.4).
 *
 * **Почему `UPDATE … WHERE status = 'running'`.** После `finishRunAsync` или
 * перевода в `failed` UPDATE становится no-op: heartbeat не может «оживить»
 * терминальный запуск и не продлевает ему аренду. Это же условие позволяет
 * `startAsync` понять, что строка уже не `running`, и не планировать таймер.
 *
 * **Сбои БД не роняют запуск.** Ошибка в тике только логируется
 * (`logger.warn`): BullMQ-лок всё ещё удерживает job, следующий тик попробует
 * снова, а сам граф продолжает выполняться. Без этого временная недоступность
 * PostgreSQL превращала бы живой запуск в упавший.
 */
@Injectable()
export class RunLeaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(RunLeaseService.name);

  /** Активные таймеры heartbeat: `runId` → таймер следующего тика. */
  readonly #timers = new Map<string, NodeJS.Timeout>();

  /**
   * Запуски, для которых heartbeat остановлен (защита от гонки `stop`/`tick`).
   *
   * Флаг переживает `stopTimer`: тик, уже вышедший из `await renewAsync`,
   * обязан увидеть, что запуск остановлен, и не перепланировать таймер.
   */
  readonly #stopped = new Set<string>();

  /** Период продления аренды, мс (`WORKFLOW_RUN_HEARTBEAT_MS`, default 30000). */
  readonly #heartbeatMs: number;

  /** Срок аренды, мс (`WORKFLOW_RUN_LEASE_TTL_MS`, default 90000). */
  readonly #leaseTtlMs: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    config: ConfigService,
  ) {
    // RULES 4.6: env — через ConfigService, не через process.env. `??` — потому
    // что в юнит-тестах ConfigService может быть без этих ключей (DESIGN
    // § 3.3.1 задаёт те же дефолты, что и Zod-схема env).
    this.#heartbeatMs =
      config.get<number>('WORKFLOW_RUN_HEARTBEAT_MS') ?? 30_000;
    this.#leaseTtlMs = config.get<number>('WORKFLOW_RUN_LEASE_TTL_MS') ?? 90_000;
  }

  /**
   * Срок аренды в миллисекундах.
   *
   * Публичное чтение нужно `ExecutionEngineService`: стартовый lease ставится
   * прямо в `markRunRunningAsync`, и TTL должен читаться из env в одном месте
   * (иначе стартовый lease и heartbeat могли бы разойтись).
   */
  get leaseTtlMs(): number {
    return this.#leaseTtlMs;
  }

  /**
   * Запускает heartbeat для запуска.
   *
   * Первое продление выполняется сразу, до планирования первого тика: между
   * `markRunRunningAsync` и первым `setTimeout` не должно быть окна, в котором
   * аренда уже истекла. Если строка уже не `running` (например, запуск успели
   * отменить), таймер не планируется.
   *
   * Повторный вызов безопасен: старый таймер снимается, флаг `#stopped`
   * сбрасывается (новый heartbeat для того же запуска).
   *
   * @param runId - uuid запуска
   * @returns промис без значения; разрешается после первого продления
   */
  async startAsync(runId: string): Promise<void> {
    this.#stopped.delete(runId);
    this.stopTimer(runId);

    if (!(await this.renewAsync(runId))) {
      return;
    }

    this.schedule(runId);
  }

  /**
   * Останавливает heartbeat (идемпотентно).
   *
   * @param runId - uuid запуска
   */
  stop(runId: string): void {
    this.#stopped.add(runId);
    this.stopTimer(runId);
  }

  /**
   * Снимает таймер, не трогая флаг остановки (нужен повторному `startAsync`).
   *
   * @param runId - uuid запуска
   */
  private stopTimer(runId: string): void {
    const timer = this.#timers.get(runId);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(runId);
    }
  }

  /**
   * Продлевает аренду запуска.
   *
   * `WHERE status = 'running'` — после `finishRunAsync`/перевода в `failed`
   * UPDATE становится no-op и не «оживляет» завершённый запуск.
   *
   * SQL-выражение `now() + ttl * interval '1 millisecond'` считает время по
   * часам БД (DESIGN § 3.3.1): расхождение часов приложения и PostgreSQL не
   * должно влиять на то, живёт аренда или нет.
   *
   * @param runId - uuid запуска
   * @returns `true`, если строка ещё `running` и аренда продлена
   */
  async renewAsync(runId: string): Promise<boolean> {
    const [row] = await this.db
      .update(workflowRuns)
      .set({
        leaseExpiresAt: sql`now() + ${this.#leaseTtlMs} * interval '1 millisecond'`,
      })
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, 'running')))
      .returning({ id: workflowRuns.id });

    return row !== undefined;
  }

  /**
   * Планирует следующий тик heartbeat.
   *
   * `timer.unref()` — heartbeat не должен удерживать процесс живым: при
   * завершении приложения Nest вызывает {@link onApplicationShutdown}, но и без
   * этого event loop обязан иметь возможность выйти (RULES 4.12).
   *
   * @param runId - uuid запуска
   */
  private schedule(runId: string): void {
    const timer = setTimeout(() => {
      // `void` — осознанно: ошибки тика логируются внутри `tickAsync`, наружу
      // промис не пробрасывается (RULES 4.18).
      void this.tickAsync(runId);
    }, this.#heartbeatMs);

    timer.unref();
    this.#timers.set(runId, timer);
  }

  /**
   * Один тик heartbeat: продлевает аренду и планирует следующий.
   *
   * Сбой БД не роняет запуск: BullMQ-лок всё ещё держит job, поэтому тик
   * логируется (`warn`) и heartbeat продолжает работать. Если строка уже не
   * `running` (запуск завершился), серия тиков прекращается.
   *
   * @param runId - uuid запуска
   */
  private async tickAsync(runId: string): Promise<void> {
    // Таймер уже выстрелил — в карте его больше нет, иначе `stop` попытался бы
    // очистить протухший таймер.
    this.#timers.delete(runId);

    if (this.#stopped.has(runId)) {
      return;
    }

    try {
      if (!(await this.renewAsync(runId))) {
        return;
      }
    } catch (error: unknown) {
      // Сбой БД не должен ронять запуск: BullMQ-лок держит job, а следующий тик
      // попробует продлить аренду снова.
      this.logger.warn(
        `Heartbeat запуска ${runId} не удался: ${toMessage(error)}`,
      );
    }

    // Гонка `stop`/`tick`: `stop` мог сработать, пока шёл `await renewAsync`.
    // Без этой проверки таймер перепланировался бы после остановки.
    if (this.#stopped.has(runId)) {
      return;
    }

    this.schedule(runId);
  }

  /**
   * Останавливает все heartbeat-таймеры при завершении приложения (RULES 4.12).
   */
  onApplicationShutdown(): void {
    for (const runId of [...this.#timers.keys()]) {
      this.stop(runId);
    }
  }
}
