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

/**
 * Тип media-модели (совпадает с полем `type` backend-модели).
 *
 * `TOOL` (R7.1) — media-инструмент. На момент R7.1 каталог CreativeLab такого
 * типа не отдаёт (`GET /media/models?type=TOOL` → пустой список: инструменты
 * приходят как `IMAGE`/`VIDEO` с обязательным входным слотом), но значение
 * заведено и принимается, чтобы фронтенд не отбрасывал ответ, когда upstream
 * (или провайдеры R7.3) начнут помечать инструменты явно.
 */
export const MediaModelTypeSchema = z.enum([
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'MUSIC',
  '3D',
  'TOOL',
]);

/** Тип media-модели. */
export type MediaModelType = z.infer<typeof MediaModelTypeSchema>;

/**
 * Входной слот модели (R7.1).
 *
 * До R7.1 массив `inputs` не разбирался по полям (загрузки файлов в UI не
 * было). Для узла `image_tool` он нужен: по обязательным слотам выбираются
 * модели-инструменты, когда каталог не помечает их типом `TOOL`.
 */
export const MediaInputSchema = z
  .object({
    /** Ключ слота, уходит в `inputs` запроса. */
    key: z.string(),
    /** Что принимает слот. */
    kind: z.enum(['image', 'video', 'audio']),
    /** Роль слота (`reference`, `first_frame`, ...). */
    role: z.string().optional(),
    /** Обязателен ли слот. */
    required: z.boolean().default(false),
  })
  .passthrough();

/** Входной слот модели. */
export type MediaInput = z.infer<typeof MediaInputSchema>;

/**
 * Описание media-модели для UI.
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
    /** Входные слоты: по ним узел `image_tool` выбирает модели-инструменты. */
    inputs: z.array(MediaInputSchema),
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
 * Выходы узла `image_tool` из `node_runs.outputs` (R7.1, DESIGN v0.9 § 3.1).
 *
 * Executor пишет `{ resultUrls, costRub, mediaType: 'TOOL', taskId }` — у
 * инструмента результат это **список** ссылок, а стоимость отдаётся отдельным
 * полем. Схема намеренно допускает лишние ключи (`passthrough`): контракт
 * выходов расширяется без релиза фронтенда.
 */
export const ImageToolOutputsSchema = z
  .object({
    /** URL-ы результата операции (пустой массив — upstream не отдал файл). */
    resultUrls: z.array(z.string()).default([]),
    /** Стоимость операции в рублях (`null`, если upstream её не отдал). */
    costRub: z.number().nullable().optional(),
  })
  .passthrough();

/** Выходы узла `image_tool`. */
export type ImageToolOutputs = z.infer<typeof ImageToolOutputsSchema>;

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
