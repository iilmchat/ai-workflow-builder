/**
 * Ошибки генерации документов (v0.10 S6).
 *
 * Живут отдельно от {@link DocumentService}, чтобы исполнитель узла
 * (`node-executors.ts`) мог бросать их, не импортируя `docx`: сервис тянет
 * тяжёлую библиотеку, а юнит-тестам исполнителя она не нужна. Тот же приём,
 * что у `VectorDisabledException`/`RetryableNodeException` в `engine/errors.ts`.
 *
 * Наследуются от `Error`, а не от Nest `HttpException`: генерация идёт в
 * worker'е (RULES 4.21), и ошибка должна переводить узел в `failed`, а не
 * превращаться в HTTP-ответ.
 */

/**
 * Документ превысил предельный размер файла (DESIGN v0.10 § 3.2.3).
 *
 * Лимит (`10 МБ`) проверяется по фактическому буферу после рендера: DOCX —
 * ZIP, и предсказать его размер по числу символов нельзя (сжатие, шрифты,
 * нумерация). Ошибка приходит **до** сохранения, поэтому битый/огромный файл
 * не попадает ни в local-хранилище, ни в S3.
 */
export class DocumentTooLargeException extends Error {
  /**
   * @param bytes - фактический размер буфера в байтах
   * @param maxBytes - разрешённый размер в байтах
   */
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `Документ больше лимита: ${bytes} байт > ${maxBytes} байт ` +
        '(DESIGN v0.10 § 3.2.3)',
    );
    this.name = 'DocumentTooLargeException';
  }
}

/**
 * Сгенерированный документ некуда сохранить (DESIGN v0.10 § 3.2.4).
 *
 * Два случая:
 * - `MEDIA_STORAGE_BACKEND=none` — сохранение выключено администратором;
 * - бэкенд (`s3`) не смог сохранить файл и вернул `null` вместо ключа/ссылки.
 *
 * Узел не может отдать документ без ссылки, поэтому это падение, а не
 * «успех с пустыми полями»: UI не должен показывать кнопку скачивания,
 * ведущую в никуда.
 */
export class DocumentStorageUnavailableException extends Error {
  /**
   * @param reason - короткая причина (без пользовательских данных, RULES 5.9)
   */
  constructor(reason?: string) {
    super(
      reason === undefined
        ? 'Документ не сохранён: хранилище недоступно'
        : `Документ не сохранён: хранилище недоступно (${reason})`,
    );
    this.name = 'DocumentStorageUnavailableException';
  }
}
