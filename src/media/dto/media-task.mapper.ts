import type { MediaTaskResponseDto } from './media-task.dto.js';

/** Результат работы с задачей media-генерации (camelCase, RULES 4.23). */
export interface MediaTaskResult {
  /** id задачи в upstream. */
  taskId: string;
  /** id модели, принявшей задачу. */
  model: string;
  /** Текущий статус задачи. */
  status: 'queued' | 'running' | 'done' | 'failed';
  /** URL-ы результата; пустой массив, пока задача не `done`. */
  resultUrls: string[];
  /** Стоимость генерации в рублях; `null`, пока upstream её не отдал. */
  costRub: number | null;
  /** Причина падения при `status: 'failed'`, иначе `null`. */
  error: string | null;
}

/**
 * Приводит ответ upstream по задаче к внутреннему виду.
 *
 * @param dto - разобранный ответ `POST /media/tasks` или `GET /media/tasks/:id`
 * @returns результат задачи в camelCase
 */
export function toMediaTaskResult(dto: MediaTaskResponseDto): MediaTaskResult {
  return {
    taskId: dto.id,
    model: dto.model,
    status: dto.status,
    resultUrls: dto.result ?? [],
    costRub: dto.price ?? null,
    error: dto.error ?? null,
  };
}
