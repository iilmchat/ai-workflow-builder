import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
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
 * - {@link S3MediaStorage} — S3-совместимое хранилище (AWS S3, MinIO, R2,
 *   Yandex Object Storage): результат **потоком** кладётся в бакет через
 *   `Upload` из `@aws-sdk/lib-storage` (KI-412, KI-427, KI-442), а `storedUrl`
 *   для приватного бакета — presigned GET на 1 час
 *   (`@aws-sdk/s3-request-presigner`, KI-425). Просроченная ссылка
 *   переподписывается на чтении (KI-443). Если параметры не заданы или S3
 *   недоступен, {@link createMediaStorage} откатывается на local, а сама
 *   загрузка в S3 возвращает `null` — узел остаётся на ссылке провайдера.
 *
 * `none` — сохранение выключено (прежнее поведение).
 *
 * **v0.10 S5.** Кроме файлов, скачанных по ссылке провайдера, хранилище умеет
 * сохранять сгенерированные приложением документы (`saveGeneratedAsync`):
 * источник — `Buffer` (DOCX/PDF), а не URL. Ключ и ссылка возвращаются
 * вызывающему коду, который пишет ключ в `node_runs.storage_key` (KI-451).
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

/** Обновлённая ссылка на сохранённый файл (KI-443). */
export interface MediaRefreshedUrl {
  /** Свежая ссылка, пригодная для UI. */
  storedUrl: string;
  /** Когда обновлённая ссылка перестанет быть доступной. */
  storedExpiresAt: Date | null;
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

/**
 * Результат сохранения файла, сгенерированного приложением (v0.10 S5).
 *
 * В отличие от {@link MediaStoredFile}, здесь нет TTL и размера: документ
 * создаётся в памяти и сохраняется сразу, а вызывающий код (исполнитель
 * `document_generation`, S6) знает и байты, и формат. `null` в обоих полях
 * означает «бэкенд не сохраняет файлы» (`MEDIA_STORAGE_BACKEND=none`) либо
 * необязательный S3 недоступен — вызывающий код сам решает, показывать
 * ошибку или отдать буфер иначе.
 */
export interface MediaGeneratedFile {
  /** Ссылка для UI (`/media/file/...`, presigned или прямой S3 URL). */
  url: string | null;
  /** Ключ объекта в хранилище (`<runId>/generated-<nodeId>.<ext>`). */
  key: string | null;
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
   * Сохраняет файл, сгенерированный приложением (v0.10 S5).
   *
   * В отличие от {@link uploadAsync}, источник — не URL провайдера, а готовый
   * буфер в памяти: DOCX/PDF рендерер отдаёт `Packer.toBuffer`, и скачивать
   * нечего. Ключ строится по тому же принципу, что у media-результатов
   * (`<runId>/<файл>`), но имя фиксировано префиксом `generated-`, чтобы не
   * столкнуться с файлом, скачанным по `nodeId.<ext>`.
   *
   * @param buffer - содержимое файла
   * @param extension - расширение без точки (`docx`, `pdf`); приводится к
   *   нижнему регистру, недопустимое значение заменяется на `bin`
   * @param runId - uuid запуска (первый сегмент ключа)
   * @param nodeId - id узла графа (часть имени файла; санитизируется)
   * @returns ссылка и ключ объекта; `{ url: null, key: null }`, если бэкенд
   *   не сохраняет файлы либо S3 не настроен/недоступен
   * @throws Error если локальная запись не удалась (диск, права)
   */
  saveGeneratedAsync(
    buffer: Buffer,
    extension: string,
    runId: string,
    nodeId: string,
  ): Promise<MediaGeneratedFile>;

  /**
   * Открывает сохранённый файл для отдачи.
   *
   * @param storageKey - ключ `<runId>/<fileName>`
   * @returns поток и тип либо `null`, если файла нет
   * @throws Error если ключ недопустим (выход за пределы каталога)
   */
  openAsync(storageKey: string): Promise<MediaReadResult | null>;

