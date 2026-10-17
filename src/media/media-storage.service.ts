import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

/**
 * Хранилище media-результатов (R7.8, KI-362).
 *
 * Проблема: CreativeLab отдаёт ссылки на результат, живущие 48 часов. Через
 * двое суток история запусков (`node_runs.outputs`) содержит мёртвые ссылки.
 * Решение — скачать результат сразу после генерации и сохранить у себя, а в
 * `node_runs.stored_url` положить **свою** ссылку (DESIGN § 3.8).
 *
 * Два слоя:
 * - {@link LocalMediaStorage} (по умолчанию) — файлы на диске
 *   (`./data/media/<runId>/<nodeId>.<ext>`), отдаются ручкой
 *   `GET /media/file/:runId/:fileName`;
 * - {@link S3MediaStorage} — S3-совместимое хранилище. Пока это заглушка:
 *   параметры валидируются, но загрузка не выполняется (нет SDK в
 *   зависимостях), поэтому узел честно живёт на ссылке провайдера и пишет
 *   предупреждение в лог.
 *
 * `none` — сохранение выключено (прежнее поведение).
 */

/** Инъекционный токен хранилища. */
export const MEDIA_STORAGE = 'MEDIA_STORAGE';

/** Поддерживаемые бэкенды хранилища. */
export type MediaStorageBackend = 'local' | 's3' | 'none';

/** Что скачать и куда положить. */
export interface MediaUploadInput {
  /** uuid запуска: первый сегмент ключа (изоляция файлов запуска). */
  runId: string;
  /** id узла в графе: второй сегмент ключа. */
  nodeId: string;
  /** Ссылка провайдера на результат (`resultUrls[0]`). */
  sourceUrl: string;
  /** `Content-Type` ответа, если известен (влияет на расширение файла). */
  contentType?: string | null;
}

/** Результат сохранения файла. */
export interface MediaStoredFile {
  /** Своя ссылка для UI (`/media/file/<runId>/<fileName>`). */
  storedUrl: string;
  /** Когда ссылка перестанет быть доступной (`null` — без TTL). */
  storedExpiresAt: Date | null;
  /** Ключ внутри хранилища (`<runId>/<fileName>`). */
  storageKey: string;
  /** Размер файла в байтах. */
  bytes: number;
}

/** Открытый файл для отдачи по HTTP. */
export interface MediaReadResult {
  /** Поток чтения файла. */
  stream: Readable;
  /** MIME-тип по расширению. */
  contentType: string;
  /** Размер в байтах (`Content-Length`). */
  bytes: number;
}

/** Интерфейс хранилища: реализации взаимозаменяемы. */
export interface IMediaStorage {
  /** Бэкенд хранилища (для логов и диагностики). */
  readonly backend: MediaStorageBackend;

  /**
   * Скачивает результат провайдера и сохраняет его.
   *
   * @param input - что скачать и куда (ключ строится из runId/nodeId)
   * @returns сохранённый файл либо `null`, если бэкенд не сохраняет
   * @throws Error при сетевом сбое, превышении лимита размера или ошибке записи
   */
  uploadAsync(input: MediaUploadInput): Promise<MediaStoredFile | null>;

  /**
   * Открывает сохранённый файл для отдачи.
   *
   * @param storageKey - ключ `<runId>/<fileName>`
   * @returns поток и тип либо `null`, если файла нет
   * @throws Error если ключ недопустим (выход за пределы каталога)
   */
  openAsync(storageKey: string): Promise<MediaReadResult | null>;
}

/** Таймаут скачивания результата провайдера (мс). */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Максимальный размер скачиваемого файла (байт) — 200 МБ.
 *
 * Видео бывает тяжёлым, но без потолка битый/враждебный upstream мог бы
 * забить диск. Ограничение проверяется и по `Content-Length`, и по факту
 * записи (прокси может его не отдать).
 */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/** MIME-тип → расширение файла. */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
};

/** Расширения, которые принимаем из URL, если upstream не отдал `Content-Type`. */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'mp4',
  'webm',
  'mov',
  'mp3',
  'wav',
  'ogg',
  'aac',
]);

/** MIME-тип по расширению — для ответа `GET /media/file/...`. */
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
};

/**
 * Приводит сегмент ключа к безопасному виду (RULES 1.9).
 *
 * `nodeId` приходит из графа workflow — то есть от пользователя. Без
 * нормализации `../../etc` увёл бы запись за пределы каталога хранилища, поэтому
 * всё, кроме `[A-Za-z0-9._-]`, заменяется на `_`, а `..` вырезается.
 *
 * @param value - сырой сегмент
 * @returns безопасный непустой сегмент
 */
export function sanitizeStorageSegment(value: string): string {
  const cleaned = value
    .replace(/\.\./g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[._]+/, '');

  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'unknown';
}

