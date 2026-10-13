import { z } from 'zod';
import { WorkerEnvSchema, type WorkerEnv } from '../config/env.schema.js';

/**
 * Настройки воркера очереди workflow-runs, прочитанные из окружения (KI-065,
 * KI-032).
 *
 * Почему чтение `process.env` в момент загрузки модуля, а не через
 * `ConfigService`: декоратор `@Processor` статичен — он вычисляется при
 * объявлении класса, вне DI, и не может инжектить сервис. К этому моменту
 * окружение уже загружено: `main.ts` начинается с `import 'dotenv/config'`, а
 * модули приложения импортируются после него.
 *
 * Значения проверяются Zod-схемой {@link WorkerEnvSchema} — той же, что
 * использует `ConfigModule` при старте (RULES 4.5). Так некорректное значение
 * (например, `WORKFLOW_RUNS_CONCURRENCY=abc`) ломает старт с понятным текстом, а
 * не превращается в `NaN` внутри опций BullMQ.
 */
const parsed = WorkerEnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(
    'Некорректные настройки воркера очереди workflow-runs ' +
      `(.env):\n${z.prettifyError(parsed.error)}`,
  );
}

const workerEnv: WorkerEnv = parsed.data;

/**
 * Опции воркера BullMQ для очереди workflow-runs.
 *
 * `concurrency` снимает head-of-line blocking: один медленный запуск больше не
 * блокирует очередь целиком. `lockDuration`/`maxStalledCount` согласованы с
 * длительностью LLM-вызовов, чтобы job не «украли» у работающего воркера.
 */
export const WORKFLOW_RUNS_WORKER_OPTIONS = {
  concurrency: workerEnv.WORKFLOW_RUNS_CONCURRENCY,
  lockDuration: workerEnv.WORKFLOW_RUNS_LOCK_DURATION_MS,
  maxStalledCount: workerEnv.WORKFLOW_RUNS_MAX_STALLED_COUNT,
};

/**
 * Порог «зависшего» запуска (мс).
 *
 * Если запуск висит в статусе `running` дольше этого порога, считается, что
 * выполнявший его worker умер, и повторное задание BullMQ разрешает выполнить
 * граф заново (KI-023). Пока порог не истёк, запуск считается живым
 * (аренда/lease), и дублирующее задание пропускается. Значение приходит из
 * `WORKFLOW_RUNS_STALE_THRESHOLD_MS` (KI-032), по умолчанию совпадает с
 * `lockDuration`.
 */
export const RUN_STALE_THRESHOLD_MS = workerEnv.WORKFLOW_RUNS_STALE_THRESHOLD_MS;