  /**
   * Переподписывает ссылку на сохранённый файл, если это поддерживает бэкенд.
   *
   * Нужен для `node_runs.stored_url`: у приватного бакета S3 это presigned GET
   * на час (KI-425), и после истечения ссылка отдаёт 403 (KI-443). Хранилище
   * само решает, умеет ли оно обновлять ссылку: local возвращает `null`
   * (относительный URL не подписывается и не истекает).
   *
   * @param storedUrl - ссылка из `node_runs.stored_url`
   * @returns свежая ссылка с новым сроком либо `null`, если обновление не
   *   поддерживается или невозможно
   */
  refreshStoredUrlAsync(storedUrl: string): Promise<MediaRefreshedUrl | null>;
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

/**
 * Время жизни presigned GET-ссылки на объект S3 (сек) — KI-425.
 *
 * Ровно столько `storedUrl` приватного бакета остаётся рабочей: presigned URL
 * не продлевается автоматически. Повторная подпись при чтении —
 * {@link S3MediaStorage.getSignedUrlAsync}.
 */
export const S3_SIGNED_URL_TTL_SECONDS = 3600;

/** Миллисекунд в сутках — TTL бакета задаётся в днях. */
const DAY_MS = 24 * 60 * 60 * 1000;

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
  // v0.10 S5: документы отдаются той же ручкой `GET /media/file/...`.
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
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
 * Нормализует расширение сгенерированного файла (v0.10 S5).
 *
 * Расширение приходит из кода, но проходит через те же границы, что и
 * пользовательские данные: `extension` попадает в имя файла и S3-ключ.
 * Поэтому ведущие точки срезаются, регистр приводится к нижнему, а всё, кроме
 * `[a-z0-9]`, отбрасывается заменой на `bin`. Так `../../evil` не станет
 * частью пути, а `docx` и `.DOCX` дадут один и тот же ключ.
 *
 * @param extension - расширение с точкой или без
 * @returns безопасное расширение без точки (непустое)
 */
export function normalizeGeneratedExtension(extension: string): string {
  const cleaned = extension.trim().replace(/^\.+/, '').toLowerCase();

  return /^[a-z0-9]{1,12}$/.test(cleaned) ? cleaned : 'bin';
}

/**
 * Строит ключ сгенерированного файла: `<runId>/generated-<nodeId>.<ext>`.
 *
 * @param runId - uuid запуска
 * @param nodeId - id узла графа
 * @param extension - расширение (нормализуется внутри)
 * @returns безопасный ключ объекта для local и S3
 */
export function buildGeneratedStorageKey(
  runId: string,
  nodeId: string,
  extension: string,
): string {
  const fileName = `generated-${sanitizeStorageSegment(nodeId)}.${normalizeGeneratedExtension(
    extension,
  )}`;

  return `${sanitizeStorageSegment(runId)}/${fileName}`;
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
 *
 * Сгенерированные документы (`saveGeneratedAsync`, v0.10 S5) лежат в том же
 * каталоге с префиксом `generated-` и отдаются той же HTTP-ручкой.
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
   * Сохраняет сгенерированный документ на диск (v0.10 S5).
   *
   * Запись атомарная: буфер пишется во временный файл рядом с целевым и
   * переименовывается. Читатель (HTTP-ручка) не увидит половину DOCX, если
   * процесс упадёт посреди записи; при ошибке временный файл удаляется.
   *
   * @param buffer - содержимое файла
   * @param extension - расширение без точки
   * @param runId - uuid запуска
   * @param nodeId - id узла графа
   * @returns ключ и относительная ссылка `/media/file/...`
   * @throws Error если каталог создать или файл записать не удалось
   */
  async saveGeneratedAsync(
    buffer: Buffer,
    extension: string,
    runId: string,
    nodeId: string,
  ): Promise<MediaGeneratedFile> {
    const storageKey = buildGeneratedStorageKey(runId, nodeId, extension);
    const target = resolveInsideBase(this.baseDir, storageKey);
    const tempTarget = resolveInsideBase(
      this.baseDir,
      `${storageKey}.${randomUUID()}.tmp`,
    );

    await mkdir(dirname(target), { recursive: true });

    try {
      await writeFile(tempTarget, buffer);
      await rename(tempTarget, target);
    } catch (error: unknown) {
      // Частично записанный .tmp не должен остаться мусором в хранилище.
      await unlink(tempTarget).catch(() => undefined);
      throw error;
    }

    this.logger.log(
      `Сгенерированный файл сохранён локально: ${storageKey} ` +
        `(${buffer.byteLength} байт)`,
    );

    return {
      url: `${this.publicPrefix}/${storageKey}`,
      key: storageKey,
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

  /**
   * Локальная ссылка не переподписывается.
   *
   * `storedUrl` локального хранилища — относительный путь
   * `/media/file/<runId>/<fileName>`: у него нет подписи, и 403 он не отдаёт.
   * `storedExpiresAt` здесь означает срок хранения файла, а не срок жизни
   * ссылки, поэтому обновлять нечего.
   *
   * @param _storedUrl - сохранённая ссылка (не используется)
   * @returns всегда `null`
   */
  async refreshStoredUrlAsync(
    _storedUrl: string,
  ): Promise<MediaRefreshedUrl | null> {
    return null;
  }
}

/**
 * Параметры S3-хранилища (все — из env, KI-412).
 *
 * Передаются объектом, а не позиционными аргументами: настройка состоит из
 * шести значений, и перепутать `accessKeyId` с `secretAccessKey` при вызове
 * слишком легко.
 */
export interface S3MediaStorageOptions {
  /** S3-совместимый endpoint (`S3_ENDPOINT`). */
  endpoint?: string;
  /** Бакет (`S3_BUCKET`). */
  bucket?: string;
  /** Access key (`S3_ACCESS_KEY_ID`). */
  accessKeyId?: string;
  /** Secret key (`S3_SECRET_ACCESS_KEY`). */
  secretAccessKey?: string;
  /** Регион (`S3_REGION`); для MinIO/R2 обычно `us-east-1`. */
  region?: string;
  /** TTL ссылки в днях (`S3_TTL_DAYS`, `0` — без срока). */
  ttlDays?: number;
  /**
   * Публичный ли бакет (KI-425).
   *
   * `true` — `storedUrl` собирается прямым URL `<endpoint>/<bucket>/<key>`;
   * `false` или не задано — presigned GET на {@link S3_SIGNED_URL_TTL_SECONDS}.
   * По умолчанию флаг не выставлен, и хранилище отдаёт **signed URL**: для
   * приватного бакета прямой URL даёт 403, поэтому неизвестность трактуется в
   * безопасную сторону. Флаг читается из env `S3_PUBLIC_BUCKET` (KI-444).
   */
  publicBucket?: boolean;
  /**
   * Готовый клиент S3. Подменяется в тестах, чтобы не ходить в сеть; в
   * приложении не задаётся — клиент собирается из env.
   */
  client?: S3ClientLike;
}

/**
 * Минимальная граница S3-клиента, достаточная хранилищу и `Upload`.
 *
 * Реальный `S3Client` ей соответствует, а в тестах подставляется объект с
 * `send` и `config` реального клиента — без сети и без моков целого SDK.
 * `config` нужен `Upload`: он читает `endpoint`, `forcePathStyle` и
 * `requestChecksumCalculation`, чтобы собрать multipart-запрос.
 */
export interface S3ClientLike {
  /** Конфигурация клиента (для `Upload`: endpoint, path-style, checksums). */
  readonly config: S3Client['config'];
  /** Отправляет команду в S3. */
  send(command: PutObjectCommand): Promise<unknown>;
}

/** Проверенные (непустые) параметры подключения к S3. */
interface ResolvedS3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * S3-совместимое хранилище media-результатов (DESIGN § 3.8, слой 2).
 *
 * Результат провайдера скачивается потоком и кладётся в бакет через
 * `Upload` из `@aws-sdk/lib-storage` (KI-412, KI-442). `Upload` читает поток
 * чанками по 5 МБ и передаёт в SDK **буфер**, поэтому автоматический ретрай
 * (сеть, 5xx, таймаут) повторяет запрос с теми же байтами, а не с уже
 * прочитанным одноразовым потоком. Объект больше 5 МБ уходит multipart'ом, и
 * повторяется только упавшая часть. Память при этом ограничена размером
 * чанка (и очередью из четырёх), а не всем 200-мегабайтным видео (KI-427).
 * Ключ объекта — тот же, что у локального слоя: `<runId>/<fileName>`, поэтому
 * `stored_url` и TTL считаются одинаково для обоих бэкендов. Документы,
 * сгенерированные приложением, кладутся тем же `Upload` через
 * `saveGeneratedAsync` (v0.10 S5): для них известен точный `ContentLength`, а
 * `Body` — готовый `Buffer`.
 *
 * **Ссылка.** Для приватного бакета (норма для прода) прямой URL даёт 403,
 * поэтому `storedUrl` — presigned GET на {@link S3_SIGNED_URL_TTL_SECONDS}
 * (`getSignedUrlAsync`, KI-425). Для публичного бакета (`publicBucket: true`)
 * остаётся прямой URL. Если публичность неизвестна, выбирается signed URL —
 * он безопаснее. Просроченная ссылка переподписывается на чтении:
 * {@link refreshStoredUrlAsync} извлекает ключ объекта из URL и подписывает
 * его заново (KI-443).
 *
 * **Отказоустойчивость.** S3 — необязательный слой: если параметры не заданы,
 * upstream ответил ошибкой, файл больше лимита или сам S3 недоступен,
 * {@link uploadAsync} возвращает `null` (и пишет предупреждение), а узел
 * продолжает жить на ссылке провайдера. Исключение здесь было бы хуже:
 * генерация уже оплачена, и терять её результат из-за недоступного хранилища
 * нельзя. При старте такой конфиг откатывается на local —
 * см. {@link createMediaStorage}.
 *
 * @see https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
 * @see https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
 */
@Injectable()
export class S3MediaStorage implements IMediaStorage {
  readonly backend = 's3' as const;

  private readonly logger = new Logger(S3MediaStorage.name);

  /** Клиент создаётся лениво: без настроек S3 он не нужен вовсе. */
  private client: S3ClientLike | null = null;

  /**
   * Настоящий SDK-клиент для подписи URL.
   *
   * `client` может быть подменным объектом с `send` и `config` реального
   * клиента (тесты), а `getSignedUrl` работает с полноценным `S3Client` —
   * поэтому подпись идёт через отдельный клиент, собранный из тех же
   * параметров.
   */
  private signingClient: S3Client | null = null;

  /**
   * @param options - параметры из env (`S3_*`, KI-412)
   */
  constructor(private readonly options: S3MediaStorageOptions = {}) {}

  /**
   * Заданы ли все обязательные параметры S3.
   *
   * Без access/secret key загрузка невозможна: подпись SigV4 не построить.
   * IAM-роль инстанса намеренно не используется — env-контракт R7.8 требует
   * явных ключей, а их отсутствие означает «S3 не настроен» и откат на local.
   */
  get isConfigured(): boolean {
    return this.resolveConfig() !== null;
  }

  /**
   * Скачивает результат провайдера и кладёт его в S3.
   *
   * @param input - ссылка, runId и nodeId
   * @returns сохранённый файл либо `null`, если S3 не настроен/недоступен или
   *   файл превышает лимит (узел остаётся на ссылке провайдера)
   */
  async uploadAsync(input: MediaUploadInput): Promise<MediaStoredFile | null> {
    const config = this.resolveConfig();

    if (config === null) {
      this.logger.warn(
        `MEDIA_STORAGE_BACKEND=s3, но S3 не настроен ` +
          `(endpoint=${this.options.endpoint ?? 'не задан'}, ` +
          `bucket=${this.options.bucket ?? 'не задан'}, ` +
          `accessKeyId=${this.options.accessKeyId ? 'задан' : 'не задан'}, ` +
          `secretAccessKey=${this.options.secretAccessKey ? 'задан' : 'не задан'}) — ` +
          'используется ссылка провайдера',
      );

      return null;
    }

    try {
      const response = await fetch(input.sourceUrl, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `Не удалось скачать media-результат для S3 (${response.status}): ` +
            `${input.sourceUrl} — используется ссылка провайдера`,
        );

        return null;
      }

      const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN);

      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        this.logger.warn(
          `Media-результат больше лимита S3 (${declaredLength} > ${MAX_DOWNLOAD_BYTES} байт): ` +
            `${input.sourceUrl} — используется ссылка провайдера`,
        );

        return null;
      }

      if (response.body === null) {
        this.logger.warn(
          `Upstream вернул пустое тело media-результата: ${input.sourceUrl} — ` +
            'используется ссылка провайдера',
        );

        return null;
      }

      const responseContentType = response.headers.get('content-type');
      // Параметры вида `; charset=binary` в метаданные объекта не пишем:
      // `Content-Type` S3 должен быть чистым MIME-типом.
      const contentType =
        (input.contentType ?? responseContentType ?? 'application/octet-stream')
          .split(';')[0]
          ?.trim() || 'application/octet-stream';
      const fileName = `${sanitizeStorageSegment(input.nodeId)}.${resolveFileExtension(
        input.sourceUrl,
        contentType,
      )}`;
      const storageKey = `${sanitizeStorageSegment(input.runId)}/${fileName}`;

      // KI-427/KI-442: поток из `fetch` остаётся потоком (память не растёт на
      // весь файл), но в S3 его отдаёт `Upload`, а не `PutObjectCommand`.
      // `Upload` читает тело чанками (по умолчанию 5 МБ) и отправляет в SDK
      // буфер: при ретрае SDK повторяет запрос с теми же байтами. Одноразовый
      // поток в `Body` после первого чтения повторно отправить нельзя, поэтому
      // прежняя схема теряла результат на транзиентном сбое (KI-442).
      let bytes = 0;
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
      const source = Readable.fromWeb(response.body as unknown as NodeReadableStream);
      // `pipe` не пробрасывает ошибку источника в приёмник: без этого `Upload`
      // ждал бы данные от уже сломанного потока.
      source.on('error', (error: Error) => {
        counter.destroy(error);
      });

      const body = source.pipe(counter);

      try {
        const upload = new Upload({
          // `client` в тестах — объект с `send` и `config` реального клиента;
          // `Upload` читает из `config` endpoint/path-style/checksums.
          client: this.getClient(config) as unknown as S3Client,
          params: {
            Bucket: config.bucket,
            Key: storageKey,
            Body: body,
            ContentType: contentType,
            // Длину передаём только если upstream её назвал: для chunked
            // `ContentLength` неизвестен, и `Upload` определит размер по
            // фактически прочитанным чанкам.
            ...(Number.isFinite(declaredLength) ? { ContentLength: declaredLength } : {}),
          },
          // Упавшая multipart-загрузка не должна оставлять части в бакете.
          leavePartsOnError: false,
        });

        await upload.done();
      } catch (error: unknown) {
        // Поток не дочитан — освобождаем сокет upstream.
        body.destroy();
        source.destroy();

        throw error;
      }

      const ttlDays = this.options.ttlDays ?? 0;
      // Ссылка строится по ключу (KI-451): `storage_key` сохраняется явно,
      // поэтому переподпись не зависит от формата URL.
      const { url: storedUrl, signed } = await this.resolveStoredUrlAsync(
        config,
        storageKey,
      );

      // Срок жизни ссылки: у signed URL он свой (час), у прямого — TTL бакета.
      const storedExpiresAt = signed
        ? new Date(Date.now() + S3_SIGNED_URL_TTL_SECONDS * 1000)
        : ttlDays > 0
          ? new Date(Date.now() + ttlDays * DAY_MS)
          : null;
      // Если upstream назвал длину, она и есть размер отправленного объекта:
      // счётчик остаётся страховкой для chunked-ответов без `Content-Length`.
      const uploadedBytes = Number.isFinite(declaredLength) ? declaredLength : bytes;

      this.logger.log(
        `Media сохранена в S3: ${storageKey} (${uploadedBytes} байт, ttl=${ttlDays} дн., ` +
          `${signed ? 'signed' : 'direct'} url)`,
      );

      return {
        storedUrl,
        storedExpiresAt,
        storageKey,
        bytes: uploadedBytes,
      };
    } catch (error: unknown) {
      // Сеть/S3 упали: результат генерации не теряем, узел живёт на ссылке
      // провайдера (48 ч), а причина остаётся в логе.
      this.logger.warn(
        `S3-загрузка не удалась (${toErrorMessage(error)}): ${input.sourceUrl} — ` +
          'используется ссылка провайдера',
      );

      return null;
    }
  }

