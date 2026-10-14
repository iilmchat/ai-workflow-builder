import { describe, expect, it } from 'vitest';
// Относительные пути: тестовый конфиг web не задаёт alias `@` (см. KI-155).
import { groupLlmModelsForSelect } from './llm-models';
import type { LlmModelInfo } from './api';

/**
 * Создаёт модель для проверки группировки.
 *
 * @param id - id модели
 * @param input - входные модальности
 * @param provider - идентификатор провайдера
 * @returns модель для селекта
 */
function model(
  id: string,
  input: LlmModelInfo['inputModalities'],
  provider = 'test',
): LlmModelInfo {
  return {
    provider,
    id,
    label: id,
    inputModalities: input,
    outputModalities: ['text'],
  };
}

describe('groupLlmModelsForSelect (KI-182)', () => {
  it('vision-модель попадает в группу «Текст + Vision», а не теряется', () => {
    const groups = groupLlmModelsForSelect([
      model('yandexgpt-lite', ['text']),
      model('qwen3.6-35b-a3b', ['text', 'vision']),
    ]);

    const labels = groups.map((group) => group.label);

    expect(labels).toContain('Текст + Vision');
    expect(
      groups.find((group) => group.label === 'Текст + Vision')?.models.map((m) => m.id),
    ).toEqual(['qwen3.6-35b-a3b']);
  });

  it('все модели с текстовым входом показываются (ничего не отсекается)', () => {
    const models = [
      model('a', ['text']),
      model('b', ['text', 'vision']),
      model('c', ['text', 'audio']),
    ];

    const shown = groupLlmModelsForSelect(models).flatMap((group) =>
      group.models.map((item) => item.id),
    );

    expect(shown.sort()).toEqual(['a', 'b', 'c']);
  });

  it('модель без текстового входа уходит в «Другое», а не исчезает', () => {
    const groups = groupLlmModelsForSelect([
      model('text-model', ['text']),
      model('image-only', ['vision']),
    ]);

    expect(
      groups.find((group) => group.label === 'Другое')?.models.map((m) => m.id),
    ).toEqual(['image-only']);
  });

  it('пустые группы не попадают в результат', () => {
    const groups = groupLlmModelsForSelect([model('only-text', ['text'])]);

    expect(groups.map((group) => group.label)).toEqual(['Текст']);
  });

  it('пустой список даёт пустой результат', () => {
    expect(groupLlmModelsForSelect([])).toEqual([]);
  });
});
