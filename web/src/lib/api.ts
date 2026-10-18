import { z } from 'zod';
import { getAccessToken, useAuthStore } from '@/stores/auth';
import {
  MediaModelInfoSchema,
  type MediaModelInfo,
  type MediaModelType,
} from '@/types/media';
import { RunStatusSchema } from '@/types/run-stream';
// Циклический импорт `api -> auth-api -> api` безопасен: `refreshAsync`
// вызывается в рантайме, а не на этапе оценки модулей.
import { refreshAsync } from './auth-api';

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
  /**
   * Роль текущего пользователя в workflow (KI-397).
   *
   * Поле необязательное: backend отдаёт его ещё не во всех ответах (список
   * workflow — KI-398). `null`/`undefined` означают «роль неизвестна», и UI не
   * блокирует действия. Значения совпадают с `AccessRole`
   * (`stores/workflow.ts`).
   */
  accessRole: z.enum(['owner', 'editor', 'viewer']).nullish(),
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

/**
 * Схема бюджета запуска (`GET /runs/:id/budget`, R7.1, KI-048).
 *
 * Поля совпадают с backend `RunBudgetResponse`
 * (`src/runs/dto/run-budget.dto.ts`); паритет состава проверяет
 * `api-contract.spec.ts` через `docs/development/api-contract.json`.
 */
export const ApiRunBudgetSchema = z.object({
  ok: z.boolean(),
  accumulated: z.number(),
  estimated: z.number(),
  remaining: z.number(),
  maxUsd: z.number(),
  maxRub: z.number(),
  mode: z.enum(['hard', 'soft']),
});

/** Бюджет запуска в терминах API. */
export type ApiRunBudget = z.infer<typeof ApiRunBudgetSchema>;

/**
 * Модальность модели: что она принимает или отдаёт (v0.6.0a).
 *
 * Список совпадает с backend `ModelModality` — порядок и значения обязаны
 * совпадать, иначе Zod отклонит ответ `GET /llm/models`.
 */
export const ModelModalitySchema = z.enum([
  'text',
  'vision',
  'image-generation',
  'audio',
  'video',
  'embedding',
]);

/** Модальность модели. */
export type ModelModality = z.infer<typeof ModelModalitySchema>;

/** Модель, доступная для выбора в LLM-узле (R4.1b, KI-056; capabilities — v0.6.0a). */
export const LlmModelInfoSchema = z.object({
  provider: z.string(),
  id: z.string(),
  label: z.string(),
  inputModalities: z.array(ModelModalitySchema),
  outputModalities: z.array(ModelModalitySchema),
  // R6.3.2 (KI-193/KI-183): признаки reasoning и дефолтный лимит токенов.
  // Zod отбрасывает неописанные поля, поэтому их нужно объявить явно (KI-149).
  supportsReasoning: z.boolean().optional(),
  defaultMaxTokens: z.number().optional(),
});

/** Модель в терминах API: id для вызова, label и модальности для интерфейса. */
export type LlmModelInfo = z.infer<typeof LlmModelInfoSchema>;

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
 * Пути, для которых 401 — ожидаемый ответ, а не признак истёкшего access.
 *
 * Их обрабатывает UI (`/auth/login` показывает «неверный пароль», `/auth/logout`
 * идемпотентен), поэтому рекурсивный refresh и подстановка токена не нужны.
 */
const AUTH_PATHS_WITHOUT_REFRESH = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
];

/** Идущий refresh — single-flight: параллельные 401 ждут один и тот же промис. */
let refreshPromise: Promise<boolean> | null = null;

/**
 * Проверяет, относится ли путь к «публичным» ручкам auth.
 *
 * @param url - путь запроса
 * @returns `true`, если 401 здесь ожидаем
 */
function isAuthPathWithoutRefresh(url: string): boolean {
  return AUTH_PATHS_WITHOUT_REFRESH.some((path) => url.startsWith(path));
}

/**
 * Обновляет access-токен по refresh-cookie и синхронизирует стор.
 *
 * Single-flight: сколько бы запросов ни получили 401, на backend уйдёт один
 * `POST /auth/refresh` — иначе вторая ротация отозвала бы только что выданный
 * токен. Используется и интерцептором, и `AuthProvider` при загрузке страницы.
 *
 * @returns `true`, если сессия восстановлена, иначе `false`
 */
export async function refreshSessionAsync(): Promise<boolean> {
  if (refreshPromise === null) {
    refreshPromise = runRefreshAsync();
  }

  return refreshPromise;
}

/**
 * Выполняет единственный refresh и сбрасывает single-flight-состояние.
 *
 * @returns `true`, если сессия восстановлена
 */
