import { z } from 'zod';
import { RunStatusSchema } from '@/types/run-stream';

/** База API: пустая строка — запросы идут на dev-сервер и проксируются Vite. */
const API_BASE = '';

/** Схема узла в том виде, в каком он приходит из backend. */
export const ApiNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Схема связи. */
export const ApiEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
});

/** Узел в терминах API (совместим с backend-DTO `NodeDto`). */
export type ApiGraphNode = z.infer<typeof ApiNodeSchema>;
/** Связь в терминах API. */
export type ApiGraphEdge = z.infer<typeof ApiEdgeSchema>;

/** Схема workflow, возвращаемого backend. */
export const ApiWorkflowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  nodes: z.array(ApiNodeSchema).default([]),
  edges: z.array(ApiEdgeSchema).default([]),
  version: z.number().default(1),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});

/** Workflow в терминах API. */
export type ApiWorkflow = z.infer<typeof ApiWorkflowSchema>;

/** Уровни выполнения из `/engine/plan`. */
export interface ExecutionPlan {
  order: string[];
  levels: string[][];
  executionMap: Record<
    string,
    { inputs: Record<string, unknown>; dependents: string[] }
  >;
}

/**
 * Схема запуска, возвращаемого `POST /runs`.
 *
 * Поля совпадают с backend `RunResponse`; `createdAt` приходит ISO-строкой
 * после сериализации `Date`, `status` — тот же набор значений, что и в SSE.
 */
export const ApiRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: RunStatusSchema,
  createdAt: z.string(),
});

/** Запуск в терминах API. */
export type ApiRun = z.infer<typeof ApiRunSchema>;

/** Ошибка обращения к API (сеть, HTTP-статус или неожиданный формат ответа). */
export class ApiError extends Error {
  /** HTTP-статус, если ответ успел прийти. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Тело ошибки NestJS/пайпа валидации. */
interface ErrorBody {
  message?: string | string[];
  errors?: string[];
}

/** Собирает человекочитаемое сообщение из тела ошибки backend. */
function errorMessageFrom(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const { message, errors } = body as ErrorBody;

    if (Array.isArray(message) && message.length > 0) {
      return message.join('; ');
    }

    if (typeof message === 'string' && message.length > 0) {
      return errors?.length ? `${message}: ${errors.join('; ')}` : message;
    }

    if (errors?.length) {
      return errors.join('; ');
    }
  }

  return `Запрос завершился со статусом ${status}`;
}

/**
 * Выполняет запрос к API и разбирает JSON.
 *
 * @param url - путь относительно API_BASE
 * @param options - опции fetch
 * @returns разобранный ответ
 * @throws ApiError при сетевой ошибке, не-2xx статусе или пустом ответе там,
 *   где ожидался JSON
 */
export async function requestAsync<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch {
    // fetch падает только на сетевых ошибках и CORS: backend недоступен.
    throw new ApiError(
      'Не удалось связаться с сервером. Проверьте, запущен ли backend на порту 3000',
    );
  }

  const text = await response.text();
  let body: unknown = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(
        `Сервер вернул ответ не в формате JSON (статус ${response.status})`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    throw new ApiError(errorMessageFrom(body, response.status), response.status);
  }

  return body as T;
}

/**
 * Список workflow.
 *
 * @param userId - необязательный фильтр по владельцу
 */
export async function listWorkflowsAsync(
  userId?: string,
): Promise<ApiWorkflow[]> {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const data = await requestAsync<unknown>(`/workflow${query}`);

  return z.array(ApiWorkflowSchema).parse(data);
}

/**
 * Загружает один workflow по идентификатору.
 *
 * @param id - uuid workflow
 */
export async function getWorkflowAsync(id: string): Promise<ApiWorkflow> {
  const data = await requestAsync<unknown>(`/workflow/${encodeURIComponent(id)}`);

  return ApiWorkflowSchema.parse(data);
}

/**
 * Создаёт workflow.
 *
 * @param dto - данные нового workflow
 */
export async function createWorkflowAsync(dto: {
  userId: string;
  name: string;
  description?: string;
  nodes: ApiGraphNode[];
  edges: ApiGraphEdge[];
}): Promise<ApiWorkflow> {
  const data = await requestAsync<unknown>('/workflow', {
    method: 'POST',
    body: JSON.stringify(dto),
  });

  return ApiWorkflowSchema.parse(data);
}

/**
 * Обновляет workflow.
 *
 * @param id - uuid workflow
 * @param dto - изменяемые поля (backend не принимает `userId` в PATCH)
 */
export async function updateWorkflowAsync(
  id: string,
  dto: {
    name?: string;
    description?: string;
    nodes?: ApiGraphNode[];
    edges?: ApiGraphEdge[];
  },
): Promise<ApiWorkflow> {
  const data = await requestAsync<unknown>(`/workflow/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });

  return ApiWorkflowSchema.parse(data);
}

/**
 * Удаляет workflow.
 *
 * @param id - uuid workflow
 */
export async function deleteWorkflowAsync(id: string): Promise<void> {
  await requestAsync<null>(`/workflow/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/**
 * Строит план выполнения графа.
 *
 * @param nodes - узлы графа
 * @param edges - связи графа
 */
export async function planWorkflowAsync(
  nodes: ApiGraphNode[],
  edges: ApiGraphEdge[],
): Promise<ExecutionPlan> {
  return requestAsync<ExecutionPlan>('/engine/plan', {
    method: 'POST',
    body: JSON.stringify({ nodes, edges }),
  });
}

/**
 * Создаёт запуск workflow: backend фиксирует snapshot графа и ставит задание
 * в очередь (`POST /runs`, R1).
 *
 * @param workflowId - id сохранённого workflow
 * @returns созданный запуск (нужен `id` для подписки на SSE)
 * @throws ApiError при сетевой ошибке, не-2xx статусе или неожиданном формате
 */
export async function createRunAsync(workflowId: string): Promise<ApiRun> {
  const data = await requestAsync<unknown>('/runs', {
    method: 'POST',
    body: JSON.stringify({ workflowId }),
  });

  return ApiRunSchema.parse(data);
}
