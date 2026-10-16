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
 * Модель по умолчанию для операции.
 *
 * Заполнено только там, где у upstream **есть** подходящая модель (проверено
 * запросом каталога): удаление фона и липсинк. Для остальных операций дефолта
 * нет — узел без выбранной модели честно падает с понятной ошибкой, а не
 * подставляет случайную модель (принцип KI-069: молчаливой подмены нет).
 */
export const DEFAULT_IMAGE_TOOL_MODELS: Partial<
  Record<ImageToolOperation, string>
> = {
  bg_removal: 'bgremover',
  lipsync: 'kling-lipsync',
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
