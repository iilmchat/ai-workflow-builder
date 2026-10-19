import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import { and, isNotNull, lte } from 'drizzle-orm';
import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns } from '../db/schema.js';
import { resolveMediaStoragePath } from './media-storage.service.js';
import { RUNS_QUEUE_DB, RUNS_QUEUE_PREFIX } from '../runs/runs.worker-options.js';

/**
 * Cron-очистка локального хранилища (R7.8, KI-413).
 *
 * Убирает три вида мусора:
 * 1. **media-файлы старше TTL хранения** (`MEDIA_STORAGE_LOCAL_TTL_DAYS`) —
 *    обход каталога по `mtime`, без БД: файл живёт на диске ровно столько,
 *    сколько ему отведено, независимо от строк в `node_runs`;
 * 2. **media-файлы, у которых истёк `node_runs.stored_expires_at`** — выборка
 *    по БД, удаление по `storage_key` (KI-413: TTL из БД, а не только mtime).
 *    Это ловит файлы, у которых TTL задан в строке запуска (например, старые
 *    строки или другой срок, чем текущий env);
 * 3. **файлы workspace** (`./data/workspace/<workflowId>/...`) старше
 *    `WORKSPACE_TTL_DAYS` — рекурсивно, без выхода за корень workspace.
 *
 * Уборка идемпотентна и безопасна для параллельных инстансов: `unlink`
 * отсутствующего файла игнорируется, а каталог удаляется только если в этом
 * проходе из него что-то удалили (пустой каталог мог создать писатель).
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
 * конкурировало бы за диск с активными загрузками. BullMQ-расписание
 * переживает рестарт процесса и не дублируется между инстансами
 * (`upsertJobScheduler` по стабильному id) — поэтому `@nestjs/schedule` с
 * `@Cron` не нужен, планировщик уже есть в стеке.
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
  /** Сколько файлов удалено как просроченные (обход диска). */
  removedFiles: number;
  /** Сколько опустевших каталогов запусков удалено. */
  removedDirectories: number;
  /** Сколько файлов удалено по `stored_expires_at` из БД (KI-413). */
  removedExpiredDbFiles: number;
  /** Сколько файлов workspace удалено по TTL. */
  removedWorkspaceFiles: number;
  /** Сколько опустевших каталогов workspace удалено. */
  removedWorkspaceDirectories: number;
  /** `true`, если очистка отключена и ничего не делала. */
  skipped: boolean;
}

/**
 * Дополнительные параметры очистки (вне env).
 *
 * Передаются объектом, чтобы unit-тесты могли собрать сервис без БД и без
 * workspace: прежний конструктор `(baseDir, ttlDays)` сохранён совместимым.
 */
export interface MediaCleanupOptions {
  /** Соединение Drizzle: выборка просроченных `node_runs` (KI-413). */
  db?: Database;
  /** Бэкенд хранилища: удаление по `storage_key` имеет смысл только для local. */
  mediaBackend?: 'local' | 's3' | 'none';
  /** Корень workspace (`./data/workspace`); `undefined` — не чистить. */
  workspacePath?: string;
  /** TTL workspace в днях (`0` — не чистить). */
  workspaceTtlDays?: number;
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
 * Сервис ничего не знает о BullMQ — это работа над диском и БД, поэтому его
 * легко проверить юнит-тестом и переиспользовать (например, ручной запуск из
 * скрипта). Расписание задаёт {@link MediaCleanupProcessor}.
 */
@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  /** Соединение с БД (только для выборки просроченных строк). */
  private readonly db: Database | null;

  /** Бэкенд хранилища: S3-ключи локально удалять нельзя. */
  private readonly mediaBackend: 'local' | 's3' | 'none';

  /** Корень workspace либо `null`, если workspace не чистится. */
  private readonly workspacePath: string | null;

  /** TTL workspace в днях. */
  private readonly workspaceTtlDays: number;