  /**
   * Сохраняет сгенерированный документ в S3 (v0.10 S5).
   *
   * Буфер уже в памяти, поэтому `Upload` получает его как `Body` и для
   * маленького DOCX отправляет один `PutObject`, а для файла больше 5 МБ —
   * multipart. `ContentLength` известен точно (`buffer.byteLength`), так что
   * SDK не угадывает размер и может повторить запрос теми же байтами
   * (RULES 4.34).
   *
   * S3 — необязательный слой (как и у `uploadAsync`): при отсутствии
   * настроек или ошибке загрузки возвращаются `null`-поля, а не исключение.
   * Исполнитель S6 сам решит, считать ли документ несохранённым.
   *
   * @param buffer - содержимое файла
   * @param extension - расширение без точки (`docx`, `pdf`)
   * @param runId - uuid запуска
   * @param nodeId - id узла графа
   * @returns ключ и ссылка (presigned для приватного бакета, прямая для
   *   публичного) либо `{ url: null, key: null }`
   */
  async saveGeneratedAsync(
    buffer: Buffer,
    extension: string,
    runId: string,
    nodeId: string,
  ): Promise<MediaGeneratedFile> {
    const config = this.resolveConfig();

    if (config === null) {
      this.logger.warn(
        'MEDIA_STORAGE_BACKEND=s3, но S3 не настроен — сгенерированный ' +
          'документ не сохранён',
      );

      return { url: null, key: null };
    }

    const storageKey = buildGeneratedStorageKey(runId, nodeId, extension);
    const normalizedExtension = normalizeGeneratedExtension(extension);
    const contentType =
      CONTENT_TYPE_BY_EXTENSION[normalizedExtension] ?? 'application/octet-stream';

    try {
      const upload = new Upload({
        client: this.getClient(config) as unknown as S3Client,
        params: {
          Bucket: config.bucket,
          Key: storageKey,
          Body: buffer,
          ContentType: contentType,
          ContentLength: buffer.byteLength,
        },
        leavePartsOnError: false,
      });

      await upload.done();

      const { url } = await this.resolveStoredUrlAsync(config, storageKey);

      this.logger.log(
        `Сгенерированный документ сохранён в S3: ${storageKey} ` +
          `(${buffer.byteLength} байт, ${contentType})`,
      );

      return { url, key: storageKey };
    } catch (error: unknown) {
      this.logger.warn(
        `S3-загрузка сгенерированного документа не удалась ` +
          `(${toErrorMessage(error)}): ${storageKey}`,
      );

      return { url: null, key: null };
    }
  }

