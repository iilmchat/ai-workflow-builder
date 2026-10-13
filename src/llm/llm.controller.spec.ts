import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LlmController } from './llm.controller.js';
import { LlmRegistryService } from './llm-registry.service.js';

describe('LlmController', () => {
  let app: INestApplication;
  let controller: LlmController;
  let registry: { listModels: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    registry = {
      listModels: vi.fn(() => [
        {
          provider: 'anthropic',
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
        },
        { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o' },
      ]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [{ provide: LlmRegistryService, useValue: registry }],
    }).compile();

    controller = moduleRef.get(LlmController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /llm/models отвечает 200 и отдаёт модели сконфигурированных провайдеров', async () => {
    const response = await request(app.getHttpServer()).get('/llm/models').expect(200);

    expect(registry.listModels).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual([
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
      },
      { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o' },
    ]);
  });

  it('GET /llm/models отдаёт пустой массив, если провайдеры не настроены (KI-039)', async () => {
    registry.listModels.mockReturnValue([]);

    const response = await request(app.getHttpServer()).get('/llm/models').expect(200);

    expect(response.body).toEqual([]);
  });

  it('делегирует список реестру', () => {
    expect(controller.listModels()).toHaveLength(2);
    expect(registry.listModels).toHaveBeenCalledTimes(1);
  });
});
