import { Test } from '@nestjs/testing';
import type { GraphDto } from './dto/index.js';
import { EngineController } from './engine.controller.js';
import { EngineService } from './engine.service.js';

const graph: GraphDto = {
  nodes: [
    { id: 'A', type: 'task', data: {} },
    { id: 'B', type: 'task', data: {} },
  ],
  edges: [{ id: 'A->B', source: 'A', target: 'B' }],
};

describe('EngineController', () => {
  let controller: EngineController;
  let service: {
    validateGraphAsync: ReturnType<typeof vi.fn>;
    topologicalSortAsync: ReturnType<typeof vi.fn>;
    buildExecutionPlanAsync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      validateGraphAsync: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
      topologicalSortAsync: vi.fn(() => Promise.resolve(['A', 'B'])),
      buildExecutionPlanAsync: vi.fn(() =>
        Promise.resolve({ order: ['A', 'B'], levels: [['A'], ['B']], executionMap: {} }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [EngineController],
      providers: [{ provide: EngineService, useValue: service }],
    }).compile();

    controller = moduleRef.get(EngineController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validate делегирует проверку сервису', () => {
    const result = controller.validate(graph);

    expect(service.validateGraphAsync).toHaveBeenCalledWith(graph);
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('sort оборачивает порядок в объект order', async () => {
    await expect(controller.sort(graph)).resolves.toEqual({ order: ['A', 'B'] });
    expect(service.topologicalSortAsync).toHaveBeenCalledWith(graph);
  });

  it('plan возвращает план выполнения сервиса', async () => {
    const plan = await controller.plan(graph);

    expect(service.buildExecutionPlanAsync).toHaveBeenCalledWith(graph);
    expect(plan.levels).toEqual([['A'], ['B']]);
  });
});
