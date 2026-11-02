import { z } from 'zod';
import type { RunStatus } from '../../db/schema.js';

/**
 * Элемент истории запусков workflow (`GET /workflow/:id/runs`, v0.14 S1).
 *
 * Это **лёгкая** проекция строки `workflow_runs`: только то, что нужно списку
 * истории (статус, даты, длительность, стоимость). `inputs`, `outputs`,
 * `snapshot` и `error` наружу не отдаются — за деталями UI идёт в
 * `GET /runs/:id` и `GET /runs/:id/nodes`.
 *
 * **Длительность и стоимость вычисляются, а не хранятся.** В `workflow_runs`
 * нет колонок `duration_ms`/`cost_usd`/`cost_rub`: длительность считается как
 * `finished_at − started_at`, а стоимости агрегируются из `node_runs`
 * (`sum(cost_usd)`, `sum(cost_rub)`) — см. `RunsService.listRunsAsync`.
 *
 * `createdAt` — `workflow_runs.created_at` (KI-015): дата постановки запуска в
 * очередь, она отличается от `startedAt` — фактического старта выполнения
 * (движок выставляет его при переходе в `running`).
 */
export interface RunSummary {
  /** uuid запуска. */
  id: string;
  /** Статус запуска (`pending`/`running`/`completed`/`failed`/`cancelled`). */
  status: RunStatus;
  /** Когда запуск создан (постановка в очередь). */
  createdAt: Date;
  /**
   * Когда движок начал выполнение.
   *
   * `null` — у строки нет фактического старта. Важно: колонка
   * `workflow_runs.started_at` объявлена с `DEFAULT now()`, поэтому у
   * `pending`-запуска, созданного через `POST /runs`, здесь лежит время
   * постановки в очередь, а не `null` (KI-539). `null` встречается у строк,
   * созданных до появления дефолта либо вставленных без `started_at`.
   */
  startedAt: Date | null;
  /** Когда запуск завершился; `null` — запуск ещё идёт (или не стартовал). */
  finishedAt: Date | null;
  /**
   * Фактическая длительность выполнения в миллисекундах
   * (`finishedAt − startedAt`); `null`, пока запуск не завершён. Отрицательная
   * разница невозможна и приводится к `0` (защита от рассинхрона часов).
   */
  durationMs: number | null;
  /** Суммарная стоимость запуска в USD по `node_runs.cost_usd`. */
  costUsd: number;
  /** Суммарная стоимость запуска в рублях по `node_runs.cost_rub`. */
  costRub: number;
}

/**
 * Ответ `GET /workflow/:id/runs` (v0.14 S1, DESIGN V014 § 3.1).
 *
 * `total` — общее число запусков workflow **без учёта** пагинации, чтобы UI
 * мог считать число страниц, не запрашивая всё подряд.
 */
export interface RunHistoryResponse {
  /** Запуски текущей страницы (сначала новые — по `createdAt DESC`). */
  runs: RunSummary[];
  /** Всего запусков у workflow (до применения `limit`/`offset`). */
  total: number;
}

/** Размер страницы истории запусков по умолчанию. */
export const DEFAULT_RUN_HISTORY_LIMIT = 20;

/**
 * Максимальный размер страницы истории запусков.
 *
 * Верхняя граница нужна, чтобы клиент не мог одним запросом вытянуть всю
 * историю workflow и загрузить БД/сеть.
 */
export const MAX_RUN_HISTORY_LIMIT = 100;

/**
 * Zod-схема query-параметров `GET /workflow/:id/runs`.
 *
 * `limit`/`offset` приходят строками, поэтому приводятся через `z.coerce`
 * (тот же приём, что в `ListWorkflowsQuerySchema`). Пределы `limit`
 * ограничены {@link MAX_RUN_HISTORY_LIMIT}.
 */
export const RunHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int('limit должен быть целым числом')
    .min(1, 'limit должен быть не меньше 1')
    .max(MAX_RUN_HISTORY_LIMIT, `limit не больше ${MAX_RUN_HISTORY_LIMIT}`)
    .default(DEFAULT_RUN_HISTORY_LIMIT),
  offset: z.coerce
    .number()
    .int('offset должен быть целым числом')
    .min(0, 'offset не может быть отрицательным')
    .default(0),
});

/** Валидированные query-параметры истории запусков. */
export type RunHistoryQueryDto = z.infer<typeof RunHistoryQuerySchema>;
