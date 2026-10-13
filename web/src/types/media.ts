import { z } from 'zod';

/**
 * Zod-схемы media-моделей — зеркало backend `MediaModelInfo`
 * (v0.6.0b.2.1) и выходов media-узла (v0.6.0b.2.2).
 *
 * Данные приходят из внешнего источника (`GET /media/models`, SSE-snapshot),
 * поэтому валидируются на границе (RULES 1.17). Синхронизация с backend
 * ручная: при изменении backend-схемы это зеркало нужно править следом.
 */

/** Вариант значения enum-параметра. */
export const MediaParamEnumOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string(),
});

/**
 * Один параметр генерации (dynamic schema от upstream).
 *
 * `passthrough()` — набор полей зависит от типа параметра и может
 * расшириться на стороне backend без релиза фронтенда.
 */
export const MediaParamSchema = z
  .object({
    key: z.string(),
    type: z.enum(['enum', 'number', 'string', 'boolean']),
    label: z.string(),
    description: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(MediaParamEnumOptionSchema).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    integer: z.boolean().optional(),
    unit: z.string().optional(),
  })
  .passthrough();

/** Тип media-модели (совпадает с полем `type` backend-модели). */
export const MediaModelTypeSchema = z.enum([
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'MUSIC',
  '3D',
]);

/** Тип media-модели. */
export type MediaModelType = z.infer<typeof MediaModelTypeSchema>;

/**
 * Описание media-модели для UI.
 *
 * `inputs` (слоты входных файлов) в UI этой версии не используются — загрузка
 * файлов появится позже, поэтому массив не разбирается по полям.
 */
export const MediaModelInfoSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    type: MediaModelTypeSchema,
    price: z.number().nonnegative(),
    priceUnit: z.string().nullable(),
    priceInput: z.number().nullable(),
    priceInputUnit: z.string().nullable(),
    moderation: z.enum(['auto', 'strict']),
    prompt: z.enum(['required', 'optional', 'none']),
    params: z.array(MediaParamSchema),
    /** Не используется в v0.6.0b.2.3 (загрузка файлов — позже). */
    inputs: z.array(z.unknown()),
    deprecated: z.boolean().optional(),
    deprecationRedirectTo: z.string().optional(),
  })
  .passthrough();

/** Описание media-модели. */
export type MediaModelInfo = z.infer<typeof MediaModelInfoSchema>;
/** Один параметр генерации media-модели. */
export type MediaParam = z.infer<typeof MediaParamSchema>;

/**
 * Выходы media-узла из `node_runs.outputs` (сериализуются в SSE).
 *
 * Executor (v0.6.0b.2.2) пишет ровно эти три поля: `mediaUrl` может быть
 * `null`, если upstream не вернул ни одного URL (падать узел при этом не обязан).
 */
export const MediaNodeOutputsSchema = z.object({
  mediaUrl: z.string().url().nullable(),
  mediaType: z.string(),
  taskId: z.string(),
});

/** Выходы media-узла. */
export type MediaNodeOutputs = z.infer<typeof MediaNodeOutputsSchema>;

/**
 * Проверяет, что URL безопасно подставлять в `<img src>`.
 *
 * Backend отдаёт ссылку от внешнего провайдера, поэтому перед рендером
 * ограничиваем схему: `javascript:`/`data:` в `<img>` недопустимы (KI-006 —
 * раньше `imageUrl` вообще не валидировался).
 *
 * @param url - URL из outputs media-узла
 * @returns `true`, если схема `http` или `https`
 */
export function isRenderableMediaUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://');
}
