import { z } from 'zod';
import { requestAsync } from './api';
import { invalidateWorkflowListCache } from './workflow-list-cache';

/**
 * Zod-схема экспортированного workflow (R6.6.2, DESIGN v0.8 § 9).
 *
 * Повторяет backend-схему `ExportWorkflowSchema` из R6.6.1: артефакт
 * **sharable** — в нём нет ни `id`, ни `userId`, ни `shareToken`, только граф и
 * его имя. `version` — версия **формата экспорта** (литерал `1`), а не колонка
 * `workflows.version` из БД (KI-288).
 *
 * `nodes`/`edges` намеренно `unknown[]`: форма узла зависит от типа
 * (`text`/`llm`/`http`/…), а свободные UI-поля React Flow (`selected`,
 * `measured`) обязаны переживать round-trip. Глубокая валидация графа живёт в
 * движке (RULES 4.15: `unknown` + narrowing, без `any`).
 */
export const ExportWorkflowSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  exportedAt: z.string(),
});

/** Валидированный артефакт экспорта workflow. */
export type ExportWorkflow = z.infer<typeof ExportWorkflowSchema>;

/**
 * Zod-схема краткой карточки шаблона для вкладки «Шаблоны».
 *
 * Совпадает с backend-схемой `TemplateSummarySchema` (R6.6.1): `GET /templates`
 * отдаёт голый массив без envelope, а полный граф — только при
 * инстанцировании.
 */
export const TemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodeCount: z.number().int().nonnegative(),
});

/** Валидированная карточка шаблона. */
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

/**
 * Схема ответа «создан workflow» — `POST /workflow/import` и
 * `POST /templates/:id/instantiate`.
 *
 * Backend отдаёт целую строку `Workflow` (uuid, граф, даты, владелец). UI нужны
 * только `id` (перейти к созданному workflow) и `name` (текст уведомления),
 * поэтому схема читает ровно эти два поля, а остальные Zod отбрасывает — в
 * стор не попадают служебные поля (`shareToken`) и дубликат графа, который уже
 * вернёт `GET /workflow/:id`.
 */
const CreatedWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** Созданный workflow: то, что нужно UI для перехода и уведомления. */
export type CreatedWorkflow = z.infer<typeof CreatedWorkflowSchema>;

/**
 * Разбирает содержимое выбранного пользователем файла.
 *
 * Два шага — `JSON.parse` и Zod-валидация — объединены в одну функцию: обе
 * ошибки означают для пользователя одно и то же («это не файл workflow»), а
 * сообщение приходит снаружи, чтобы слой API не зависел от i18n (RULES 1.14).
 *
 * @param text - содержимое файла целиком
 * @param invalidMessage - текст ошибки для невалидного файла
 * @returns валидированный артефакт (лишние поля отбрасываются схемой)
 * @throws Error с текстом `invalidMessage`, если это не JSON или он не
 *   соответствует формату артефакта
 */
export function parseExportedWorkflowFile(
  text: string,
  invalidMessage: string,
): ExportWorkflow {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(invalidMessage);
  }

  const result = ExportWorkflowSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(invalidMessage);
  }

  return result.data;
}

/**
 * Выгружает workflow владельца в sharable-артефакт.
 *
 * @param id - uuid сохраняемого workflow
 * @returns артефакт `{ version, name, nodes, edges, exportedAt }`
 * @throws ApiError при сетевой ошибке, не-2xx статусе (в т.ч. 404 — чужой или
 *   удалённый workflow) или неожиданном формате ответа
 */
export async function exportWorkflowAsync(id: string): Promise<ExportWorkflow> {
  const data = await requestAsync<unknown>(
    `/workflow/${encodeURIComponent(id)}/export`,
  );

  return ExportWorkflowSchema.parse(data);
}

/**
 * Импортирует артефакт как новый workflow текущего пользователя.
 *
 * Владелец берётся из access-токена: `userId` в артефакте отсутствует по
 * построению, поэтому подставить чужого владельца через файл невозможно.
 *
 * KI-302: после успеха список workflow меняется — сбрасываем кэш, из которого
 * селект узла `sub_workflow` берёт свои опции.
 *
 * @param data - валидированный артефакт экспорта
 * @returns созданный workflow (`id` и `name`)
 * @throws ApiError при сетевой ошибке, не-2xx статусе (400 — невалидный
 *   артефакт) или неожиданном формате ответа
 */
export async function importWorkflowAsync(
  data: ExportWorkflow,
): Promise<CreatedWorkflow> {
  const created = await requestAsync<unknown>('/workflow/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  const workflow = CreatedWorkflowSchema.parse(created);

  invalidateWorkflowListCache();

  return workflow;
}

/**
 * Возвращает список доступных шаблонов.
 *
 * @returns карточки шаблонов (пустой список — шаблонов нет в поставке)
 * @throws ApiError при сетевой ошибке, не-2xx статусе или неожиданном формате
 */
export async function fetchTemplatesAsync(): Promise<TemplateSummary[]> {
  const data = await requestAsync<unknown>('/templates');

  return z.array(TemplateSummarySchema).parse(data);
}

/**
 * Создаёт workflow из шаблона.
 *
 * Тело запроса не отправляется: имя, узлы и связи берутся из шаблона целиком.
 *
 * KI-302: создание — это изменение списка workflow, поэтому кэш селекта
 * `sub_workflow` сбрасывается (иначе созданный из шаблона workflow появился бы
 * в нём только после F5).
 *
 * @param id - слаг шаблона (`text-llm`, `text-llm-image`, `http-llm`)
 * @returns созданный workflow (`id` и `name`)
 * @throws ApiError при сетевой ошибке, не-2xx статусе (404 — нет такого
 *   шаблона) или неожиданном формате ответа
 */
export async function instantiateTemplateAsync(
  id: string,
): Promise<CreatedWorkflow> {
  const created = await requestAsync<unknown>(
    `/templates/${encodeURIComponent(id)}/instantiate`,
    { method: 'POST' },
  );

  const workflow = CreatedWorkflowSchema.parse(created);

  invalidateWorkflowListCache();

  return workflow;
}
