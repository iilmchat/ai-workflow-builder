import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { RUNS_QUEUE_DB, RUNS_QUEUE_PREFIX } from '../runs/runs.worker-options.js';

/**
 * Cron-очистка локального media-хранилища (R7.8, KI-413).
 *
 * `LocalMediaStorage` пишет файлы в `./data/media/<runId>/<nodeId>.<ext>` и
 * проставляет `stored_expires_at`, но сам по себе ничего не удаляет: без
 * периодической уборки каталог растёт неограниченно (видео — сотни МБ на
 * генерацию). Сервис удаляет файлы старше `MEDIA_STORAGE_LOCAL_TTL_DAYS`,
 * ориентируясь только на `fs.stat` (mtime), без запросов к БД: файл живёт на
 * диске ровно столько, сколько ему отведено, независимо от строк в
 * `node_runs`.
 *
 * Уборка идемпотентна и безопасна для параллельных инстансов: `unlink`
 * отсутствующего файла игнорируется, а каталог запуска удаляется только если
 * из него в этом проходе что-то удалили (пустой каталог мог быть создан
 * загрузкой, которая ещё пишет файл).
 */

/** Имя очереди BullMQ для cron-задач очистки. */
export const MEDIA_CLEANUP_QUEUE = 'media-cleanup';

/** Идентификатор повторяющегося задания в BullMQ (upsert идемпотентен). */
export const MEDIA_CLEANUP_SCHEDULER_ID = 'media-cleanup-daily';

/** Имя задания очистки. */
export const MEDIA_CLEANUP_JOB_NAME = 'cleanup';

/**
 * Расписание очистки: каждый день в 03:00 по времени сервера.
 *
 * Ночь выбрана осознанно: уборка читает каталог и удаляет файлы, днём это
 * конкурировало бы за диск с активными загрузками.
 */
export const MEDIA_CLEANUP_CRON = '0 3 * * *';

/**
 * Префикс ключей Redis и номер БД — общие с очередью запусков (KI-387).
 *
 * Иначе инстанс `dev` чистил бы задания `prod` (или наоборот) на общем Redis.
 * Очистка идемпотентна, но изоляция инстансов должна быть сквозной.
 */
export const MEDIA_CLEANUP_QUEUE_PREFIX = RUNS_QUEUE_PREFIX;

/** Номер БД Redis для очереди очистки (KI-387). */
export const MEDIA_CLEANUP_QUEUE_DB = RUNS_QUEUE_DB;

/**
 * Опции воркера очистки.
 *
 * `prefix` обязан совпадать с префиксом очереди из `MediaModule`, иначе воркер
 * слушает другое пространство ключей и не видит заданий.
 */
export const MEDIA_CLEANUP_WORKER_OPTIONS = {
  prefix: MEDIA_CLEANUP_QUEUE_PREFIX,
};

/** Результат одного прохода очистки (для лога и тестов). */
export interface MediaCleanupResult {
  /** Сколько файлов просмотрено во всех каталогах запусков. */
  scannedFiles: number;
  /** Сколько файлов удалено как просроченные. */
  removedFiles: number;
  /** Сколько опустевших каталогов запусков удалено. */
  removedDirectories: number;
  /** `true`, если очистка отключена (`TTL=0`) и ничего не делала. */
  skipped: boolean;
}

/** Миллисекунд в сутках — TTL задаётся в днях. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Проверяет, что ошибка файловой системы имеет ожидаемый код (`ENOENT` и т.п.).
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @param code - код ошибки Node (`error.code`)
 * @returns `true`, если код совпал
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Приводит неизвестную ошибку к тексту для лога.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Удаляет из локального хранилища файлы старше TTL (R7.8, KI-413).
 *
 * Сервис ничего не знает о BullMQ — это чистая функция над диском, поэтому
 * его легко проверить юнит-тестом и переиспользовать (например, ручной
 * запуск из скрипта). Расписание задаёт {@link MediaCleanupProcessor}.
 */