  /**
   * @param baseDir - корень локального хранилища (`MEDIA_STORAGE_LOCAL_PATH`)
   * @param ttlDays - TTL файлов в днях (`MEDIA_STORAGE_LOCAL_TTL_DAYS`);
   *   `0` — файлы не удаляются
   * @param options - БД и workspace (KI-413); без них сервис работает как раньше
   */
  constructor(
    private readonly baseDir: string,
    private readonly ttlDays: number,
    options: MediaCleanupOptions = {},
  ) {
    this.db = options.db ?? null;
    this.mediaBackend = options.mediaBackend ?? 'local';
    this.workspacePath =
      options.workspacePath === undefined ? null : resolve(options.workspacePath);
    this.workspaceTtlDays = options.workspaceTtlDays ?? 0;
  }

  /** Включена ли очистка хотя бы одного вида (`TTL=0` везде — выключена). */
  get isEnabled(): boolean {
    return this.ttlDays > 0 || this.isDbCleanupEnabled || this.isWorkspaceCleanupEnabled;
  }

  /** TTL media в днях — для сообщений в логе. */
  get ttlDaysValue(): number {
    return this.ttlDays;
  }

  /**
   * Очистка по БД включена только для local-бэкенда.
   *
   * `storage_key` S3-объекта нельзя скормить локальному `unlink`: это либо
   * no-op, либо (при совпадении ключа с локальным файлом) удаление не того
   * файла. Для S3 удаление объектов — отдельная задача (TTL бакета).
   */
  private get isDbCleanupEnabled(): boolean {
    return this.db !== null && this.mediaBackend === 'local';
  }

  /** Настроена ли очистка workspace. */
  private get isWorkspaceCleanupEnabled(): boolean {
    return this.workspacePath !== null && this.workspaceTtlDays > 0;
  }

