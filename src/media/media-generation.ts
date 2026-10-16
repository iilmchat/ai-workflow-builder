/**
 * Media-генерация: video / audio / music — R7.2, KI-361.
 *
 * Отличие от узла `image_generation` (v0.6.0b.2.2) только в типе модели
 * (`VIDEO`/`AUDIO`/`MUSIC`) и в том, какие поля узла превращаются в параметры
 * запроса. Механика та же: `POST /media/tasks` → опрос → `resultUrls`.
 *
 * ### Реальность каталога CreativeLab (проверено запросом `GET /media/models`)
 *
 * - `type=VIDEO` — 47 моделей (`duration` и `aspect_ratio` объявлены **enum**
 *   со строковыми значениями: `"5"`, `"16:9"`); слот картинки для
 *   image-to-video называется по-разному: `first_frame`, `image`,
 *   `reference_image`, `keyframes`, `draft_source`;
 * - `type=AUDIO` — **пусто** (`{ code: 0, models: [] }`): TTS-модели CreativeLab
 *   лежат в `type=MUSIC` (`tts2` — параметр `voice`, тариф `per_character`);
 * - `type=MUSIC` — 6 моделей (`minimax-music`, `mureka`, `suno`, `grom-zvuk`,
 *   `sound-effect`, `tts2`).
 *
 * Поэтому у аудио-узла есть **документированный фолбэк** (как `toolModels` в
 * R7.1): если каталог не отдаёт ни одной AUDIO-модели, берутся MUSIC-модели,
 * объявившие голосовой параметр (`voice`/`voice_id`) — это и есть TTS.
 *
 * ### Параметры — только объявленные моделью (KI-181)
 *
 * Набор полей у моделей разный (`duration`, `aspect_ratio`, `resolution`,
 * `voice`, `tags`, ...), и upstream на «чужой» параметр отвечает
 * `Invalid input, check schema issues`, не объясняя причину. Поэтому значения
 * отдельных полей узла (`durationSec`, `aspectRatio`, `voiceId`, `speed`,
 * `genre`) раскладываются по **возможным** ключам upstream, а фильтр по
 * каталогу оставляет только те, что модель действительно объявила.
 */

import type { MediaModelInfo, MediaType } from './media-provider.interface.js';

/** Типы узлов media-генерации R7.2 (DESIGN v0.9 § 3.2). */
export const GENERATION_NODE_KINDS = [
  'video_generation',
  'audio_generation',
  'music_generation',
] as const;

/** Тип узла media-генерации. */
export type GenerationNodeKind = (typeof GENERATION_NODE_KINDS)[number];

/**
 * Тип media-модели по типу узла.
 *
 * Источник правды одновременно для исполнителя и для UI: узел
 * `video_generation` всегда работает с `VIDEO`-моделью, и наоборот.
 */
export const GENERATION_MEDIA_TYPE_BY_KIND: Record<GenerationNodeKind, MediaType> =
  {
    video_generation: 'VIDEO',
    audio_generation: 'AUDIO',
    music_generation: 'MUSIC',
  };

/**
 * Предпочтительные модели по умолчанию (id из каталога CreativeLab).
 *
 * Порядок — «сначала дешёвая и предсказуемая модель с текстовым входом»:
 * значения проверены по реальному каталогу (цены на 2026-10-16, ₽/генерация):
 *
 * - VIDEO: `wan-2.5` (55, duration 5/10, aspect_ratio), `kling-v2-5` (60),
 *   `seedance-2-mini` (41), `glabs-veo-3-1-lite` (30);
 * - AUDIO: `tts2` — единственная TTS-модель каталога (лежит в MUSIC);
 * - MUSIC: `suno` (24), `mureka` (18), `minimax-music` (30), `grom-zvuk` (6).
 *
 * Если ни одного id нет в каталоге, берётся первая подходящая модель (см.
 * {@link pickDefaultGenerationModel}): пустой модели узел не получает.
 */
export const PREFERRED_GENERATION_MODEL_IDS: Record<
  MediaType,
  readonly string[]
> = {
  VIDEO: ['wan-2.5', 'kling-v2-5', 'seedance-2-mini', 'glabs-veo-3-1-lite'],
  AUDIO: ['tts2'],
  MUSIC: ['suno', 'mureka', 'minimax-music', 'grom-zvuk'],
  // Остальные типы узлов R7.2 не используют: списки пусты, чтобы «дефолт из
  // чужого типа» не подставлялся молча (KI-069).
  IMAGE: [],
  '3D': [],
  TOOL: [],
};

/** Параметр длительности в каталоге CreativeLab. */
export const DURATION_PARAM_KEY = 'duration';
/** Параметр соотношения сторон в каталоге CreativeLab. */
export const ASPECT_RATIO_PARAM_KEY = 'aspect_ratio';

