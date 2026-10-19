/**
 * Константы и границы DOCX-шаблонов (v0.11 S2/S3, DESIGN § 3.1.3–3.1.9).
 *
 * Вынесены из сервисов, потому что `DOCUMENT_TEMPLATE_MAX_BYTES` нужен
 * **декоратору** `@UseInterceptors(FileInterceptor(..., { limits }))`: декоратор
 * вычисляется при объявлении класса, вне DI, и не может инжектить
 * `ConfigService` (RULES 4.6). Остальные лимиты читает
 * `DocumentTemplateService` через `ConfigService`; здесь — только значение для
 * `multer`, которое обязано совпадать с env-схемой (иначе файл, разрешённый
 * схемой, отсекался бы промежуточным слоем).
 */

/** Дефолт `DOCUMENT_TEMPLATE_MAX_BYTES` (5 МБ) — как в `DocumentTemplateEnvSchema`. */
export const DOCUMENT_TEMPLATE_DEFAULT_MAX_BYTES = 5_242_880;

/** Нижняя граница `DOCUMENT_TEMPLATE_MAX_BYTES` из env-схемы (1 КБ). */
const MIN_MAX_BYTES = 1024;

/** Верхняя граница `DOCUMENT_TEMPLATE_MAX_BYTES` из env-схемы (20 МБ). */
const MAX_MAX_BYTES = 20_971_520;

/**
 * Максимум простых плейсхолдеров в одном шаблоне (DESIGN § 3.1.3).
 *
 * Не env-переменная: предел защищает рендер и UI от «шаблона-простыни»; 500
 * полей покрывают любой деловой документ. Проверяется при загрузке (400) и
 * рендере.
 */
export const DOCUMENT_TEMPLATE_MAX_PLACEHOLDERS = 500;

/**
 * Разбирает ограничение размера файла для `multer` из окружения.
 *
 * В отличие от env-схемы (`z.coerce`), значение читается **один раз при
 * импорте модуля** и не бросает исключение: приложение всё равно упадёт на
 * `validateEnv`, если переменная некорректна. Некорректное/отсутствующее
 * значение здесь просто даёт дефолт, чтобы импорт констант не падал в тестах
 * без `.env`.
 *
 * @param raw - сырое значение `process.env.DOCUMENT_TEMPLATE_MAX_BYTES`
 * @returns проверенный лимит в байтах
 */
function resolveMaxBytes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DOCUMENT_TEMPLATE_DEFAULT_MAX_BYTES;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < MIN_MAX_BYTES || parsed > MAX_MAX_BYTES) {
    return DOCUMENT_TEMPLATE_DEFAULT_MAX_BYTES;
  }

  return parsed;
}

/**
 * Лимит размера загружаемого `.docx` для `FileInterceptor` (DESIGN § 3.1.5).
 *
 * Совпадает с `DOCUMENT_TEMPLATE_MAX_BYTES` из env-схемы: `multer` обрывает
 * поток по этому значению и Nest превращает `MulterError` с
 * `code='LIMIT_FILE_SIZE'` в `PayloadTooLargeException` (413) — это внутренний
 * `transformException` из `@nestjs/platform-express` (см. JSDoc контроллера).
 */
export const DOCUMENT_TEMPLATE_MAX_BYTES = resolveMaxBytes(
  process.env.DOCUMENT_TEMPLATE_MAX_BYTES,
);
