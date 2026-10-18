/**
 * Media-инструменты (image-to-image) — R7.1, KI-196.
 *
 * Инструмент отличается от генерации тем, что на вход идёт **готовый файл**
 * (изображение/видео), а не только текстовый промпт: upscale, удаление фона,
 * хромакей, обрезка, липсинк. Поэтому у инструмента два входа — ссылка на файл
 * и параметры операции.
 *
 * ### Как инструменты устроены у upstream (проверено на реальном каталоге)
 *
 * В GPTunnel CreativeLab **нет отдельного эндпоинта и отдельного типа модели
 * для инструментов**: инструмент — это обычная media-модель каталога
 * (`GET /api/v2/media/models`) с обязательным входным слотом. Фактически:
 *
 * - `bgremover` (type `IMAGE`) — удаление фона, вход `image` (required);
 * - `kling-lipsync` (type `VIDEO`) — липсинк, входы `video` + `audio`;
 * - `faceswap` (type `IMAGE`) — два изображения;
 * - `@VideoEdit` (type `VIDEO`) — правка видео.
 *
 * Поэтому операция {@link ImageToolOperation} — это **роль** инструмента в
 * графе, а конкретная модель выбирается пользователем (или берётся дефолт из
 * {@link DEFAULT_IMAGE_TOOL_MODELS}). Отдельного `type: 'TOOL'` в каталоге нет:
 * `GET /media/models?type=TOOL` возвращает пустой список (см. KI в отчёте
 * R7.1), но значение `TOOL` в {@link MediaType} оставлено — оно пригодится,
 * когда upstream (или провайдеры R7.3) начнут помечать инструменты явно.
 */

/**
 * Операции узла `image_tool` (DESIGN v0.9 § 3.1).
 *
 * Порядок — как в DESIGN: сначала «улучшение» изображения, затем операции с
 * фоном и видео.
 */
export const IMAGE_TOOL_OPERATIONS = [
  'upscale',
  'bg_removal',
  'chromakey',
  'trim',
  'lipsync',
] as const;

/** Операция media-инструмента. */
export type ImageToolOperation = (typeof IMAGE_TOOL_OPERATIONS)[number];

/**
 * Проверяет, что значение — известная операция инструмента.
 *
 * Данные узла приходят из jsonb (RULES 1.17), поэтому значение проверяется на
 * границе, а не приводится типом.
 *
 * @param value - значение из `data.operation`
 * @returns `true`, если это одна из {@link IMAGE_TOOL_OPERATIONS}
 */
