/**
 * Имя очереди BullMQ, в которую ставятся задания на выполнение workflow.
 *
 * Вынесено в отдельный модуль, чтобы имя не дублировалось между сервисом
 * (постановка задания), процессором (обработка) и модулем (registerQueue).
 */
export const WORKFLOW_RUNS_QUEUE = 'workflow-runs';

/** Имя задания (job name) внутри очереди {@link WORKFLOW_RUNS_QUEUE}. */
export const EXECUTE_RUN_JOB = 'execute';

/**
 * Порог «зависшего» запуска (мс).
 *
 * Если запуск висит в статусе `running` дольше этого порога, считается, что
 * выполнявший его worker умер, и повторное задание BullMQ разрешает выполнить
 * граф заново (KI-023). Пока порог не истёк, запуск считается живым
 * (аренда/lease), и дублирующее задание пропускается.
 */
export const RUN_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** Префикс канала Redis pub/sub, в который публикуются события запуска. */
export const RUN_EVENTS_CHANNEL_PREFIX = 'run:';

/**
 * Возвращает имя канала pub/sub для событий конкретного запуска.
 *
 * @param runId - uuid запуска
 * @returns имя канала вида `run:<runId>`
 */
export function runEventsChannel(runId: string): string {
  return `${RUN_EVENTS_CHANNEL_PREFIX}${runId}`;
}
