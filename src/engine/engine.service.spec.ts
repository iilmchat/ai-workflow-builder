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

    it('не предупреждает об изолированности узлов-аннотаций (KI-266)', () => {
      const result = service.validateGraphAsync({
        nodes: [node('A'), node('B'), node('STICKER', 'comment')],
        edges: [edge('A', 'B')],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      // Единственный узел без связей — стикер, а для аннотации это норма:
      // портов у неё нет, поэтому предупреждать не о чем.
      expect(result.warnings).toEqual([]);
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
        nodes: [node('A', 'text'), node('B')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'payload',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.A).toEqual({ inputs: {}, dependents: ['B'] });
      expect(plan.executionMap.B).toEqual({
        inputs: {
          // KI-030: id хендла React Flow переводится в имя порта в outputs.
          payload: { fromNode: 'A', fromPort: 'text' },
        },
        dependents: [],
      });
    });

    it('использует edge.id как ключ и output как порт по умолчанию', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B')],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      // KI-003: без targetHandle ключом становится edge.id, а не 'input'.
      expect(plan.executionMap.B.inputs).toEqual({
        'A->B': { fromNode: 'A', fromPort: 'output' },
      });
    });

    it('не теряет входы при нескольких связях без targetHandle (KI-003)', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'C', 'e1'), edge('B', 'C', 'e2')],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.C.inputs).toEqual({
        e1: { fromNode: 'A', fromPort: 'output' },
        e2: { fromNode: 'B', fromPort: 'output' },
      });
    });

    it('выбирает ключ inputs по приоритету targetHandle → sourceHandle → edge.id', async () => {
      const graph: GraphDto = {
        nodes: [node('A'), node('B'), node('C')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'C',
            sourceHandle: 'out',
            targetHandle: 'in',
          },
          { id: 'e2', source: 'B', target: 'C', sourceHandle: 'out' },
          edge('A', 'C', 'e3'),
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.C.inputs).toEqual({
        // Ключи проверяются здесь; порты: 'out' — не id хендла, поэтому для
        // узлов без контракта ('task') берётся fallback 'output' (KI-030).
        in: { fromNode: 'A', fromPort: 'output' },
        out: { fromNode: 'B', fromPort: 'output' },
        e3: { fromNode: 'A', fromPort: 'output' },
      });
    });

    it('выводит порт источника из типа узла, если sourceHandle не задан (KI-022)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'llm')],
        edges: [{ id: 'e1', source: 'A', target: 'B', targetHandle: 'prompt' }],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        prompt: { fromNode: 'A', fromPort: 'text' },
      });
    });

    it('выводит порт url для источника типа image_generation (KI-022)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'image_generation'), node('B', 'text')],
        edges: [{ id: 'e1', source: 'A', target: 'B', targetHandle: 'in' }],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        // KI-034: ключ — имя входного порта text-узла, а не targetHandle.
        text: { fromNode: 'A', fromPort: 'url' },
      });
    });

    it('неизвестный sourceHandle не проходит насквозь: порт берётся из типа узла (KI-030)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'llm')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'custom',
            targetHandle: 'in',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      // Контракт KI-030: насквозь проходят только известные id хендлов React
      // Flow; всё остальное разрешается через тип узла-источника.
      expect(plan.executionMap.B.inputs).toEqual({
        // KI-034: ключ входа llm-узла нормализован в 'prompt'.
        prompt: { fromNode: 'A', fromPort: 'text' },
      });
    });

    it('переводит id хендла text-output в порт text (KI-030)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'llm')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        prompt: { fromNode: 'A', fromPort: 'text' },
      });
    });

    it('переводит id хендла image-output в порт url (KI-030)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'image_generation'), node('B', 'llm')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'image-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        prompt: { fromNode: 'A', fromPort: 'url' },
      });
    });

    it('для неизвестного хендла падает на дефолт по типу узла (KI-030)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'llm'), node('B', 'text')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'unknown-handle',
            targetHandle: 'in',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        text: { fromNode: 'A', fromPort: 'text' },
      });
    });

    it('игнорирует чужой хендл и берёт порт по типу источника (KI-301)', async () => {
      // `image_generation` не отдаёт порт `text`/`text-output`: хендл чужой,
      // поэтому резолвер возвращает null, а порт берётся из типа источника —
      // `url`. До KI-301 здесь был `fromPort='text'` и данные терялись.
      const graph: GraphDto = {
        nodes: [node('A', 'image_generation'), node('B', 'llm')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        prompt: { fromNode: 'A', fromPort: 'url' },
      });
    });

    it('разрешает порты всего UI-графа text→llm→image_generation (KI-030)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'llm'), node('C', 'image_generation')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
          {
            id: 'e2',
            source: 'B',
            target: 'C',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        prompt: { fromNode: 'A', fromPort: 'text' },
      });
      expect(plan.executionMap.C.inputs).toEqual({
        prompt: { fromNode: 'B', fromPort: 'text' },
      });
    });

    it('нормализует ключ входа llm-узла в prompt, а не UI-id (KI-034)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'llm')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(Object.keys(plan.executionMap.B.inputs)).toEqual(['prompt']);
      expect(plan.executionMap.B.inputs.prompt).toEqual({
        fromNode: 'A',
        fromPort: 'text',
      });
    });

    it('нормализует ключ входа text-узла в text (KI-034)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'llm'), node('B', 'text')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(Object.keys(plan.executionMap.B.inputs)).toEqual(['text']);
    });

    it('для неизвестного типа узла-получателя оставляет targetHandle как ключ (KI-034)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'merge')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'B',
            sourceHandle: 'text-output',
            targetHandle: 'left-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      // Контракта для 'merge' нет — работает fallback KI-003.
      expect(Object.keys(plan.executionMap.B.inputs)).toEqual(['left-input']);
    });

    it('сворачивает несколько входов одного узла в один нормализованный порт (KI-034)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'text'), node('C', 'llm')],
        edges: [
          {
            id: 'e1',
            source: 'A',
            target: 'C',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
          {
            id: 'e2',
            source: 'B',
            target: 'C',
            sourceHandle: 'text-output',
            targetHandle: 'text-input',
          },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      // Ограничение контракта R3: у llm-узла один входной порт 'prompt',
      // поэтому multi-input (merge/condition) потребует per-handle контракта
      // в R4 — сейчас обе связи пишут в один ключ и вторая перекрывает первую.
      expect(Object.keys(plan.executionMap.C.inputs)).toEqual(['prompt']);
      expect(plan.executionMap.C.inputs.prompt).toEqual({
        fromNode: 'B',
        fromPort: 'text',
      });
    });

    it('оставляет output как fallback для неизвестного типа узла (KI-022)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'merge'), node('B', 'llm')],
        edges: [{ id: 'e1', source: 'A', target: 'B', targetHandle: 'in' }],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(plan.executionMap.B.inputs).toEqual({
        prompt: { fromNode: 'A', fromPort: 'output' },
      });
    });

    it('inferInputPortName: text/llm/image_generation', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'text'), node('C', 'image_generation')],
        edges: [
          { id: 'e1', source: 'A', target: 'B', targetHandle: 'text-input' },
          { id: 'e2', source: 'B', target: 'C', targetHandle: 'text-input' },
        ],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      expect(Object.keys(plan.executionMap.B.inputs)).toEqual(['text']);
      expect(Object.keys(plan.executionMap.C.inputs)).toEqual(['prompt']);
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
        // Ключи — targetHandle; порты не являются id хендлов, поэтому по
        // контракту KI-030 берётся fallback для неизвестного типа узла.
        leftInput: { fromNode: 'A', fromPort: 'output' },
        rightInput: { fromNode: 'B', fromPort: 'output' },
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

    it('исключает аннотации из плана выполнения (KI-266)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('B', 'llm'), node('NOTE', 'comment')],
        edges: [edge('A', 'B')],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      // Стикера нет ни в порядке, ни в уровнях, ни в карте выполнения:
      // `node_runs` для аннотаций не создаются.
      expect(plan.order).toEqual(['A', 'B']);
      expect(plan.levels).toEqual([['A'], ['B']]);
      expect(Object.keys(plan.executionMap)).toEqual(['A', 'B']);
    });

    it('игнорирует связи с аннотациями при построении уровней (KI-266)', async () => {
      const graph: GraphDto = {
        nodes: [node('A', 'text'), node('NOTE', 'comment')],
        edges: [edge('NOTE', 'A')],
      };

      const plan = await service.buildExecutionPlanAsync(graph);

      // Связь от стикера не создаёт вход у A и не добавляет уровень:
      // у аннотации нет портов, поэтому такая связь просто не существует
      // для планировщика (и не делает граф невалидным).
      expect(plan.order).toEqual(['A']);
      expect(plan.levels).toEqual([['A']]);
      expect(plan.executionMap.A.inputs).toEqual({});
    });

    it('бросает BadRequestException, если в графе только аннотации (KI-266)', async () => {
      const graph: GraphDto = {
        nodes: [node('N1', 'comment'), node('N2', 'comment')],
        edges: [],
      };

      await expect(service.buildExecutionPlanAsync(graph)).rejects.toThrow(
        'Граф содержит только аннотации, нечего выполнять',
      );
    });

    it('на пустом графе возвращает пустой план, а не ошибку аннотаций (KI-266)', async () => {
      // Пустой граф — не «граф из одних стикеров»: запуск «ничего» остаётся
      // успешным (см. `завершает пустой граф без строк node_runs` в
      // `execution-engine.service.spec.ts`).
      const plan = await service.buildExecutionPlanAsync({ nodes: [], edges: [] });

      expect(plan).toEqual({ order: [], levels: [], executionMap: {} });
    });
  });
});
