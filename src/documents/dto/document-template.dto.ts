import { z } from 'zod';

/**
 * Публичное представление DOCX-шаблона (v0.11 S3, DESIGN § 3.1.5).
 *
 * Содержимое (`content`, до 5 МБ) в ответ не попадает: список должен быть
 * дешёвым, а файл отдаётся отдельной ручкой `GET …/:templateId/file`.
 * Интерфейс — источник полей для REST-контракта
 * (`docs/development/api-contract.json`): backend-spec читает его компилятором
 * TypeScript, web-spec сверяет с Zod-зеркалом `ApiDocumentTemplateSchema`
 * (`web/src/lib/api.ts`).
 */
export interface DocumentTemplateSummary {
  /** uuid шаблона. */
  id: string;
  /** Человекочитаемое имя (по умолчанию — имя загруженного файла). */
  name: string;
  /** Размер `.docx` в байтах (совпадает с `octet_length(content)`). */
  bytes: number;
  /** Простые плейсхолдеры, извлечённые при загрузке. */
  placeholders: string[];
  /** Дата загрузки в ISO-формате (после сериализации `Date`). */
  createdAt: string;
}

/**
 * Структурный контракт загруженного файла (DESIGN § 3.1.5).
 *
 * Совпадает с подмножеством `Express.Multer.File`, но не требует глобальных
 * типов `@types/multer` в сервисе: сервис можно тестировать без multer, а
 * контроллер передаёт `Express.Multer.File` (структурно совместим). Память:
 * `buffer` доступен, потому что у `FileInterceptor` по умолчанию memory
 * storage — временных файлов нет.
 */
export interface UploadedFileLike {
  /** Имя файла на машине клиента (по нему проверяется расширение). */
  readonly originalname: string;
  /** MIME-тип из multipart-части. */
  readonly mimetype: string;
  /** Размер, который посчитал multer. */
  readonly size: number;
  /** Содержимое файла в памяти. */
  readonly buffer: Buffer;
}

/**
 * Тело `POST /workflow/:id/document-templates` (v0.11 S3).
 *
 * Multipart-поля приходят строками, поэтому единственное необязательное поле —
 * `name` (до 120 символов, DESIGN § 3.1.5 п. 8). Если его нет, имя берётся из
 * `originalname`. Zod отбрасывает неизвестные ключи — лишние поля формы не
 * ломают загрузку.
 */
export const UploadDocumentTemplateSchema = z.object({
  /** Имя шаблона; необязательно. */
  name: z.string().trim().min(1).max(120).optional(),
});

/** Валидированное тело загрузки шаблона. */
export type UploadDocumentTemplateDto = z.infer<typeof UploadDocumentTemplateSchema>;
