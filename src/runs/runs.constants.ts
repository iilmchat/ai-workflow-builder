/**
 * Имя очереди BullMQ, в которую ставятся задания на выполнение workflow.
 *
 * Вынесено в отдельный модуль, чтобы имя не дублировалось между сервисом
 * (постановка задания), процессором (обработка) и модулем (registerQueue).
 */
export const WORKFLOW_RUNS_QUEUE = 'workflow-runs';

/** Имя задания (job name) внутри очереди {@link WORKFLOW_RUNS_QUEUE}. */
export const EXECUTE_RUN_JOB = 'execute';