/**
 * Возможные ключи голоса у TTS-моделей.
 *
 * `tts2` объявляет `voice`; другие провайдеры (ElevenLabs и подобные) обычно
 * используют `voice_id`. Значение узла раскладывается по всем ключам сразу, а
 * фильтр по каталогу оставляет тот, который модель действительно принимает.
 */
export const VOICE_PARAM_KEYS: readonly string[] = ['voice', 'voice_id'];

/**
 * Возможные ключи жанра у music-моделей.
 *
 * `grom-zvuk` объявляет `tags` (строка), часть моделей — `genre`.
 */
export const GENRE_PARAM_KEYS: readonly string[] = ['genre', 'tags'];

/** Параметр скорости речи (TTS); объявлен не у всех моделей. */
export const SPEED_PARAM_KEY = 'speed';

/**
 * Предпочтительные ключи слота изображения для image-to-video.
 *
 * Порядок — от самого точного смысла: кадр-первый (`first_frame`) → просто
 * картинка (`image`) → референс (`reference_image`). У модели может быть
 * объявлено несколько слотов — берём первый подходящий из списка, иначе
 * первый слот с `kind: 'image'`.
 */
export const PREFERRED_IMAGE_INPUT_KEYS: readonly string[] = [
  'first_frame',
  'image',
  'reference_image',
  'keyframes',
];

/**
 * Проверяет, является ли тип узла типом media-генерации R7.2.
 *
 * @param value - значение из `node.type` (внешние данные, RULES 1.17)
 * @returns `true`, если это `video_generation`/`audio_generation`/`music_generation`
 */
export function isGenerationNodeKind(value: string): value is GenerationNodeKind {
  return (GENERATION_NODE_KINDS as readonly string[]).includes(value);
}

/**
 * Проверяет, объявляет ли модель голосовой параметр (то есть умеет TTS).
 *
 * Нужно фолбэку аудио-узла: каталог CreativeLab не отдаёт `type=AUDIO`, а
 * TTS-модель `tts2` лежит в `type=MUSIC`.
 *
 * @param model - модель из каталога media
 * @returns `true`, если среди параметров есть `voice`/`voice_id`
 */
export function isTtsModel(model: MediaModelInfo): boolean {
  return model.params.some((param) => VOICE_PARAM_KEYS.includes(param.key));
}

/**
 * Отбирает модели для селекта узла аудио-генерации.
 *
 * Порядок: сначала `type=AUDIO` (если upstream его размечет), затем —
 * TTS-модели из `type=MUSIC` (реальность каталога CreativeLab, см. шапку
 * файла). Дубликаты по id не повторяются.
 *
 * @param audioModels - модели `type=AUDIO`
 * @param musicModels - модели `type=MUSIC` (фолбэк TTS)
 * @returns список моделей для селекта (пустой — TTS-моделей не нашлось)
 */
export function pickAudioModels(
  audioModels: readonly MediaModelInfo[],
  musicModels: readonly MediaModelInfo[],
): readonly MediaModelInfo[] {
  const merged: MediaModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of [...audioModels, ...musicModels]) {
    // AUDIO-модели берём все, из MUSIC — только TTS (иначе в селект озвучки
    // попали бы генераторы музыки).
    if (seen.has(model.id) || (model.type !== 'AUDIO' && !isTtsModel(model))) {
      continue;
    }

    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

/**
 * Выбирает модель по умолчанию для узла media-генерации.
 *
 * Порядок: известные id из {@link PREFERRED_GENERATION_MODEL_IDS} → первая
 * модель **без обязательных входных файлов** (text-to-video/audio/music, а не
 * инструмент) → просто первая. Пустая строка означает «каталог пуст»: узел
 * без модели честно падает понятной ошибкой, а не подставляет случайную
 * (принцип KI-069).
 *
 * @param models - модели каталога (уже отфильтрованные по типу)
 * @param type - тип media-модели (`VIDEO`/`AUDIO`/`MUSIC`)
 * @returns id модели по умолчанию либо `''`
 */
export function pickDefaultGenerationModel(
  models: readonly MediaModelInfo[],
  type: MediaType,
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
 * Выбирает ключ входного слота для картинки (image-to-video).
 *
 * @param model - модель из каталога
 * @returns ключ слота либо `null`, если модель не принимает изображений
 */
export function pickImageInputKey(model: MediaModelInfo): string | null {
  for (const key of PREFERRED_IMAGE_INPUT_KEYS) {
    if (model.inputs.some((input) => input.key === key && input.kind === 'image')) {
      return key;
    }
  }

  const anyImage = model.inputs.find((input) => input.kind === 'image');

  return anyImage?.key ?? null;
}