  /**
   * Удаляет просроченные файлы media и workspace и опустевшие каталоги.
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
      removedExpiredDbFiles: 0,
      removedWorkspaceFiles: 0,
      removedWorkspaceDirectories: 0,
      skipped: false,
    };

    if (!this.isEnabled) {
      result.skipped = true;
      this.logger.log('TTL очистки равен 0 — очистка пропущена');

      return result;
    }

    if (this.ttlDays > 0) {
      await this.cleanupMediaTreeAsync(now, result);
    }

    // KI-413: TTL из БД — в дополнение к mtime, а не вместо него.
    if (this.isDbCleanupEnabled) {
      await this.cleanupExpiredFromDbAsync(now, result);
    }

    if (this.isWorkspaceCleanupEnabled) {
      await this.cleanupWorkspaceAsync(now, result);
    }

    if (
      result.removedFiles > 0 ||
      result.removedDirectories > 0 ||
      result.removedExpiredDbFiles > 0 ||
      result.removedWorkspaceFiles > 0 ||
      result.removedWorkspaceDirectories > 0
    ) {
      this.logger.log(
        `Очистка хранилища: media-файлов ${result.removedFiles}, ` +
          `каталогов ${result.removedDirectories}, по БД ${result.removedExpiredDbFiles}, ` +
          `workspace-файлов ${result.removedWorkspaceFiles}, ` +
          `workspace-каталогов ${result.removedWorkspaceDirectories} ` +
          `(просмотрено ${result.scannedFiles}, TTL media ${this.ttlDays} дн.)`,
      );
    }

    return result;
  }

  /**
   * Обходит `./data/media/<runId>/` и удаляет файлы старше TTL по mtime.
   *
   * @param now - точка отсчёта TTL
   * @param result - накопительная статистика прохода
   * @returns промис без значения
   */
  private async cleanupMediaTreeAsync(
    now: Date,
    result: MediaCleanupResult,
  ): Promise<void> {
    const cutoffMs = now.getTime() - this.ttlDays * DAY_MS;
    const runDirs = await this.readDirSafeAsync(this.baseDir);

    if (runDirs === null) {
      return;
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
  }

  /**
   * Удаляет локальные файлы, у которых истёк `node_runs.stored_expires_at`
   * (KI-413).
   *
   * Запрос идёт по индексу не обязательно (таблицы node_runs обычно небольшие
   * для дневного прохода), но условия узкие: `storage_key IS NOT NULL` и
   * `stored_expires_at <= now`. Удаление — по ключу, через тот же
   * path-traversal-guard, что у хранилища (RULES 1.9).
   *
   * @param now - точка отсчёта
   * @param result - накопительная статистика прохода
   * @returns промис без значения
   */
  private async cleanupExpiredFromDbAsync(
    now: Date,
    result: MediaCleanupResult,
  ): Promise<void> {
    const db = this.db;

    if (db === null) {
      return;
    }

    let rows: Array<{ storageKey: string | null }>;

    try {
      rows = await db
        .select({ storageKey: nodeRuns.storageKey })
        .from(nodeRuns)
        .where(
          and(
            isNotNull(nodeRuns.storageKey),
            lte(nodeRuns.storedExpiresAt, now),
          ),
        );
    } catch (error: unknown) {
      // БД недоступна — проход по диску уже выполнен, не роняем cron.
      this.logger.warn(
        `Не удалось прочитать просроченные node_runs для очистки: ${toErrorMessage(error)}`,
      );

      return;
    }

    for (const row of rows) {
      if (row.storageKey === null) {
        continue;
      }

      try {
        const filePath = resolveMediaStoragePath(this.baseDir, row.storageKey);

        await unlink(filePath);
        result.removedExpiredDbFiles += 1;
      } catch (error: unknown) {
        // Файла нет — строка БД «старше» диска, это не ошибка.
        if (hasErrorCode(error, 'ENOENT')) {
          continue;
        }

        this.logger.warn(
          `Не удалось удалить media-файл по storage_key ${row.storageKey}: ` +
            `${toErrorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Удаляет файлы workspace старше `WORKSPACE_TTL_DAYS` (KI-413).
   *
   * Рекурсивный обход: `write_file` создаёт вложенные каталоги
   * (`notes/2026-10-18.txt`), поэтому плоского обхода мало. Symlink'и
   * пропускаются (`isFile()` у них `false`), за корень workspace уборка не
   * выходит. Корневой каталог не удаляется.
   *
   * @param now - точка отсчёта TTL
   * @param result - накопительная статистика прохода
   * @returns промис без значения
   */
  private async cleanupWorkspaceAsync(
    now: Date,
    result: MediaCleanupResult,
  ): Promise<void> {
    const root = this.workspacePath;

    if (root === null) {
      return;
    }

    const cutoffMs = now.getTime() - this.workspaceTtlDays * DAY_MS;

    await this.cleanupWorkspaceDirAsync(root, root, cutoffMs, result);
  }

  /**
   * Рекурсивно чистит один каталог workspace и удаляет его, если он опустел.
   *
   * @param dir - абсолютный путь каталога
   * @param root - корень workspace: выход за него запрещён (RULES 1.9)
   * @param cutoffMs - порог mtime (мс): файлы старше удаляются
   * @param result - накопительная статистика прохода
   * @returns сколько файлов удалено в этом поддереве
   */
  private async cleanupWorkspaceDirAsync(
    dir: string,
    root: string,
    cutoffMs: number,
    result: MediaCleanupResult,
  ): Promise<number> {
    const entries = await this.readDirSafeAsync(dir);

    if (entries === null) {
      return 0;
    }

    let removedInDir = 0;

    for (const entry of entries) {
      const entryPath = join(dir, entry.name);

      // RULES 1.9: только внутри корня workspace. Пути строятся из `readdir`,
      // но проверка не лишняя — она же защищает от symlink-выходов.
      if (!entryPath.startsWith(`${root}${sep}`)) {
        continue;
      }

      if (entry.isDirectory()) {
        const removedChild = await this.cleanupWorkspaceDirAsync(
          entryPath,
          root,
          cutoffMs,
          result,
        );

        // Учитываем удаления во всём поддереве: родитель должен знать, что
        // после чистки ребёнка он сам мог опустеть.
        removedInDir += removedChild;

        // Пустой (после уборки) каталог убираем: иначе workspace зарастает
        // пустыми папками workflow, в которые больше никто не пишет.
        if (removedChild > 0) {
          try {
            await rmdir(entryPath);
            result.removedWorkspaceDirectories += 1;
          } catch (error: unknown) {
            if (
              !hasErrorCode(error, 'ENOTEMPTY') &&
              !hasErrorCode(error, 'ENOENT')
            ) {
              this.logger.warn(
                `Не удалось удалить каталог workspace ${entryPath}: ` +
                  `${toErrorMessage(error)}`,
              );
            }
          }
        }

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const info = await stat(entryPath);

        if (info.mtimeMs >= cutoffMs) {
          continue;
        }

        await unlink(entryPath);
        removedInDir += 1;
        result.removedWorkspaceFiles += 1;
      } catch (error: unknown) {
        // Файл уже удалён параллельным проходом — это не ошибка.
        if (hasErrorCode(error, 'ENOENT')) {
          continue;
        }

        this.logger.warn(
          `Не удалось удалить файл workspace ${entryPath}: ${toErrorMessage(error)}`,
        );
      }
    }

    return removedInDir;
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
        `Не удалось прочитать каталог ${dir}: ${toErrorMessage(error)}`,
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
 * обновляет одно и то же расписание по стабильному id. Требование «daily 3 AM»
 * выполнено cron-паттерном {@link MEDIA_CLEANUP_CRON}.
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
        'TTL очистки равен 0 — cron-очистка не регистрируется (KI-413)',
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
        `Cron-очистка зарегистрирована: "${MEDIA_CLEANUP_CRON}" ` +
          `(TTL media ${this.cleanup.ttlDaysValue} дн.)`,
      );
    } catch (error: unknown) {
      // Redis мог быть недоступен в момент старта: приложение продолжает
      // работать, расписание попробует обновиться при следующем рестарте.
      this.logger.error(
        `Не удалось зарегистрировать cron-очистку: ${toErrorMessage(error)}`,
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
      `Задание очистки выполнено: media-файлов ${result.removedFiles}, ` +
        `каталогов ${result.removedDirectories}, по БД ${result.removedExpiredDbFiles}, ` +
        `workspace-файлов ${result.removedWorkspaceFiles}`,
    );
  }
}

/**
 * Nest-провайдер сервиса очистки: env превращается в параметры в одном месте.
 *
 * Дефолты совпадают со схемой окружения (`MediaStorageEnvSchema`) — сюда они
 * попадают уже применёнными `ConfigService`, fallback оставлен для вызовов вне
 * приложения. Путь workspace — тот же, что у `FilesystemService`:
 * `resolve(process.cwd(), 'data', 'workspace')` (RULES 4.38).
 */
export const mediaCleanupProvider = {
  provide: MediaCleanupService,
  inject: [ConfigService, DRIZZLE],
  useFactory: (config: ConfigService, db: Database): MediaCleanupService =>
    new MediaCleanupService(
      config.get<string>('MEDIA_STORAGE_LOCAL_PATH') ?? './data/media',
      config.get<number>('MEDIA_STORAGE_LOCAL_TTL_DAYS') ?? 30,
      {
        db,
        mediaBackend:
          config.get<'local' | 's3' | 'none'>('MEDIA_STORAGE_BACKEND') ?? 'local',
        workspacePath: resolve(process.cwd(), 'data', 'workspace'),
        workspaceTtlDays: config.get<number>('WORKSPACE_TTL_DAYS') ?? 30,
      },
    ),
};