/**
 * Выбирает расширение файла по `Content-Type` и URL.
 *
 * @param sourceUrl - ссылка провайдера
 * @param contentType - `Content-Type` ответа (может быть `null`)
 * @returns расширение без точки
 */
export function resolveFileExtension(
  sourceUrl: string,
  contentType?: string | null,
): string {
  const mime = contentType?.split(';')[0]?.trim().toLowerCase();

  if (mime !== undefined && EXTENSION_BY_CONTENT_TYPE[mime] !== undefined) {
    return EXTENSION_BY_CONTENT_TYPE[mime];
  }

  let fromUrl = '';

  try {
    fromUrl = extname(new URL(sourceUrl).pathname).replace(/^\./, '').toLowerCase();
  } catch {
    // Невалидный URL: расширение неизвестно, файл сохранится как `.bin`.
    fromUrl = '';
  }

  return KNOWN_EXTENSIONS.has(fromUrl) ? fromUrl : 'bin';
}

/**
 * Проверяет, что ключ не выводит за пределы каталога хранилища.
 *
 * @param baseDir - корневой каталог (абсолютный)
 * @param storageKey - ключ `<runId>/<fileName>`
 * @returns абсолютный путь к файлу
 * @throws Error если ключ недопустим или ведёт за пределы каталога
 */
function resolveInsideBase(baseDir: string, storageKey: string): string {
  const root = resolve(baseDir);
  const target = resolve(root, storageKey);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Ключ хранилища выходит за пределы каталога: ${storageKey}`);
  }

  return target;
}

/**
 * Локальное хранилище media-файлов на диске (DESIGN § 3.8, слой 1).
 *
 * Файлы лежат вне `dist/` (в `./data/media`), поэтому переживают пересборку.
 * Каталог создаётся при загрузке; TTL считается от момента записи и только
 * записывается в `stored_expires_at` — физическое удаление файлов по TTL в
 * этом срезе не выполняется (см. отчёт R7.8; отдельная задача — cron).
 */
@Injectable()
export class LocalMediaStorage implements IMediaStorage {
  readonly backend = 'local' as const;

  private readonly logger = new Logger(LocalMediaStorage.name);

  /**
   * @param baseDir - корневой каталог файлов (`MEDIA_STORAGE_LOCAL_PATH`)
   * @param ttlDays - TTL ссылки в днях (`0` — без срока)
   * @param publicPrefix - префикс URL отдачи (по умолчанию `/media/file`)
   */
  constructor(
    private readonly baseDir: string,
    private readonly ttlDays: number,
    private readonly publicPrefix = '/media/file',
  ) {}

  /**
   * Скачивает результат провайдера и пишет его на диск.
   *
   * @param input - ссылка, runId и nodeId
   * @returns сохранённый файл
   * @throws Error если upstream ответил ошибкой, файл больше лимита или запись
   *   не удалась
   */
  async uploadAsync(input: MediaUploadInput): Promise<MediaStoredFile> {
    const response = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Не удалось скачать media-результат (${response.status}): ${input.sourceUrl}`,
      );
    }

    // Расширение: явный `contentType` → заголовок ответа → расширение URL.
    // Заголовок читается до записи: у ссылок CreativeLab расширения в пути
    // часто нет, и файл сохранился бы как `.bin` без правильного MIME.
    const fileName = `${sanitizeStorageSegment(input.nodeId)}.${resolveFileExtension(
      input.sourceUrl,
      input.contentType ?? response.headers.get('content-type'),
    )}`;
    const storageKey = `${sanitizeStorageSegment(input.runId)}/${fileName}`;
    const target = resolveInsideBase(this.baseDir, storageKey);

    await mkdir(resolve(this.baseDir, sanitizeStorageSegment(input.runId)), {
      recursive: true,
    });

    const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);

    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `Media-результат больше лимита (${declaredLength} > ${MAX_DOWNLOAD_BYTES} байт)`,
      );
    }

    if (response.body === null) {
      throw new Error('Upstream вернул пустое тело media-результата');
    }

    let bytes = 0;

    // Счётчик размера: `Content-Length` может отсутствовать (chunked), поэтому
    // потолок проверяется и по факту записи.
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        bytes += chunk.byteLength;

        if (bytes > MAX_DOWNLOAD_BYTES) {
          callback(
            new Error(`Media-результат больше лимита (${MAX_DOWNLOAD_BYTES} байт)`),
          );

          return;
        }

        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream),
        counter,
        createWriteStream(target),
      );
    } catch (error: unknown) {
      // Частично записанный файл не должен выглядеть как сохранённый результат.
      await unlink(target).catch(() => undefined);
      throw error;
    }

    const storedExpiresAt =
      this.ttlDays > 0
        ? new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000)
        : null;

    this.logger.log(
      `Media сохранена локально: ${storageKey} (${bytes} байт, ttl=${this.ttlDays} дн.)`,
    );

    return {
      storedUrl: `${this.publicPrefix}/${storageKey}`,
      storedExpiresAt,
      storageKey,
      bytes,
    };
  }

  /**
   * Открывает сохранённый файл для отдачи.
   *
   * @param storageKey - ключ `<runId>/<fileName>`
   * @returns поток, MIME-тип и размер либо `null`, если файла нет
   * @throws Error если ключ выходит за пределы каталога
   */
  async openAsync(storageKey: string): Promise<MediaReadResult | null> {
    const target = resolveInsideBase(this.baseDir, storageKey);
    const extension = extname(target).replace(/^\./, '').toLowerCase();

    try {
      const info = await stat(target);

      if (!info.isFile()) {
        return null;
      }

      return {
        stream: createReadStream(target),
        contentType: CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream',
        bytes: info.size,
      };
    } catch {
      return null;
    }
  }
}

