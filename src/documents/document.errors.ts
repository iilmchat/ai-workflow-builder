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

/**
 * Код отказа DOCX-шаблона (v0.11 S2, DESIGN § 3.1.3).
 *
 * - `invalid-zip` — буфер не является ZIP-архивом (сигнатура/структура);
 * - `invalid-docx` — архив не OOXML или небезопасен (нет обязательных частей,
 *   макросы, превышены лимиты распаковки, DTD/ENTITY);
 * - `syntax` — docxtemplater не скомпилировал теги (незакрытый `{name`,
 *   неверная вложенность циклов);
 * - `render` — ошибка подстановки данных (в том числе превышение лимита
 *   переменных).
 *
 * Код нужен вызывающему коду, чтобы отличить «пользователь загрузил мусор»
 * (400, non-retryable) от внутренней ошибки рендера.
 */
export type DocumentTemplateInvalidCode =
  | 'invalid-zip'
  | 'invalid-docx'
  | 'syntax'
  | 'render';

/**
 * Шаблон документа не прошёл проверку/рендер (v0.11 S2, DESIGN § 3.1.3).
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение бросает
 * чистый рендерер (`DocumentTemplateService`), который не знает об HTTP.
 * Контроллер (`DocumentTemplatesController`) и исполнитель узла (S4)
 * переводят его в 400/`failed` соответственно.
 *
 * `details` — тексты из `error.properties.errors` docxtemplater **без
 * содержимого документа** (RULES 5.9): только имя файла-части и объяснение
 * («The tag beginning with "{name" is unclosed»). Этого достаточно, чтобы
 * пользователь понял, что править в шаблоне.
 */
export class DocumentTemplateInvalidException extends Error {
  /**
   * @param code - машинный код отказа (см. {@link DocumentTemplateInvalidCode})
   * @param message - короткое описание для пользователя/лога
   * @param details - подробности по каждому тегу (без содержимого документа)
   */
  constructor(
    readonly code: DocumentTemplateInvalidCode,
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(
      details.length === 0 ? message : `${message}: ${details.join('; ')}`,
    );
    this.name = 'DocumentTemplateInvalidException';
  }
}

/**
 * Шаблон не найден в указанном workflow (v0.11 S2, DESIGN § 3.1.6).
 *
 * Используется загрузчиком для исполнителя узла (`loadAsync`): проверка
 * `WHERE id = $templateId AND workflow_id = $runWorkflowId` отсекает чужой
 * workflow, поэтому удалённый или «переехавший» шаблон — non-retryable отказ
 * узла, а не 404 HTTP (HTTP отдаёт контроллер через `NotFoundException`).
 */
export class DocumentTemplateNotFoundException extends Error {
  /**
   * @param templateId - uuid запрошенного шаблона
   */
  constructor(readonly templateId: string) {
    super(`Шаблон документа ${templateId} не найден в workflow`);
    this.name = 'DocumentTemplateNotFoundException';
  }
}
