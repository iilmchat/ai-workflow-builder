import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  RUNS_QUEUE_DB,
  RUNS_QUEUE_PREFIX,
} from '../runs/runs.worker-options.js';
import { AuthService } from './auth.service.js';

/**
 * Очередь служебных задач аутентификации (KI-215).
 *
 * Отдельная от `workflow-runs`: очистка токенов — короткая операция, которой
 * не нужны конкурентность и настройки воркера запусков. Префикс и номер БД
 * Redis наследуются от очереди запусков (KI-387), чтобы инстансы dev/smoke/prod
 * не видели чужие расписания.
 */
export const REFRESH_TOKEN_CLEANUP_QUEUE = 'auth-maintenance';

/** Стабильный id расписания: `upsertJobScheduler` идемпотентен. */
export const REFRESH_TOKEN_CLEANUP_SCHEDULER_ID = 'refresh-token-cleanup-daily';

/** Имя задания очистки. */
export const REFRESH_TOKEN_CLEANUP_JOB_NAME = 'cleanup-expired-refresh-tokens';

/**
 * Расписание очистки: каждый день в 04:00 по времени сервера.
 *
 * Час выбран после ежедневной очистки media (03:00), чтобы два прохода не
 * конкурировали за БД. BullMQ-расписание переживает рестарт процесса и не
 * дублируется между инстансами (`upsertJobScheduler` по стабильному id).
 */
export const REFRESH_TOKEN_CLEANUP_CRON = '0 4 * * *';

/** Префикс ключей Redis — общий с очередью запусков (KI-387). */
export const REFRESH_TOKEN_CLEANUP_QUEUE_PREFIX = RUNS_QUEUE_PREFIX;

/** Номер БД Redis — общий с очередью запусков (KI-387). */
export const REFRESH_TOKEN_CLEANUP_QUEUE_DB = RUNS_QUEUE_DB;

/**
 * Опции воркера очистки.
 *
 * `prefix` обязан совпадать с префиксом очереди из `AuthModule`, иначе воркер
 * слушает другое пространство ключей и не видит заданий.
 */
export const REFRESH_TOKEN_CLEANUP_WORKER_OPTIONS = {
  prefix: REFRESH_TOKEN_CLEANUP_QUEUE_PREFIX,
};

/**
 * Ежедневная очистка истёкших refresh-токенов (KI-215).
 *
 * Регистрация расписания идёт в `onModuleInit`, когда очередь уже подключена к
 * Redis. Сбой регистрации логируется и не роняет приложение: очистка вторична
 * по отношению к работе API, а следующий рестарт повторит upsert. Сама очистка
 * идемпотентна — повторный запуск просто удалит то, что успело истечь.
 */
@Processor(REFRESH_TOKEN_CLEANUP_QUEUE, REFRESH_TOKEN_CLEANUP_WORKER_OPTIONS)
export class RefreshTokenCleanupProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(RefreshTokenCleanupProcessor.name);

  /**
   * @param auth - сервис с методом удаления истёкших токенов
   * @param queue - очередь, в которой живёт расписание
   */
  constructor(
    private readonly auth: AuthService,
    @InjectQueue(REFRESH_TOKEN_CLEANUP_QUEUE)
    private readonly queue: Queue<Record<string, never>>,
  ) {
    super();
  }

  /**
   * Ставит (или обновляет) ежедневное расписание очистки.
   *
   * @returns промис без значения
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        REFRESH_TOKEN_CLEANUP_SCHEDULER_ID,
        { pattern: REFRESH_TOKEN_CLEANUP_CRON },
        {
          name: REFRESH_TOKEN_CLEANUP_JOB_NAME,
          data: {} as Record<string, never>,
        },
      );

      this.logger.log(
        `Cron-очистка refresh-токенов зарегистрирована: "${REFRESH_TOKEN_CLEANUP_CRON}"`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Redis уже проверен на старте (KI-019), но BullMQ мог не успеть
      // подключиться. Не роняем API из-за вторичной задачи.
      this.logger.error(
        `Не удалось зарегистрировать очистку refresh-токенов: ${message}`,
      );
    }
  }

  /**
   * Выполняет задание очистки.
   *
   * @param _job - задание BullMQ (payload не используется)
   * @returns промис без значения
   */
  async process(_job: Job<Record<string, never>>): Promise<void> {
    const removed = await this.auth.cleanupExpiredTokensAsync();

    this.logger.log(`Очистка refresh-токенов: удалено строк ${removed}`);
  }
}
