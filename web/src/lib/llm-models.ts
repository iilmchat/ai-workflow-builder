import type { LlmModelInfo, ModelModality } from '@/lib/api';

/** Группа моделей для `<optgroup>` в селекте LLM-узла. */
export interface LlmModelGroup {
  /** Подпись группы (`<optgroup label>`). */
  label: string;
  /** Модели группы в порядке отображения. */
  models: LlmModelInfo[];
}

/** Подписи групп селекта LLM-узла. */
const GROUP_LABELS = {
  text: 'Текст',
  vision: 'Текст + Vision',
  other: 'Другое',
} as const;

/**
 * Фильтрует модели по требуемой модальности на выходе.
 *
 * @param models - полный список моделей с backend
 * @param output - модальность, которая обязана быть в `outputModalities`
 * @returns модели, отдающие указанную модальность (порядок сохраняется)
 */
export function filterModelsByOutput(
  models: LlmModelInfo[],
  output: ModelModality,
): LlmModelInfo[] {
  return models.filter((model) => model.outputModalities.includes(output));
}

/**
 * Фильтрует модели по требуемой модальности на входе.
 *
 * @param models - полный список моделей с backend
 * @param input - модальность, которая обязана быть в `inputModalities`
 * @returns модели, принимающие указанную модальность (порядок сохраняется)
 */
export function filterModelsByInput(
  models: LlmModelInfo[],
  input: ModelModality,
): LlmModelInfo[] {
  return models.filter((model) => model.inputModalities.includes(input));
}

/**
 * Сортирует модели по провайдеру, затем по подписи.
 *
 * Локаль `ru` нужна, чтобы «Claude» и «Qwen» шли ожидаемым образом; сравнение
 * по `provider` первично, иначе модели одного провайдера разъезжались бы по
 * группам вперемешку.
 *
 * @param models - модели для сортировки
 * @returns новый отсортированный массив
 */
function sortModels(models: LlmModelInfo[]): LlmModelInfo[] {
  return [...models].sort((left, right) => {
    const byProvider = left.provider.localeCompare(right.provider, 'ru');

    return byProvider !== 0
      ? byProvider
      : left.label.localeCompare(right.label, 'ru');
  });
}

/**
 * Группирует модели для селекта LLM-узла.
 *
 * Группы: «Текст» (вход только текст), «Текст + Vision» (вход включает
 * картинки) и «Другое» (всё остальное, например модели без текстового входа —
 * они в LLM-узле бесполезны, но не должны исчезать молча). Пустые группы в
 * результат не попадают.
 *
 * @param models - полный список моделей с backend
 * @returns группы в порядке отображения
 */
export function groupLlmModelsForSelect(
  models: LlmModelInfo[],
): LlmModelGroup[] {
  const textOnly: LlmModelInfo[] = [];
  const vision: LlmModelInfo[] = [];
  const other: LlmModelInfo[] = [];

  for (const model of models) {
    if (!model.inputModalities.includes('text')) {
      other.push(model);
      continue;
    }

    if (model.inputModalities.includes('vision')) {
      vision.push(model);
      continue;
    }

    textOnly.push(model);
  }

  const groups: LlmModelGroup[] = [
    { label: GROUP_LABELS.text, models: sortModels(textOnly) },
    { label: GROUP_LABELS.vision, models: sortModels(vision) },
    { label: GROUP_LABELS.other, models: sortModels(other) },
  ];

  return groups.filter((group) => group.models.length > 0);
}
