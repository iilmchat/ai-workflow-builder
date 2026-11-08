/**
 * Ошибки уровня исполнителя узла, не привязанные к конкретному узлу.
 *
 * Файл отдельный, а не `node-executors.ts`, по той же причине, что и
 * `node-ports.ts`: `ExecutionEngineService` импортирует только типы ошибок и
 * не тянет реализации всех исполнителей. Это важно для тестов движка и для
 * новых узлов v0.10 (`web_search`, `document_gen`), которые появятся позже
 * самих исполнителей.
 */

/**
 * Ошибка узла, которую имеет смысл повторить (v0.10 S0).
 *
 * Маркер `retryable: true` — единственный контракт с движком: в отличие от
 * `LlmProviderException`, он не привязан к провайдеру LLM. Так `web_search`
 * (429/5xx/таймаут поисковика) и `document_gen` (временный сбой рендера)
 * смогут воспользоваться общим механизмом повторов узла (KI-036), не
 * расширяя `ExecutionEngineService` под каждый новый тип.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение живёт в
 * worker'е, а не в HTTP-запросе, и должно приводить к `run.status='failed'`
 * после исчерпания попыток.
 */
export class RetryableNodeException extends Error {
  /** Признак «временная ошибка»: движок повторит узел (до NODE_MAX_ATTEMPTS). */
  readonly retryable = true;

  /** Тип узла, который упал (для логов и текста ошибки). */
  readonly nodeType: string;

  /**
   * @param nodeType - тип узла (`web_search`, `document_gen`, …)
   * @param message - готовый текст ошибки; по умолчанию — «временная ошибка»
   * @param options - стандартные опции `Error` (в первую очередь `cause`)
   */
  constructor(nodeType: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Временная ошибка узла ${nodeType}: повтор разрешён`, options);
    this.name = 'RetryableNodeException';
    this.nodeType = nodeType;
  }
}

/**
 * Проверяет, что ошибка помечена как повторяемая.
 *
 * @param error - значение из `catch`
 * @returns `true`, если движок должен повторить узел
 */
export function isRetryableNodeError(error: unknown): error is RetryableNodeException {
  return error instanceof RetryableNodeException;
}

/**
 * Ошибка: запуск отменён пользователем (v1.4.0 S1, DESIGN V140 § 3.1).
 *
 * Бросается движком, когда перед очередным уровнем или узлом обнаружен
 * `workflow_runs.cancelled_at IS NOT NULL`. Наследуется от `Error`, а не от
 * Nest `HttpException`: исключение рождается в BullMQ-worker'е, а не в
 * HTTP-запросе.
 *
 * **Non-retryable.** У класса нет маркера `retryable: true` и нет
 * `provider`, поэтому {@link isRetryableNodeError},
 * `isRetryableProviderError` и цикл повторов узла его не повторяют. Это
 * важно: отмена — решение пользователя, а не временный сбой провайдера;
 * повторный запуск графа после отмены недопустим.
 *
 * `RunsProcessor` ловит это исключение отдельной веткой, помечает запуск
 * `cancelled` и публикует `run_completed` со статусом `cancelled`; job при
 * этом считается успешно обработанным и BullMQ не делает retry.
 */
export class RunCancelledException extends Error {
  /** uuid отменённого запуска (для логов и текста ошибки). */
  readonly runId: string;

  /**
   * Явный маркер «повторять нельзя». `false` (а не отсутствие поля) —
   * контракт для структурных guard'ов и читаемости в отладке.
   */
  readonly retryable = false;

  /**
   * @param runId - uuid запуска, который был отменён
   */
  constructor(runId: string) {
    super(`Запуск ${runId} отменён пользователем`);
    this.name = 'RunCancelledException';
    this.runId = runId;
  }
}

/**
 * Проверяет, что ошибка означает отмену запуска.
 *
 * @param error - значение из `catch`
 * @returns `true`, если запуск остановлен по флагу `cancelled_at`
 */
export function isRunCancelledError(error: unknown): error is RunCancelledException {
  return error instanceof RunCancelledException;
}

/**
 * Ошибка: vector/memory-узлы выключены конфигурацией (`PGVECTOR_ENABLED=false`).
 *
 * Отдельный класс, а не `NodeDataValidationException`: это не битые данные
 * автора графа, а состояние окружения. Текст понятен пользователю и не
 * содержит внутренних деталей подключения к БД.
 */
export class VectorDisabledException extends Error {
  /**
   * @param nodeType - тип vector/memory-узла, который попытался выполниться
   */
  constructor(nodeType: string) {
    super(
      `Узел ${nodeType} отключён: vector-функции выключены администратором ` +
        '(PGVECTOR_ENABLED=false)',
    );
    this.name = 'VectorDisabledException';
  }
}

/**
 * Ошибка: тип узла не поддерживается executor'ом.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение живёт в
 * контексте worker'а, а не HTTP-запроса, и должно приводить к
 * `run.status='failed'`.
 *
 * **Почему объявлена здесь, а не в `node-executors.ts`** (v0.11 S2). Класс
 * нужен не только исполнителям, но и документам: `resolveTemplateVariables`
 * (`src/documents/document-template.service.ts`) бросает
 * {@link NodeDataValidationException} при невалидном входе шаблона
 * (DESIGN v0.11 § 3.1.4). Импорт из `node-executors.ts` создал бы цикл
 * `engine → documents → engine` в S4; импорт из нейтрального `errors.ts` —
 * нет. Прежнее место объявления сохранено реэкспортом, поэтому существующие
 * импорты (`src/media/*`, `src/vector/*`, тесты) не меняются.
 */
export class UnsupportedNodeTypeException extends Error {
  /**
   * @param nodeType - неизвестный тип узла из графа
   * @param message - готовый текст ошибки; по умолчанию — «тип не поддерживается»
   */
  constructor(nodeType: string, message?: string) {
    super(message ?? `Неподдерживаемый тип узла: ${nodeType}`);
    this.name = 'UnsupportedNodeTypeException';
  }
}

/**
 * Ошибка: данные узла не прошли валидацию Zod-схемой (R6.5.1).
 *
 * Наследуется от {@link UnsupportedNodeTypeException}, потому что для движка это
 * один класс отказа: узел с таким `data` выполнить нельзя. Подкласс даёт точный
 * текст ошибки и позволяет тестам отличать «неизвестный тип» от «известный тип
 * с битыми данными»; `catch` на родителя ловит оба случая.
 *
 * v0.11 S2: класс переехал из `node-executors.ts`, чтобы документы могли
 * бросать его без циклического импорта (см. JSDoc
 * {@link UnsupportedNodeTypeException}).
 */
export class NodeDataValidationException extends UnsupportedNodeTypeException {
  /**
   * @param nodeType - тип узла, чьи `data` не прошли валидацию
   * @param reason - причина отказа (текст ошибки Zod)
   */
  constructor(nodeType: string, reason: string) {
    super(nodeType, `Некорректные данные узла ${nodeType}: ${reason}`);
    this.name = 'NodeDataValidationException';
  }
}
