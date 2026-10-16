import type { MediaModelInfo, MediaParam } from '@/types/media';

/**
 * Чистая логика узлов media-генерации R7.2 (KI-361, DESIGN v0.9 § 3.2).
 *
 * Зеркало backend `src/media/media-generation.ts`: те же предпочтения моделей и
 * тот же фолбэк для аудио. UI обязан предлагать ровно то, что принимает
 * backend, иначе узел падал бы на Zod-схеме или на «модель не того типа».
 *
 * ### Почему для AUDIO берутся модели из MUSIC
 *
 * Реальный каталог CreativeLab не отдаёт `type=AUDIO`
 * (`{ code: 0, models: [] }`): TTS-модель `tts2` объявлена как `MUSIC` с
 * параметром `voice`. Поэтому селект узла озвучки — AUDIO-модели (если upstream
 * их размечет) плюс TTS-модели из MUSIC. Фолбэк тот же, что на backend.
 */

/** Тип media-модели для узлов генерации R7.2. */
export type GenerationMediaType = 'VIDEO' | 'AUDIO' | 'MUSIC';

/**
 * Тип media-модели по типу узла.
 *
 * Значения совпадают с backend `NODE_PORT_CONTRACT`/`GENERATION_MEDIA_TYPE_BY_KIND`.
 */
export const GENERATION_MEDIA_TYPE_BY_NODE: Record<string, GenerationMediaType> = {
  video_generation: 'VIDEO',
  audio_generation: 'AUDIO',
  music_generation: 'MUSIC',
};

/**
 * Предпочтительные модели по умолчанию (id реального каталога CreativeLab).
 *
 * Порядок повторяет backend `PREFERRED_GENERATION_MODEL_IDS`: узел создаётся
 * уже с рабочей моделью, если каталог загружен.
 */
export const PREFERRED_GENERATION_MODEL_IDS: Record<
  GenerationMediaType,
  readonly string[]
> = {
  VIDEO: ['wan-2.5', 'kling-v2-5', 'seedance-2-mini', 'glabs-veo-3-1-lite'],
  AUDIO: ['tts2'],
  MUSIC: ['suno', 'mureka', 'minimax-music', 'grom-zvuk'],
};

/** Возможные ключи голоса у TTS-моделей (совпадает с backend). */
export const VOICE_PARAM_KEYS: readonly string[] = ['voice', 'voice_id'];

/** Возможные ключи жанра у music-моделей (совпадает с backend). */
export const GENRE_PARAM_KEYS: readonly string[] = ['genre', 'tags'];

/**
 * Проверяет, объявляет ли модель голосовой параметр (то есть умеет TTS).
 *
 * @param model - модель из каталога media
 * @returns `true`, если среди параметров есть `voice`/`voice_id`
 */
export function isTtsModel(model: MediaModelInfo): boolean {
  return model.params.some((param) => VOICE_PARAM_KEYS.includes(param.key));
}

/**
 * Отбирает модели для селекта узла media-генерации.
 *
 * Для AUDIO — AUDIO-модели плюс TTS-модели из MUSIC (см. шапку файла); для
 * VIDEO/MUSIC — модели соответствующего типа без изменений.
 *
 * @param catalog - все загруженные модели (любых типов)
 * @param type - тип модели узла
 * @returns модели для селекта (пустой массив — подходящих нет)
 */
export function pickGenerationModels(
  catalog: readonly MediaModelInfo[],
  type: GenerationMediaType,
): readonly MediaModelInfo[] {
  if (type !== 'AUDIO') {
    return catalog.filter((model) => model.type === type);
  }

  const merged: MediaModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of catalog) {
    if (seen.has(model.id) || (model.type !== 'AUDIO' && !isTtsModel(model))) {
      continue;
    }

    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

/**
 * Выбирает модель по умолчанию для нового узла media-генерации.
 *
 * @param models - модели из {@link pickGenerationModels}
 * @param type - тип модели узла
 * @returns id модели либо `''` — «каталог пуст, выберет backend»
 */
export function pickDefaultGenerationModel(
  models: readonly MediaModelInfo[],
  type: GenerationMediaType,
): string {
  for (const preferredId of PREFERRED_GENERATION_MODEL_IDS[type]) {
    if (models.some((model) => model.id === preferredId)) {
      return preferredId;
    }
  }

  const promptDriven = models.find(
    (model) => !model.inputs.some((input) => input.required === true),
  );

  return promptDriven?.id ?? models[0]?.id ?? '';
}

/**
 * Ищет объявленный моделью параметр по возможным ключам.
 *
 * @param model - модель из каталога (может быть `undefined` — не выбрана)
 * @param keys - возможные ключи параметра
 * @returns описание параметра либо `undefined`
 */
export function pickDeclaredParam(
  model: MediaModelInfo | undefined,
  keys: readonly string[],
): MediaParam | undefined {
  if (model === undefined) {
    return undefined;
  }

  return model.params.find((param) => keys.includes(param.key));
}

/**
 * Значение параметра для селекта: выбор пользователя → дефолт → первый вариант.
 *
 * @param param - объявленный параметр модели
 * @param value - значение из данных узла (`undefined` — не задано)
 * @returns строковое значение для `<select>`
 */
export function paramSelectValue(
  param: MediaParam,
  value: unknown,
): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (param.default !== undefined) {
    return String(param.default);
  }

  return param.options?.[0]?.value !== undefined
    ? String(param.options[0].value)
    : '';
}

/**
 * Варианты значений enum-параметра для `<select>`.
 *
 * @param param - объявленный параметр модели
 * @returns значения вариантов (пустой массив — параметр без `options`)
 */
export function paramOptions(param: MediaParam): readonly string[] {
  return (param.options ?? []).map((option) => String(option.value));
}

/**
 * Приводит введённое значение числового поля к числу.
 *
 * Нужно для полей `durationSec`/`speed`: пустая строка и мусор не должны
 * попадать в данные узла (KI-129 — пустых ключей быть не должно).
 *
 * @param value - строка из `<input type="number">`
 * @returns число либо `undefined`, если ввод пуст/некорректен
 */
export function parseNumberField(value: string): number | undefined {
  if (value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}
