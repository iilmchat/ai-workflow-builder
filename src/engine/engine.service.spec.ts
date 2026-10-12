import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EdgeDto, GraphDto, NodeDto } from './dto/index.js';
import { EngineService } from './engine.service.js';

/** Создаёт узел графа с минимально необходимыми полями. */
function node(id: string, type = 'task'): NodeDto {
  return { id, type, data: {} };
}

/** Создаёт связь графа. */
function edge(source: string, target: string, id = `${source}->${target}`): EdgeDto {
  return { id, source, target };
}

/**
 * Линейный граф: A → B → C.
 */
function linearGraph(): GraphDto {
  return {
    nodes: [node('A'), node('B'), node('C')],
    edges: [edge('A', 'B'), edge('B', 'C')],
  };
}

/**
 * Diamond: A → B, A → C, B → D, C → D.
 */
function diamondGraph(): GraphDto {
  return {
    nodes: [node('A'), node('B'), node('C'), node('D')],
    edges: [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')],
  };
}

describe('EngineService', () => {
  let service: EngineService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EngineService],
    }).compile();

    service = moduleRef.get(EngineService);
  });

  describe('validateGraphAsync', () => {
    it('считает пустой граф невалидным', () => {
      const result = service.validateGraphAsync({ nodes: [], edges: [] });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Граф не содержит узлов');
    });

    it('находит дублирующиеся id узлов', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('A')],
        edges: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('Дублирующийся id узла: A'))).toBe(
        true,
      );
    });

    it('находит узел с пустым id', () => {
      const result = service.validateGraphAsync({
        nodes: [node(''), node('A')],
        edges: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('пустым id'))).toBe(true);
    });

    it('находит связи на несуществующие узлы', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('A', 'GHOST'), edge('NOPE', 'B')],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('несуществующий target: GHOST'))).toBe(
        true,
      );
      expect(result.errors.some((error) => error.includes('несуществующий source: NOPE'))).toBe(
        true,
      );
    });

    it('находит self-loop', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'A'), edge('A', 'B')],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('self-loop'))).toBe(true);
    });

    it('возвращает warning об изолированных узлах, не делая граф невалидным', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('B'), node('LOST')],
        edges: [edge('A', 'B')],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((warning) => warning.includes('LOST') && warning.includes('изолирован'))).toBe(
        true,
      );
    });

    it('возвращает warning о пустом типе узла', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A', ''), node('B')],
        edges: [edge('A', 'B')],
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.some((warning) => warning.includes('не имеет типа'))).toBe(true);
    });

    it('считает валидным линейный граф', () => {
      const result = service.validateGraphAsync(linearGraph());

      expect(result).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('считает валидным diamond-граф', () => {
      const result = service.validateGraphAsync(diamondGraph());

      expect(result).toEqual({ valid: true, errors: [], warnings: [] });
    });

    it('находит цикл и возвращает valid=false с описанием цикла', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('цикл'))).toBe(true);
    });

    it('собирает все ошибки сразу, не прерываясь на первой', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('A')],
        edges: [edge('A', 'A'), edge('A', 'GHOST')],
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('topologicalSortAsync', () => {
    it('сортирует линейный граф как A → B → C', async () => {
      await expect(service.topologicalSortAsync(linearGraph())).resolves.toEqual([
        'A',
        'B',
        'C',
      ]);
    });

    it('ставит корень diamond первым, а сток — последним', async () => {
      const order = await service.topologicalSortAsync(diamondGraph());

      expect(order).toHaveLength(4);
      expect(order[0]).toBe('A');
      expect(order[order.length - 1]).toBe('D');
      expect(order.slice(1, 3).sort()).toEqual(['B', 'C']);
    });

    it('возвращает параллельные ветки после их общего предка', async () => {
      const order = await service.topologicalSortAsync({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('A', 'C')],
      });

      expect(order[0]).toBe('A');
      expect(order.slice(1).sort()).toEqual(['B', 'C']);
    });

    it('бросает BadRequestException при цикле', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('B', 'A')],
      };

      await expect(service.topologicalSortAsync(graph)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('возвращает пустой массив для пустого графа', async () => {
      await expect(
        service.topologicalSortAsync({ nodes: [], edges: [] }),
      ).resolves.toEqual([]);
    });

    it('не теряет узлы, на которые ссылается только битая связь', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('GHOST')],
        edges: [edge('A', 'GHOST')],
      };

      await expect(service.topologicalSortAsync(graph)).resolves.toEqual([
        'A',
        'GHOST',
      ]);
    });

    it('бросает BadRequestException при связи на несуществующий узел', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('A', 'MISSING')],
      };

      await expect(service.topologicalSortAsync(graph)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('buildExecutionPlanAsync', () => {
    it('строит три уровня для линейного графа', async () => {
      const plan = await service.buildExecutionPlanAsync(linearGraph());

      expect(plan.levels).toEqual([['A'], ['B'], ['C']]);
      expect(plan.order).toEqual(['A', 'B', 'C']);
    });

    it('строит три уровня для diamond с параллельным средним уровнем', async () => {
      const plan = await service.buildExecutionPlanAsync(diamondGraph());

      expect(plan.levels).toHaveLength(3);
      expect(plan.levels[0]).toEqual(['A']);
      expect([...plan.levels[1]].sort()).toEqual(['B', 'C']);
      expect(plan.levels[2]).toEqual(['D']);
      expect(plan.order).toEqual(['A', 'B', 'C', 'D']);
    });

    it('помещает два независимых корня в нулевой уровень', async () => {
      const plan = await service.buildExecutionPlanAsync({
        nodes: [node('A'), node('B')],
        edges: [],
      });

      expect(plan.levels).toHaveLength(1);
      expect([...plan.levels[0]].sort()).toEqual(['A', 'B']);
    });

    it('строит inputs и dependents в executionMap', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'result',
            targetHandle: 'payload',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.A).toEqual({ inputs: {}, dependents: ['B'] });
      expect(plan.executionMap.B).toEqual({
        inputs: {
          payload: { fromNode: 'A', fromPort: 'result' },
        },
        dependents: [],
      });
    });

    it('использует порты input/output по умолчанию', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B')],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        input: { fromNode: 'A', fromPort: 'output' },
      });
    });

    it('собирает dependents узлов diamond', async () => {
      const plan = await service.buildExecutionPlanAsync(diamondGraph());

      expect(plan.executionMap.A.dependents.sort()).toEqual(['B', 'C']);
      expect(plan.executionMap.D.dependents).toEqual([]);
      expect(plan.executionMap.B.dependents).toEqual(['D']);
      expect(plan.executionMap.C.dependents).toEqual(['D']);
    });

    it('раскладывает несколько входов одного узла по targetHandle', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B'), node('C')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'C',
            sourceHandle: 'left',
            targetHandle: 'leftInput',
          },
          {
            id: 'e2',
            source: 'B',
            target: 'C',
            sourceHandle: 'right',
            targetHandle: 'rightInput',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.C.inputs).toEqual({
        leftInput: { fromNode: 'A', fromPort: 'left' },
        rightInput: { fromNode: 'B', fromPort: 'right' },
      });
    });

    it('бросает BadRequestException при цикле', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B'), edge('B', 'A')],
      };

      await expect(service.buildExecutionPlanAsync(graph)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