  /**
   * Строит presigned GET-ссылку на объект бакета (KI-425).
   *
   * Ссылка живёт {@link S3_SIGNED_URL_TTL_SECONDS} секунд. Метод нужен и
   * `uploadAsync` (для приватного бакета), и {@link refreshStoredUrlAsync},
   * который переподписывает `stored_url` при чтении: сам `storedUrl`
   * автоматически не продлевается (KI-443).
   *
   * @param key - ключ объекта `<runId>/<fileName>`
   * @returns подписанный URL на `GetObject`
   * @throws Error если S3 не настроен (подписывать нечем)
   */
  async getSignedUrlAsync(key: string): Promise<string> {
    const config = this.resolveConfig();

    if (config === null) {
      throw new Error('S3 не настроен: presigned URL построить нельзя');
    }

    return this.signGetUrlAsync(config, key);
  }

  /**
   * Переподписывает просроченный `stored_url` приватного бакета (KI-443).
   *
   * В БД хранится только сама ссылка (отдельной колонки с ключом объекта
   * нет), поэтому ключ восстанавливается из URL: path-style
   * `<endpoint>/<bucket>/<runId>/<fileName>`. Для публичного бакета ссылка
   * прямая и не истекает как presigned — обновлять нечего; TTL там относится
   * к удалению объекта, поэтому возвращается `null`.
   *
   * Метод не бросает: снимок запуска не должен ломаться из-за недоступного
   * S3 — вызывающий код оставит старую ссылку и плейсхолдер «ссылка истекла»
   * (RULES 4.18).
   *
   * @param storedUrl - ссылка из `node_runs.stored_url`
   * @returns свежая ссылка с новым сроком либо `null`, если переподписать
   *   нельзя (публичный бакет, не S3-URL, S3 не настроен, ошибка подписи)
   */
  async refreshStoredUrlAsync(
    storedUrl: string,
  ): Promise<MediaRefreshedUrl | null> {
    const config = this.resolveConfig();

    if (config === null || this.options.publicBucket === true) {
      return null;
    }

    const key = storageKeyFromUrl(config, storedUrl);

    if (key === null) {
      this.logger.warn(
        `Не удалось извлечь ключ объекта из stored_url (bucket=${config.bucket}) — ` +
          'ссылка не переподписана',
      );

      return null;
    }

    try {
      const refreshedUrl = await this.signGetUrlAsync(config, key);

      this.logger.debug(`stored_url переподписан: ${key}`);

      return {
        storedUrl: refreshedUrl,
        storedExpiresAt: new Date(
          Date.now() + S3_SIGNED_URL_TTL_SECONDS * 1000,
        ),
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Не удалось переподписать stored_url для ${key} ` +
          `(${toErrorMessage(error)})`,
      );

      return null;
    }
  }

  /**
   * S3-бэкенд не отдаёт файлы через этот сервис.
   *
   * `storedUrl` для S3 ведёт прямо в бакет: для публичного — прямым URL, для
   * приватного — presigned GET (KI-425). Поэтому HTTP-ручка
   * `GET /media/file/...` для S3 не используется.
   *
   * @param _storageKey - ключ (не используется)
   * @returns всегда `null`
   */
  async openAsync(_storageKey: string): Promise<MediaReadResult | null> {
    return null;
  }

  /**
   * Собирает проверенную конфигурацию из параметров.
   *
   * @returns параметры без пустых значений либо `null`, если чего-то не хватает
   */
  private resolveConfig(): ResolvedS3Config | null {
    const endpoint = this.options.endpoint?.trim();
    const bucket = this.options.bucket?.trim();
    const accessKeyId = this.options.accessKeyId?.trim();
    const secretAccessKey = this.options.secretAccessKey?.trim();

    if (
      endpoint === undefined ||
      endpoint.length === 0 ||
      bucket === undefined ||
      bucket.length === 0 ||
      accessKeyId === undefined ||
      accessKeyId.length === 0 ||
      secretAccessKey === undefined ||
      secretAccessKey.length === 0
    ) {
      return null;
    }

    return {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: this.options.region?.trim() || 'us-east-1',
    };
  }

  /**
   * Возвращает клиент S3, создавая его при первом обращении.
   *
   * @param config - проверенные параметры подключения
   * @returns клиент S3 (в тестах — подменный объект с `send`)
   */
  private getClient(config: ResolvedS3Config): S3ClientLike {
    this.client ??= this.options.client ?? this.createClient(config);

    return this.client;
  }

  /**
   * Возвращает настоящий SDK-клиент для подписи URL.
   *
   * @param config - проверенные параметры подключения
   * @returns клиент `S3Client`
   */
  private getSigningClient(config: ResolvedS3Config): S3Client {
    this.signingClient ??= this.createClient(config);

    return this.signingClient;
  }

  /**
   * Строит ссылку на объект по ключу: presigned или прямую.
   *
   * Общая точка для `uploadAsync` (media-результаты) и
   * `saveGeneratedAsync` (документы). Для публичного бакета прямой URL
   * рабочий; для приватного — только presigned. Если подпись не удалась,
   * объект уже лежит в бакете, поэтому возвращается прямой URL: это лучше,
   * чем потерять ссылку совсем (для приватного бакета он ответит 403).
   *
   * @param config - проверенные параметры подключения
   * @param storageKey - ключ объекта
   * @returns URL и признак `signed` (для расчёта срока жизни ссылки)
   */
  private async resolveStoredUrlAsync(
    config: ResolvedS3Config,
    storageKey: string,
  ): Promise<{ url: string; signed: boolean }> {
    if (this.options.publicBucket === true) {
      return { url: this.buildDirectUrl(config, storageKey), signed: false };
    }

    try {
      return {
        url: await this.signGetUrlAsync(config, storageKey),
        signed: true,
      };
    } catch (error: unknown) {
      // Объект уже в бакете: без ссылки результат генерации потерян.
      this.logger.warn(
        `Не удалось построить presigned URL для ${storageKey} ` +
          `(${toErrorMessage(error)}) — используется прямой URL`,
      );

      return { url: this.buildDirectUrl(config, storageKey), signed: false };
    }
  }

  /**
   * Подписывает `GetObject` тем же набором параметров, что и загрузку.
   *
   * @param config - проверенные параметры подключения
   * @param key - ключ объекта
   * @returns presigned URL
   */
  private signGetUrlAsync(config: ResolvedS3Config, key: string): Promise<string> {
    return getSignedUrl(
      this.getSigningClient(config),
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: S3_SIGNED_URL_TTL_SECONDS },
    );
  }

  /**
   * Создаёт SDK-клиент S3 по проверенным параметрам.
   *
   * `forcePathStyle` включён всегда: endpoint задаётся вручную (MinIO, R2,
   * Yandex Object Storage), а для них path-style — единственный рабочий режим;
   * AWS S3 такой формат также поддерживает.
   *
   * @param config - проверенные параметры подключения
   * @returns новый клиент `S3Client`
   */
  private createClient(config: ResolvedS3Config): S3Client {
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Строит прямой URL объекта: `<endpoint>/<bucket>/<key>`.
   *
   * Работает только для публичного бакета: приватный ответит 403, поэтому для
   * него `storedUrl` — presigned GET (см. {@link getSignedUrlAsync}).
   *
   * @param config - проверенные параметры подключения
   * @param storageKey - ключ объекта `<runId>/<fileName>`
   * @returns URL для `node_runs.stored_url`
   */
  private buildDirectUrl(config: ResolvedS3Config, storageKey: string): string {
    const base = config.endpoint.replace(/\/+$/, '');

    return `${base}/${config.bucket}/${storageKey}`;
  }
}

/**
 * Восстанавливает ключ объекта из сохранённой S3-ссылки (KI-443).
 *
 * `stored_url` — это либо presigned GET, либо прямой URL, но в обоих случаях
 * path-style: `<endpoint>/<bucket>/<runId>/<fileName>`. Bucket известен из
 * конфигурации, поэтому ключ — всё, что идёт после `/<bucket>/`. Query
 * (`X-Amz-Signature`, `X-Amz-Expires`) отбрасывается.
 *
 * @param config - проверенные параметры подключения
 * @param storedUrl - ссылка из `node_runs.stored_url`
 * @returns ключ объекта `<runId>/<fileName>` либо `null`, если URL не от этого
 *   бакета/невалиден
 */
function storageKeyFromUrl(
  config: ResolvedS3Config,
  storedUrl: string,
): string | null {
  let pathname: string;

  try {
    pathname = new URL(storedUrl).pathname;
  } catch {
    return null;
  }

  const marker = `/${config.bucket}/`;
  const markerIndex = pathname.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const rawKey = pathname.slice(markerIndex + marker.length);

  if (rawKey.length === 0) {
    return null;
  }

  try {
    return decodeURIComponent(rawKey);
  } catch {
    // Битый percent-encoding: ключ не восстановить.
    return null;
  }
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
   * Ничего не сохраняет: хранилище выключено.
   *
   * @param _buffer - содержимое файла (не используется)
   * @param _extension - расширение (не используется)
   * @param _runId - uuid запуска (не используется)
   * @param _nodeId - id узла (не используется)
   * @returns `{ url: null, key: null }`
   */
  async saveGeneratedAsync(
    _buffer: Buffer,
    _extension: string,
    _runId: string,
    _nodeId: string,
  ): Promise<MediaGeneratedFile> {
    return { url: null, key: null };
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

  /**
   * Ссылок нет — обновлять нечего.
   *
   * @param _storedUrl - сохранённая ссылка (не используется)
   * @returns всегда `null`
   */
  async refreshStoredUrlAsync(
    _storedUrl: string,
  ): Promise<MediaRefreshedUrl | null> {
    return null;
  }
}

/** Логгер выбора бэкенда: живёт вне классов, потому что решает фабрика. */
const storageFactoryLogger = new Logger('MediaStorageFactory');

/**
 * Собирает хранилище по env (R7.8, KI-412).
 *
 * `MEDIA_STORAGE_BACKEND=s3` — это **предпочтение**, а не жёсткое требование:
 * без `S3_ENDPOINT`/`S3_BUCKET`/ключей бакет физически недоступен, поэтому
 * фабрика откатывается на {@link LocalMediaStorage} с предупреждением в лог.
 * Иначе приложение стартовало бы и молча теряло результаты генерации.
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
    const s3 = new S3MediaStorage({
      endpoint: config?.get<string>('S3_ENDPOINT'),
      bucket: config?.get<string>('S3_BUCKET'),
      accessKeyId: config?.get<string>('S3_ACCESS_KEY_ID'),
      secretAccessKey: config?.get<string>('S3_SECRET_ACCESS_KEY'),
      region: config?.get<string>('S3_REGION'),
      ttlDays: config?.get<number>('S3_TTL_DAYS'),
      // KI-444: флаг публичного бакета приходит из env, как остальные `S3_*`.
      publicBucket: config?.get<boolean>('S3_PUBLIC_BUCKET') === true,
    });

    if (s3.isConfigured) {
      return s3;
    }

    storageFactoryLogger.warn(
      'MEDIA_STORAGE_BACKEND=s3, но S3 не настроен ' +
        '(нужны S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) — ' +
        'используется local',
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
