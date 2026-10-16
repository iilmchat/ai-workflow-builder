import { describe, expect, it } from 'vitest';
import { parseExportedWorkflowFile } from './export-import-api';

/** Текст ошибки, который frontend показывает для невалидного файла. */
const INVALID = 'невалидный файл';

/** Минимальный валидный артефакт экспорта. */
const ARTIFACT = {
  version: 1,
  name: 'Text → LLM',
  nodes: [{ id: 't1', type: 'text', position: { x: 0, y: 0 } }],
  edges: [],
  exportedAt: '2026-10-16T00:00:00.000Z',
};

describe('parseExportedWorkflowFile', () => {
  it('разбирает валидный артефакт вместе с графом', () => {
    const artifact = parseExportedWorkflowFile(JSON.stringify(ARTIFACT), INVALID);

    expect(artifact.version).toBe(1);
    expect(artifact.name).toBe('Text → LLM');
    expect(artifact.nodes).toHaveLength(1);
    expect(artifact.edges).toHaveLength(0);
  });

  it('отбрасывает служебные поля, если они есть в файле', () => {
    const artifact = parseExportedWorkflowFile(
      JSON.stringify({ ...ARTIFACT, id: 'чужой-id', shareToken: 'capability' }),
      INVALID,
    );

    expect(artifact).not.toHaveProperty('shareToken');
    expect(artifact).not.toHaveProperty('id');
  });

  it('падает на не-JSON', () => {
    expect(() => parseExportedWorkflowFile('<html>', INVALID)).toThrow(INVALID);
  });

  it('падает на JSON другой формы (нет version/name)', () => {
    expect(() => parseExportedWorkflowFile('{"hello":"world"}', INVALID)).toThrow(
      INVALID,
    );
    expect(() => parseExportedWorkflowFile('[]', INVALID)).toThrow(INVALID);
  });

  it('падает на неизвестной версии формата', () => {
    expect(() =>
      parseExportedWorkflowFile(JSON.stringify({ ...ARTIFACT, version: 2 }), INVALID),
    ).toThrow(INVALID);
  });
});