export function isImageToolOperation(value: unknown): value is ImageToolOperation {
  return (
    typeof value === 'string' &&
    (IMAGE_TOOL_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * Модели-инструменты CreativeLab по умолчанию (проверено по каталогу upstream).
 *
 * Каталог CreativeLab не помечает инструменты отдельным типом (KI-366), поэтому
 * дефолт — это id обычной IMAGE/VIDEO-модели с обязательным входным слотом.
 * Значения сверены с живым каталогом (`GET /api/v2/media/models`, 113 моделей,
 * 2026-10-18): `bgremover` (image), `kling-lipsync` (video + audio),
 * `@VideoEdit` (video). Для `upscale`/`chromakey` подходящих моделей в каталоге
 * нет — подставлять «похожую» модель нельзя: это платный запрос с неверной
 * семантикой (KI-367).
 *
 * Провайдер использует эту карту для собственного дефолта, когда исполнитель
 * узла не передал `params.model`.
 */
export const CREATIVELAB_IMAGE_TOOL_MODELS: Partial<
  Record<ImageToolOperation, string>
> = {
  bg_removal: 'bgremover',
  lipsync: 'kling-lipsync',
  trim: '@VideoEdit',
};

/**
 * Модель-инструмент по умолчанию для операции — упорядоченный список
 * кандидатов (KI-367).
 *
 * Значение — полный id модели в каталоге провайдера: у CreativeLab id без
 * префикса (`bgremover`), у прямых провайдеров — с префиксом
 * (`fal:fal-ai/clarity-upscaler`, `replicate:nightmareai/real-esrgan`).
 * `MediaNodeExecutor` берёт первого кандидата, которого реально объявил
 * сконфигурированный провайдер, поэтому порядок задаёт приоритет.
 *
 * Заполнено только то, что существует в каталогах:
 * - `upscale` — FAL `clarity-upscaler` / Replicate `real-esrgan` (R7.3);
 * - `bg_removal` — CreativeLab `bgremover` / FAL `rembg` / Replicate `rembg`;
 * - `lipsync` — CreativeLab `kling-lipsync`;
 * - `trim` — CreativeLab `@VideoEdit`;
 * - `chromakey` — пусто: ни один каталог не объявляет модель хромакея.
 *
 * Принцип KI-069: молчаливой подмены нет. Если ни один кандидат не найден,
 * узел падает с понятной ошибкой, а не отправляет платный запрос «похожей»
 * модели.
 */
export const DEFAULT_IMAGE_TOOL_MODELS: Partial<
  Record<ImageToolOperation, readonly string[]>
> = {
  upscale: ['fal:fal-ai/clarity-upscaler', 'replicate:nightmareai/real-esrgan'],
  bg_removal: [
    'bgremover',
    'fal:fal-ai/imageutils/rembg',
    'replicate:cjwbw/rembg',
  ],
  lipsync: ['kling-lipsync'],
  // Хромакея нет ни у CreativeLab, ни у прямых провайдеров (KI-418): модель
  // выбирается вручную, если она появится в каталоге.
  chromakey: [],
  trim: ['@VideoEdit'],
};

/**
 * Промпт по умолчанию для операции.
 *
 * Часть моделей-инструментов объявляет `prompt: 'required'` (например
 * `bgremover`), хотя содержательно промпт не нужен. Пустой промпт upstream
 * отклонил бы (`400`, `code: 25`), поэтому отправляем короткое описание
 * операции; пользовательский `data.params.prompt` имеет приоритет.
 */
export const DEFAULT_IMAGE_TOOL_PROMPTS: Record<ImageToolOperation, string> = {
  upscale: 'upscale this image, keep the details',
  bg_removal: 'remove the background',
  chromakey: 'replace the green screen background',
  trim: 'trim this video to the selected range',
  lipsync: 'sync the lips to the audio',
};

/**
 * Тип основного входного файла операции.
 *
 * `image` — картинка (upscale, удаление фона, хромакей), `video` — видео
 * (обрезка, липсинк: у `kling-lipsync` основной слот — именно видео).
 */
export const IMAGE_TOOL_INPUT_KINDS: Record<
  ImageToolOperation,
  'image' | 'video'
> = {
  upscale: 'image',
  bg_removal: 'image',
  chromakey: 'image',
  trim: 'video',
  lipsync: 'video',
};

/**
 * Параметры вызова инструмента.
 *
 * Расширяет `Record<string, unknown>` (сигнатура
 * {@link IMediaProvider.applyToolAsync}), потому что набор параметров у
 * моделей разный и описывается каталогом: скалярные ключи отсюда уходят в
 * `params` запроса, а перечисленные ниже — служебные.
 */
export interface ImageToolParams extends Record<string, unknown> {
  /** id модели-инструмента из каталога; пусто — дефолт операции. */
  model?: string;
  /** Текстовый промпт (перекрывает {@link DEFAULT_IMAGE_TOOL_PROMPTS}). */
  prompt?: string;
  /**
   * Ключ идемпотентности (обычно `runId:nodeId`): retry не создаёт вторую
   * платную задачу (KI-040).
   */
  idempotencyKey?: string;
  /**
   * Явные входные слоты запроса (`{ role: [url] }`) — перекрывают
   * автоматический подбор слотов по каталогу.
   */
  inputs?: Record<string, string[]>;
  /**
   * Ссылка на аудио для `lipsync`: у `kling-lipsync` два обязательных слота
   * (видео + аудио), а `inputUrl` несёт только основной файл.
   */
  audioUrl?: string;
}

/**
 * Служебные ключи {@link ImageToolParams}: в `params` запроса upstream они не
 * уходят (у него это поля верхнего уровня либо наши внутренние значения).
 */
export const IMAGE_TOOL_RESERVED_PARAM_KEYS: ReadonlySet<string> = new Set([
  'model',
  'prompt',
  'idempotencyKey',
  'inputs',
  'audioUrl',
]);
