import type { MediaModelInfo } from '../types/media';

/**
 * Приоритетные модели для нового узла генерации изображений.
 *
 * Порядок — «сначала самые предсказуемые для text-to-image»: быстрый Flux,
 * затем более дорогие Flux/DALL·E и мультимодальные Gemini/Nano Banana.
 */
const PREFERRED_IMAGE_MODEL_IDS: readonly string[] = [
  'flux-schnell',
  'flux-dev',
  'dall-e-3',
  'nano-banana',
  'gemini-image',
];

/**
 * Приоритетные модели-инструменты для узла `image_tool` (R7.1).
 *
 * Порядок — от самых дешёвых и быстрых операций: удаление фона (10 ₽) перед
 * липсинком (дороже и требует видео + аудио). Значения — id из реального
 * каталога CreativeLab, где инструмент объявлен обычной моделью с обязательным
 * входным слотом.
 */
const PREFERRED_TOOL_MODEL_IDS: readonly string[] = [
  'bgremover',
  'faceswap',
  'kling-lipsync',
];

/**
 * Наборы моделей-инструментов для селекта узла `image_tool` (R7.1).
 */
export interface ToolModelCatalog {
  /**
   * Модели с `type: 'TOOL'` (`GET /media/models?type=TOOL`).
   *
   * Основной источник по DESIGN v0.9 § 3.1.
   */
  toolModels: readonly MediaModelInfo[];
  /**
   * Модели других типов с обязательным входным файлом — фолбэк.
   *
   * Нужен потому, что на момент R7.1 каталог CreativeLab **не отдаёт**
   * `type: 'TOOL'`: инструменты (удаление фона, липсинк, замена лиц) приходят
   * как `IMAGE`/`VIDEO` с обязательным слотом `inputs`. Без фолбэка селект был
   * бы пустым и узел нельзя было бы запустить вовсе.
   */
  fallbackModels: readonly MediaModelInfo[];
}

/**
 * Отбирает модели для селекта узла `image_tool` (R7.1).
 *
 * Порядок: сначала TOOL-модели (если upstream их размечен), затем — модели с
 * обязательным входным файлом. Дубликаты по id не повторяются.
 *
 * @param catalog - модели, загруженные из каталога media
 * @returns список моделей для селекта (пустой — инструментов не нашлось)
 */
export function pickToolModels(
  catalog: ToolModelCatalog,
): readonly MediaModelInfo[] {
  const merged: MediaModelInfo[] = [];
  const seen = new Set<string>();

  for (const model of [...catalog.toolModels, ...catalog.fallbackModels]) {
    if (seen.has(model.id) || !requiresInputFiles(model)) {
      continue;
    }

    seen.add(model.id);
    merged.push(model);
  }

  return merged;
}

/**
 * Выбирает модель по умолчанию для нового узла `image_tool` (R7.1).
 *
 * @param models - модели из {@link pickToolModels}
 * @param operation - операция узла (удаление фона, апскейл, ...)
 * @returns id модели либо `''` — «пользователь выберет сам» (молчаливой
 *   подмены нет, KI-069)
 */
export function pickDefaultToolModel(
  models: readonly MediaModelInfo[],
  operation: string,
): string {
  // Дефолты операций повторяют backend `DEFAULT_IMAGE_TOOL_MODELS`: узел
  // создаётся уже запускаемым там, где upstream-модель известна.
  const preferredByOperation: Record<string, string> = {
    bg_removal: 'bgremover',
    lipsync: 'kling-lipsync',
  };
  const preferred = preferredByOperation[operation];

  if (preferred !== undefined && models.some((model) => model.id === preferred)) {
    return preferred;
  }

  for (const id of PREFERRED_TOOL_MODEL_IDS) {
    if (models.some((model) => model.id === id)) {
      return id;
    }
  }

  return models[0]?.id ?? '';
}

/**
 * Выбирает модель по умолчанию для нового узла Image Generation (KI-154).
 *
 * Каталог CreativeLab приходит в алфавитном порядке, поэтому «первая модель»
 * (`bgremover`) — это image-to-image: она требует входного файла, и Run падал
 * с upstream-ошибкой `Invalid input`. Поэтому выбираем модель, пригодную для
 * генерации по текстовому промпту:
 *
 * 1. сначала — известные text-to-image id из {@link PREFERRED_IMAGE_MODEL_IDS};
 * 2. иначе — первая модель с `prompt: 'required'` и без обязательных входов;
 * 3. если подходящей нет — пустая строка: модель выберет пользователь, и
 *    запуск заблокируется валидацией, а не упадёт на сервере.
 *
 * @param models - каталог media-моделей (может быть пустым)
 * @returns id модели по умолчанию либо `''`, если выбирать не из чего
 */
export function pickDefaultMediaModel(
  models: readonly MediaModelInfo[],
): string {
  // 1. Известные text-to-image модели — в порядке приоритета.
  for (const preferredId of PREFERRED_IMAGE_MODEL_IDS) {
    const match = models.find((model) => model.id === preferredId);

    if (match) {
      return match.id;
    }
  }

  // 2. Любая модель, которой для генерации достаточно одного промпта.
  const promptOnly = models.find(
    (model) => model.prompt === 'required' && !requiresInputFiles(model),
  );

  return promptOnly?.id ?? '';
}

/**
 * Проверяет, нужны ли модели входные файлы.
 *
 * `inputs` в каталоге — слоты входных файлов; обязательный слот означает, что
 * модель работает по изображению/видео/аудио (инструмент), а не по текстовому
 * промпту.
 *
 * @param model - модель из каталога
 * @returns `true`, если есть хотя бы один обязательный вход
 */
export function requiresInputFiles(model: MediaModelInfo): boolean {
  return model.inputs.some((input) => isRequiredInput(input));
}

/**
 * Определяет, помечен ли слот входа как обязательный.
 *
 * @param input - элемент `inputs` из каталога (форма не типизирована)
 * @returns `true`, если у слота `required === true`
 */
function isRequiredInput(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    'required' in input &&
    (input as { required?: unknown }).required === true
  );
}
