import { hostname } from 'node:os';
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
 * `prefix` (KI-387) должен совпадать с префиксом очереди из `RunsModule`, иначе
 * воркер будет слушать другое пространство ключей Redis и не увидит заданий.
 */
export const WORKFLOW_RUNS_WORKER_OPTIONS = {
  concurrency: workerEnv.WORKFLOW_RUNS_CONCURRENCY,
  lockDuration: workerEnv.WORKFLOW_RUNS_LOCK_DURATION_MS,
  maxStalledCount: workerEnv.WORKFLOW_RUNS_MAX_STALLED_COUNT,
  prefix: workerEnv.BULLMQ_PREFIX,
};

/**
 * Префикс ключей очереди workflow-runs в Redis (KI-387).
 *
 * Используется `RunsModule` как дефолт, если `ConfigService` почему-то не отдал
 * значение (в приложении значение всегда приходит из `BULLMQ_PREFIX`).
 */
export const RUNS_QUEUE_PREFIX = workerEnv.BULLMQ_PREFIX;

/** Номер БД Redis для очередей (KI-387); дефолт соответствует env-схеме. */
export const RUNS_QUEUE_DB = workerEnv.REDIS_QUEUE_DB;

/**
 * Собирает идентификатор инстанса: явный `INSTANCE_ID` или `hostname:PORT`.
 *
 * Вынесено отдельной функцией, чтобы поведение можно было покрыть тестом без
 * перезагрузки модуля и подмены `os.hostname()`.
 *
 * @param explicit - значение `INSTANCE_ID` из окружения (пустое = не задано)
 * @param host - имя хоста (`os.hostname()`)
 * @param port - порт из `process.env.PORT`; пусто/`'0'` → 3000
 * @returns стабильный идентификатор вида `host:3000`
 */
export function resolveInstanceId(
  explicit: string | undefined,
  host: string,
  port: string | undefined,
): string {
  const trimmed = explicit?.trim();

  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }

  return `${host}:${port || 3000}`;
}

/**
 * Идентификатор текущего backend-инстанса (KI-387, KI-391).
 *
 * Один и тот же в пределах процесса: продюсер (`RunsService`) кладёт его в
 * payload задания, а воркер (`RunsProcessor`) сверяет со своим. Явный
 * `INSTANCE_ID` имеет приоритет. Если он не задан, идентификатор строится из
 * `os.hostname()` и `PORT` — он **стабилен между рестартами** процесса на том же
 * хосте/порту, поэтому задание, оставшееся в очереди от прежнего процесса,
 * новый воркер примет, а не пропустит (KI-391).
 *
 * Параллельные инстансы различаются хостом и/или портом. Если инстансы
 * запускаются в среде с эфемерным hostname (пересоздание Docker-контейнера,
 * поды Kubernetes), задавайте `INSTANCE_ID` явно — иначе после пересоздания
 * идентификатор изменится.
 */
export const RUNS_INSTANCE_ID = resolveInstanceId(
  workerEnv.INSTANCE_ID,
  hostname(),
  process.env.PORT,
);

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