@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  /**
   * @param baseDir - корень локального хранилища (`MEDIA_STORAGE_LOCAL_PATH`)
   * @param ttlDays - TTL файлов в днях (`MEDIA_STORAGE_LOCAL_TTL_DAYS`);
   *   `0` — файлы не удаляются
   */
  constructor(
    private readonly baseDir: string,
    private readonly ttlDays: number,
  ) {}

  /** Включена ли очистка (`TTL=0` — выключена, файлы хранятся вечно). */
  get isEnabled(): boolean {
    return this.ttlDays > 0;
  }

  /** TTL в днях — для сообщений в логе. */
  get ttlDaysValue(): number {
    return this.ttlDays;
  }

  /**
   * Удаляет файлы старше TTL и опустевшие каталоги запусков.
   *
   * Ошибки чтения одного каталога или удаления одного файла не прерывают
   * проход: cron должен дочистить остальное. Отсутствие корневого каталога —
   * норма (хранилище ещё не использовалось), а не ошибка.
   *
   * @param now - точка отсчёта TTL (в тестах подменяется фиксированной датой)
   * @returns статистика прохода
   */
  async cleanupAsync(now: Date = new Date()): Promise<MediaCleanupResult> {
    const result: MediaCleanupResult = {
      scannedFiles: 0,
      removedFiles: 0,
      removedDirectories: 0,
      skipped: false,
    };

    if (!this.isEnabled) {
      result.skipped = true;
      this.logger.log(
        'TTL локального media-хранилища равен 0 — очистка пропущена',
      );

      return result;
    }

    const cutoffMs = now.getTime() - this.ttlDays * DAY_MS;
    const runDirs = await this.readDirSafeAsync(this.baseDir);

    if (runDirs === null) {
      return result;
    }

    for (const entry of runDirs) {
      // Только каталоги запусков: stray-файлы в корне хранилища не наши.
      if (!entry.isDirectory()) {
        continue;
      }

      const runDir = join(this.baseDir, entry.name);
      const files = await this.readDirSafeAsync(runDir);

      if (files === null) {
        continue;
      }

      let removedInDir = 0;

      for (const file of files) {
        // `isFile()` отсекает подкаталоги и symlink'и: за пределы хранилища
        // уборка не ходит (RULES 1.9).
        if (!file.isFile()) {
          continue;
        }

        result.scannedFiles += 1;

        const filePath = join(runDir, file.name);

        try {
          const info = await stat(filePath);

          if (info.mtimeMs >= cutoffMs) {
            continue;
          }

          await unlink(filePath);
          removedInDir += 1;
          result.removedFiles += 1;
        } catch (error: unknown) {
          // Файл уже удалён параллельным проходом — это не ошибка.
          if (hasErrorCode(error, 'ENOENT')) {
            continue;
          }

          this.logger.warn(
            `Не удалось удалить media-файл ${filePath}: ${toErrorMessage(error)}`,
          );
        }
      }

      // Каталог удаляем только если в этом проходе из него что-то удалили:
      // иначе можно снести каталог, в который прямо сейчас пишется файл.
      if (removedInDir > 0) {
        try {
          await rmdir(runDir);
          result.removedDirectories += 1;
        } catch (error: unknown) {
          // Каталог не пуст (есть свежие файлы) — оставляем как есть.
          if (!hasErrorCode(error, 'ENOTEMPTY') && !hasErrorCode(error, 'ENOENT')) {
            this.logger.warn(
              `Не удалось удалить каталог ${runDir}: ${toErrorMessage(error)}`,
            );
          }
        }
      }
    }

    if (result.removedFiles > 0 || result.removedDirectories > 0) {
      this.logger.log(
        `Очистка media: удалено файлов ${result.removedFiles}, ` +
          `каталогов ${result.removedDirectories} ` +
          `(просмотрено ${result.scannedFiles}, TTL ${this.ttlDays} дн.)`,
      );
    }

    return result;
  }

  /**
   * Читает каталог, не падая на отсутствии или нехватке прав.
   *
   * @param dir - абсолютный путь
   * @returns список записей либо `null`, если каталог недоступен
   */
  private async readDirSafeAsync(dir: string): Promise<Dirent[] | null> {
    try {
      return await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      // Корневого каталога может не быть — хранилище ещё не использовалось.
      if (hasErrorCode(error, 'ENOENT')) {
        return null;
      }

      this.logger.warn(
        `Не удалось прочитать каталог media ${dir}: ${toErrorMessage(error)}`,
      );

      return null;
    }
  }
}

/**
 * Регистрирует ежедневное задание очистки и выполняет его (R7.8, KI-413).
 *
 * Почему BullMQ, а не `@nestjs/schedule`: планировщик уже есть в стеке
 * (очередь workflow-runs), а повторяющееся задание BullMQ переживает рестарт
 * процесса и не дублируется при нескольких инстансах — `upsertJobScheduler`
 * обновляет одно и то же расписание по стабильному id.
 *
 * Регистрация идёт в `onModuleInit`, а не в конструкторе: к этому моменту
 * очередь уже подключена к Redis. Сбой регистрации логируется и не роняет
 * приложение — очистка вторична по отношению к работе API.
 */
@Processor(MEDIA_CLEANUP_QUEUE, MEDIA_CLEANUP_WORKER_OPTIONS)
export class MediaCleanupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  /**
   * @param cleanup - логика уборки
   * @param queue - очередь, в которой живёт расписание
   */
  constructor(
    private readonly cleanup: MediaCleanupService,
    @InjectQueue(MEDIA_CLEANUP_QUEUE)
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
    if (!this.cleanup.isEnabled) {
      this.logger.log(
        'TTL локального media-хранилища равен 0 — cron-очистка не регистрируется (KI-413)',
      );

      return;
    }

    try {
      await this.queue.upsertJobScheduler(
        MEDIA_CLEANUP_SCHEDULER_ID,
        { pattern: MEDIA_CLEANUP_CRON },
        {
          name: MEDIA_CLEANUP_JOB_NAME,
          data: {} as Record<string, never>,
        },
      );

      this.logger.log(
        `Cron-очистка media зарегистрирована: "${MEDIA_CLEANUP_CRON}" ` +
          `(TTL ${this.cleanup.ttlDaysValue} дн.)`,
      );
    } catch (error: unknown) {
      // Redis мог быть недоступен в момент старта: приложение продолжает
      // работать, расписание попробует обновиться при следующем рестарте.
      this.logger.error(
        `Не удалось зарегистрировать cron-очистку media: ${toErrorMessage(error)}`,
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
    const result = await this.cleanup.cleanupAsync();

    if (result.skipped) {
      return;
    }

    this.logger.log(
      `Задание очистки media выполнено: файлов ${result.removedFiles}, ` +
        `каталогов ${result.removedDirectories}`,
    );
  }
}

/**
 * Nest-провайдер сервиса очистки: env превращается в параметры в одном месте.
 *
 * Дефолты совпадают со схемой окружения (`MediaStorageEnvSchema`) — сюда они
 * попадают уже применёнными `ConfigService`, fallback оставлен для вызовов вне
 * приложения.
 */
export const mediaCleanupProvider = {
  provide: MediaCleanupService,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MediaCleanupService =>
    new MediaCleanupService(
      config.get<string>('MEDIA_STORAGE_LOCAL_PATH') ?? './data/media',
      config.get<number>('MEDIA_STORAGE_LOCAL_TTL_DAYS') ?? 30,
    ),
};
