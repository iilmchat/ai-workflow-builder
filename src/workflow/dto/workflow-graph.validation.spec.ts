import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CreateWorkflowSchema } from './create-workflow.dto.js';
import { UpdateWorkflowSchema } from './update-workflow.dto.js';

/** Валидный узел с UI-полями React Flow, которые нельзя потерять. */
const node = (id: string) => ({
  id,
  type: 'llm',
  position: { x: 0, y: 0 },
  data: { prompt: 'hello' },
  selected: true,
  measured: { width: 120, height: 48 },
});

/** Валидная связь между двумя узлами. */
const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
});

describe('CreateWorkflowSchema: форма графа (KI-017)', () => {
  it('принимает корректный граф и сохраняет UI-поля узлов', () => {
    const result = CreateWorkflowSchema.safeParse({
      name: 'Graph',
      nodes: [node('n1'), node('n2')],
      edges: [edge('e1', 'n1', 'n2')],
    });

    expect(result.success).toBe(true);

    if (!result.success) {
      throw new Error('ожидался успешный парсинг');
    }

    // loose-схема не должна вырезать `selected`/`measured`: иначе сохранение
    // графа из UI теряло бы служебные поля React Flow.
    expect(result.data.nodes[0]).toMatchObject({
      id: 'n1',
      selected: true,
      measured: { width: 120, height: 48 },
    });
  });

  it('отклоняет дубликат node.id', () => {
    const result = CreateWorkflowSchema.safeParse({
      name: 'Graph',
      nodes: [node('n1'), node('n1')],
      edges: [],
    });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('ожидалась ошибка дубликата');
    }

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      'Дубликат id узла: n1',
    );
  });

  it('отклоняет связь на несуществующий source', () => {
    const result = CreateWorkflowSchema.safeParse({
      name: 'Graph',
      nodes: [node('n1')],
      edges: [edge('e1', 'missing', 'n1')],
    });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('ожидалась ошибка ссылки');
    }

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      'Связь #0 ссылается на несуществующий узел: missing',
    );
  });

  it('отклоняет связь на несуществующий target', () => {
    const result = CreateWorkflowSchema.safeParse({
      name: 'Graph',
      nodes: [node('n1')],
      edges: [edge('e1', 'n1', 'missing')],
    });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('ожидалась ошибка ссылки');
    }

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      'Связь #0 ссылается на несуществующий узел: missing',
    );
  });

  it('отклоняет узел без id и связь без source/target', () => {
    const result = CreateWorkflowSchema.safeParse({
      name: 'Graph',
      nodes: [{ type: 'llm' }],
      edges: [{ id: 'e1', target: 'n1' }],
    });

    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error('ожидалась ошибка формы');
    }

    const messages = result.error.issues.map((issue) => issue.message);

    expect(messages).toContain('Узел #0: id обязателен');
    expect(messages).toContain('Связь #0: source обязателен');
  });

  it('через ZodValidationPipe отдаёт 400 Bad Request', () => {
    const pipe = new ZodValidationPipe(CreateWorkflowSchema);

    expect(() =>
      pipe.transform({
        name: 'Graph',
        nodes: [node('n1')],
        edges: [edge('e1', 'n1', 'missing')],
      }),
    ).toThrow(BadRequestException);

    try {
      pipe.transform({
        name: 'Graph',
        nodes: [node('n1')],
        edges: [edge('e1', 'n1', 'missing')],
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });
});

describe('UpdateWorkflowSchema: форма графа (KI-017)', () => {
  it('проверяет ссылки, когда в PATCH переданы и nodes, и edges', () => {
    const result = UpdateWorkflowSchema.safeParse({
      nodes: [node('n1')],
      edges: [edge('e1', 'n1', 'missing')],
    });

    expect(result.success).toBe(false);
  });

  it('отклоняет дубликат node.id в частичном PATCH', () => {
    const result = UpdateWorkflowSchema.safeParse({
      nodes: [node('n1'), node('n1')],
    });

    expect(result.success).toBe(false);
  });

  it('принимает PATCH только с edges: ссылки проверит сервис по графу из БД', () => {
    // DTO не видит текущие узлы, поэтому форма связи проверяется, а ссылки —
    // в WorkflowService.updateAsync (см. workflow.service.spec.ts).
    const result = UpdateWorkflowSchema.safeParse({
      edges: [edge('e1', 'n1', 'n2')],
    });

    expect(result.success).toBe(true);
  });

  it('по-прежнему отклоняет пустой PATCH', () => {
    expect(UpdateWorkflowSchema.safeParse({}).success).toBe(false);
  });
});