/**
 * S3-совместимое хранилище (DESIGN § 3.8, слой 2) — **заглушка**.
 *
 * В зависимостях нет S3-SDK, а подписывать запросы SigV4 вручную ради среза
 * R7.8 — несоразмерно (и непроверяемо без живого бакета). Поэтому класс
 * реализует интерфейс и честно сообщает, что загрузка не выполнена: узел
 * остаётся на ссылке провайдера (48 ч), а в лог уходит предупреждение.
 * Подключение настоящего SDK — отдельный KI (см. отчёт).
 */
@Injectable()
export class S3MediaStorage implements IMediaStorage {
  readonly backend = 's3' as const;

  private readonly logger = new Logger(S3MediaStorage.name);

  /**
   * @param endpoint - S3 endpoint (для сообщения в логе)
   * @param bucket - бакет (для сообщения в логе)
   */
  constructor(
    private readonly endpoint: string | undefined,
    private readonly bucket: string | undefined,
  ) {}

  /**
   * Не сохраняет файл: S3-бэкенд ещё не реализован.
   *
   * @param _input - что скачать (не используется)
   * @returns всегда `null` («файл не сохранён»), чтобы узел не падал
   */
  async uploadAsync(_input: MediaUploadInput): Promise<MediaStoredFile | null> {
    this.logger.warn(
      `MEDIA_STORAGE_BACKEND=s3, но S3-загрузка не реализована ` +
        `(endpoint=${this.endpoint ?? 'не задан'}, bucket=${this.bucket ?? 'не задан'}) — ` +
        'используется ссылка провайдера',
    );

    return null;
  }

  /**
   * S3-бэкенд не отдаёт файлы через этот сервис.
   *
   * @param _storageKey - ключ (не используется)
   * @returns всегда `null`
   */
  async openAsync(_storageKey: string): Promise<MediaReadResult | null> {
    return null;
  }
}

/**
 * Хранилище-«ничего не сохранять» (`MEDIA_STORAGE_BACKEND=none`).
 *
 * Поведение до R7.8: `node_runs.stored_url` остаётся `NULL`, UI показывает
 * ссылку провайдера.
 */
@Injectable()
export class NoopMediaStorage implements IMediaStorage {
  readonly backend = 'none' as const;

  /**
   * Ничего не сохраняет.
   *
   * @param _input - что скачать (не используется)
   * @returns всегда `null`
   */
  async uploadAsync(_input: MediaUploadInput): Promise<MediaStoredFile | null> {
    return null;
  }

  /**
   * Нет файлов для отдачи.
   *
   * @param _storageKey - ключ (не используется)
   * @returns всегда `null`
   */
  async openAsync(_storageKey: string): Promise<MediaReadResult | null> {
    return null;
  }
}

/**
 * Собирает хранилище по env (R7.8).
 *
 * @param config - доступ к env (RULES 4.6); без него — `local` с дефолтами
 * @returns реализация хранилища
 */
export function createMediaStorage(config?: ConfigService): IMediaStorage {
  const backend =
    config?.get<MediaStorageBackend>('MEDIA_STORAGE_BACKEND') ?? 'local';

  if (backend === 'none') {
    return new NoopMediaStorage();
  }

  if (backend === 's3') {
    return new S3MediaStorage(
      config?.get<string>('S3_ENDPOINT'),
      config?.get<string>('S3_BUCKET'),
    );
  }

  return new LocalMediaStorage(
    config?.get<string>('MEDIA_STORAGE_LOCAL_PATH') ?? './data/media',
    config?.get<number>('MEDIA_STORAGE_LOCAL_TTL_DAYS') ?? 30,
  );
}

/**
 * Nest-провайдер хранилища: единственная точка, где env превращается в
 * реализацию. Исполнитель media-узла получает её по токену
 * {@link MEDIA_STORAGE}, поэтому в тестах достаточно подставить заглушку.
 */
export const mediaStorageProvider = {
  provide: MEDIA_STORAGE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IMediaStorage => createMediaStorage(config),
};
