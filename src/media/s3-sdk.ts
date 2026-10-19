import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Значения S3 SDK, загружаемые лениво (KI-412).
 *
 * Модуль импортируется только динамически из {@link loadS3SdkAsync}: если
 * `@aws-sdk/client-s3` выпал из `node_modules` (например, `pnpm prune --prod`
 * без optional-зависимости или урезанный образ), ошибка возникает при
 * **загрузке этого модуля**, а не при старте приложения. `media-storage.service`
 * перехватывает её и откатывается на локальное хранилище.
 *
 * Статически импортировать SDK в сервисе нельзя: ESM выполняет импорт до
 * первого оператора, поэтому отсутствующий пакет уронил бы весь Nest-процесс —
 * ровно то, что запрещено требованием KI-412.
 *
 * Типы (`typeof …`) берутся из настоящих конструкторов: подменный клиент в
 * тестах должен иметь тот же контракт, что и SDK.
 */
export const s3Sdk = {
  /** Конструктор клиента S3 (нужен для загрузки и подписи URL). */
  S3Client,
  /** Команда multipart/одиночной загрузки — принимает подменный `send`. */
  PutObjectCommand,
  /** Команда чтения — её подписывает `getSignedUrl`. */
  GetObjectCommand,
  /** Потоковая/multipart-загрузка с ретраями (KI-427, KI-442). */
  Upload,
  /** Генератор presigned URL (KI-425). */
  getSignedUrl,
} as const;

/** Тип набора S3 SDK: используется сервисом без статического импорта пакета. */
export type S3Sdk = typeof s3Sdk;
