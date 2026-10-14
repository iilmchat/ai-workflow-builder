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
 * Приводит ошибку upstream к читаемому тексту (KI-181).
 *
 * Upstream отдаёт причину либо строкой, либо объектом
 * `{ code, title, message }`. Во втором случае собираем
 * «title: message», а если их нет — упоминаем код.
 *
 * @param error - поле `error` из ответа upstream
 * @returns текст причины либо `null`, если ошибки нет
 */
function toErrorText(
  error: MediaTaskResponseDto['error'],
): string | null {
  if (error === undefined) {
    return null;
  }

  if (typeof error === 'string') {
    return error.length > 0 ? error : null;
  }

  const parts = [error.title, error.message].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );

  if (parts.length > 0) {
    return parts.join(': ');
  }

  return typeof error.code === 'number' ? `код ${error.code}` : null;
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
    // KI-111: dto.result — массив объектов { url }, извлекаем строки.
    resultUrls: dto.result?.map((item) => item.url) ?? [],
    // KI-181: упавшая задача с `refunded: true` не списала деньги —
    // показывать её стоимость как потраченную нельзя.
    costRub: dto.refunded === true ? null : (dto.price ?? null),
    error: toErrorText(dto.error),
  };
}