async function runRefreshAsync(): Promise<boolean> {
  try {
    const result = await refreshAsync();

    useAuthStore.getState().setSession(result.user, result.accessToken);

    return true;
  } catch {
    // Refresh упал (cookie нет/истекла/отозвана) — сессии больше нет.
    useAuthStore.getState().clearSession();

    return false;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Отправляет запрос: подставляет access-токен из стора.
 *
 * @param url - путь относительно API_BASE
 * @param options - опции fetch
 * @param forceToken - перезаписать уже переданный `Authorization` (повтор
 *   после refresh обязан идти с новым токеном)
 * @returns ответ fetch
 * @throws ApiError при сетевой ошибке
 */
async function sendAsync(
  url: string,
  options: RequestInit,
  forceToken = false,
): Promise<Response> {
  const headers = new Headers(options.headers);
  const token = getAccessToken();

  headers.set('Content-Type', 'application/json');

  if (token !== null && !isAuthPathWithoutRefresh(url) && (forceToken || !headers.has('Authorization'))) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  try {
    return await fetch(`${API_BASE}${url}`, { ...options, headers });
  } catch {
    // fetch падает только на сетевых ошибках и CORS: backend недоступен.
    throw new ApiError(
      'Не удалось связаться с сервером. Проверьте, запущен ли backend на порту 3000',
    );
  }
}

/**
 * Разбирает ответ: JSON, пустое тело, ошибки.
 *
 * @param response - ответ fetch
 * @returns разобранное тело
 * @throws ApiError при не-2xx статусе или невалидном JSON
 */
async function parseResponseAsync<T>(response: Response): Promise<T> {
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
 * Выполняет запрос к API и разбирает JSON.
 *
 * R6.1b.2: при 401 (кроме ручек auth) один раз обновляет access по
 * refresh-cookie и повторяет запрос с новым токеном. Если refresh не удался,
 * стор переходит в `guest`, а наверх уходит исходная 401.
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
  const response = await sendAsync(url, options);

  if (response.status === 401 && !isAuthPathWithoutRefresh(url)) {
    const refreshed = await refreshSessionAsync();

    if (refreshed) {
      return parseResponseAsync<T>(await sendAsync(url, options, true));
    }
  }

  return parseResponseAsync<T>(response);
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

/**
 * Возвращает бюджет запуска (R7.1, KI-048).
 *
 * Отдельная ручка, а не поле SSE-снимка: контракт потока в R7.1 не меняется
 * (DESIGN v0.9 § 3.1). TopBar запрашивает бюджет при старте запуска и после
 * каждого завершённого узла — цифры те же, что проверяет предохранитель.
 *
 * @param runId - id запуска
 * @returns лимиты и потраченное (USD-нормализация + рублёвый лимит)
 * @throws ApiError при сетевой ошибке, не-2xx статусе или неожиданном формате
 */
export async function fetchRunBudgetAsync(runId: string): Promise<ApiRunBudget> {
  const data = await requestAsync<unknown>(
    `/runs/${encodeURIComponent(runId)}/budget`,
  );

  return ApiRunBudgetSchema.parse(data);
}

/**
 * Возвращает модели, доступные для вызова.
 *
 * Backend уже отфильтровал неконфигурированные провайдеры (KI-039), поэтому
 * пустой список означает «ключей нет» — UI покажет это в селекте модели.
 *
 * @returns список моделей (пустой, если ни один провайдер не сконфигурирован)
 * @throws ApiError при сетевой ошибке, не-2xx статусе или неожиданном формате
 */
export async function fetchLlmModelsAsync(): Promise<LlmModelInfo[]> {
  const data = await requestAsync<unknown>('/llm/models');

  return z.array(LlmModelInfoSchema).parse(data);
}

/**
 * Возвращает media-модели указанного типа (v0.6.0b.2.3).
 *
 * Ответ приходит в camelCase (`{ models: [...] }`), маппинг из snake_case
 * делает backend. Пустой список означает «GPTunnel media не сконфигурирован».
 *
 * @param type - тип моделей; по умолчанию `IMAGE` (узел Image Generation)
 * @returns список media-моделей (пустой, если провайдер не сконфигурирован)
 * @throws ApiError при сетевой ошибке, не-2xx статусе или неожиданном формате
 */
export async function fetchMediaModelsAsync(
  type: MediaModelType = 'IMAGE',
): Promise<MediaModelInfo[]> {
  const data = await requestAsync<unknown>(
    `/media/models?type=${encodeURIComponent(type)}`,
  );
  const parsed = z.object({ models: z.array(MediaModelInfoSchema) }).parse(data);

  return parsed.models;
}
