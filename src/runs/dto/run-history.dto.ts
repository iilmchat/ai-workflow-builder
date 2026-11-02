import { z } from 'zod';
import type { RunStatus } from '../../db/schema.js';

/**
 * Элемент истории запусков workflow (`GET /workflow/:id/runs`, v0.14 S1;
 * keyset-пагинация — v0.16 S1, KI-542).
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
  /**
   * Непрозрачный курсор keyset-пагинации этого элемента (KI-542).
   *
   * Содержит `createdAt` + `id`; клиент передаёт курсор последнего полученного
   * элемента в `GET /workflow/:id/runs?cursor=…`, чтобы получить следующую
   * страницу. Курсор непрозрачен: формат — деталь реализации (см.
   * {@link encodeRunHistoryCursor}), менять его можно без правок UI.
   */
  cursor: string;
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
 * С v0.16 S1 (KI-542) история листается **keyset-курсором**, а не `offset`:
 * `nextCursor` — курсор следующей страницы (`null` — страниц больше нет).
 * Он вычисляется сервером по факту «есть ли ещё строки» (выборка `limit + 1`),
 * а не из `total`: `total` может опережать список, если между запросами
 * появились новые запуски, и UI не должен зацикливаться на «Загрузить ещё».
 * `RunSummary.cursor` остаётся курсором конкретного элемента (диагностика и
 * явная передача с клиента), но для навигации используется `nextCursor`.
 */
export interface RunHistoryResponse {
  /** Запуски текущей страницы (сначала новые — по `createdAt DESC, id DESC`). */
  runs: RunSummary[];
  /**
   * Курсор следующей страницы либо `null`, если она пуста.
   *
   * Передаётся в следующий запрос как `?cursor=…`.
   */
  nextCursor: string | null;
  /** Всего запусков у workflow (не зависит от страницы; для счётчика UI). */
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
 * Позиция keyset-пагинации истории (KI-542).
 *
 * Упорядочивание — `createdAt DESC, id DESC`, поэтому позиция последнего
 * элемента однозначно задаёт начало следующей страницы даже при одинаковом
 * `created_at` (вторичный ключ `id`).
 */
export interface RunHistoryCursor {
  /**
   * `workflow_runs.created_at` последнего элемента страницы.
   *
   * **Строка ISO-8601 с микросекундами** (`YYYY-MM-DDTHH:MM:SS.ffffffZ`), а не
   * `Date`: `Date` хранит только миллисекунды, а `timestamptz` в PostgreSQL —
   * микросекунды. Если бы курсор терял µs, фильтр
   * `created_at = cursor.createdAt` не совпал бы с реальной строкой, и
   * вторичный ключ `id` не сработал бы — запуски, созданные в одну
   * миллисекунду, могли бы пропускаться (найдено verifier'ом). Строку с
   * точностью µs отдаёт SQL-выражение `to_char(... 'US')`.
   */
  createdAt: string;
  /** `workflow_runs.id` последнего элемента страницы (вторичный ключ). */
  id: string;
}

/**
 * Формат секундной метки курсора: ISO-8601 UTC с 1–6 дробными цифрами.
 *
 * 3 цифры — старые курсоры (ms) и совместимость; 6 — новые (µs).
 */
const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;

/** Zod-схема «сырого» курсора: `{ c: ISO-дата с µs, i: uuid }`. */
const RawRunHistoryCursorSchema = z.object({
  c: z
    .string()
    .regex(
      CURSOR_TIMESTAMP_PATTERN,
      'createdAt курсора должен быть ISO-8601 UTC с микросекундами',
    ),
  i: z.uuid(),
});

/**
 * Кодирует позицию keyset-пагинации в непрозрачную строку.
 *
 * Формат — base64url от JSON `{ c: ISO-дата с µs, i: uuid }`: он URL-безопасен,
 * компактен и не требует экранирования в query-параметре. Клиент не должен
 * разбирать курсор — только передавать его обратно.
 *
 * @param cursor - позиция последнего элемента страницы
 * @returns непрозрачный курсор для `?cursor=`
 */
export function encodeRunHistoryCursor(cursor: RunHistoryCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt, i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Декодирует курсор keyset-пагинации.
 *
 * @param value - значение `?cursor=` из запроса
 * @returns позиция последнего элемента предыдущей страницы (µs-точность)
 * @throws Error если строка не base64url/JSON или не соответствует схеме
 */
export function decodeRunHistoryCursor(value: string): RunHistoryCursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (error: unknown) {
    throw new Error('некорректный cursor истории запусков', { cause: error });
  }

  const result = RawRunHistoryCursorSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error('некорректный cursor истории запусков', {
      cause: result.error,
    });
  }

  // Дополнительно проверяем, что дата реальна (regex пропускает 2026-13-40).
  if (Number.isNaN(Date.parse(result.data.c))) {
    throw new Error('некорректный cursor истории запусков');
  }

  return {
    createdAt: result.data.c,
    id: result.data.i,
  };
}

/**
 * Zod-схема курсора в query-параметрах.
 *
 * Проверяет и форму (непустая строка разумной длины), и декодируемость:
 * мусорный `cursor` — 400 от `ZodValidationPipe`, а не 500 из сервиса. Сам
 * декодер бросает `Error`, поэтому `refine` возвращает `false`, а не роняет
 * валидацию исключением.
 */
export const RunHistoryCursorSchema = z
  .string()
  .trim()
  .min(1, 'cursor не может быть пустым')
  .max(512, 'cursor слишком длинный')
  .refine(
    (value) => {
      try {
        decodeRunHistoryCursor(value);

        return true;
      } catch {
        return false;
      }
    },
    { message: 'cursor должен быть курсором из предыдущего ответа истории' },
  );

/**
 * Zod-схема query-параметров `GET /workflow/:id/runs` (v0.16 S1, KI-542).
 *
 * `limit` приходит строкой, поэтому приводится через `z.coerce` (тот же приём,
 * что в `ListWorkflowsQuerySchema`). `offset` удалён: offset-пагинация
 * сдвигалась при появлении новых запусков (KI-542); вместо неё — `cursor`.
 */
export const RunHistoryQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int('limit должен быть целым числом')
    .min(1, 'limit должен быть не меньше 1')
    .max(MAX_RUN_HISTORY_LIMIT, `limit не больше ${MAX_RUN_HISTORY_LIMIT}`)
    .default(DEFAULT_RUN_HISTORY_LIMIT),
  cursor: RunHistoryCursorSchema.optional(),
});

/** Валидированные query-параметры истории запусков. */
export type RunHistoryQueryDto = z.infer<typeof RunHistoryQuerySchema>;
