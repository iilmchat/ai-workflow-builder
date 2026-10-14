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
 * модель работает по изображению/аудио, а не по текстовому промпту.
 *
 * @param model - модель из каталога
 * @returns `true`, если есть хотя бы один обязательный вход
 */
function requiresInputFiles(model: MediaModelInfo): boolean {
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
