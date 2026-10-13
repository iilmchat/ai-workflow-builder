import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MediaController } from './media.controller.js';
import { MediaRegistryService } from './media-registry.service.js';
import {
  MediaProviderException,
  type MediaModelInfo,
} from './media-provider.interface.js';

/** Модель, которую «возвращает» заглушка реестра. */
const model: MediaModelInfo = {
  id: 'flux-schnell',
  code: 'flux-schnell',
  type: 'IMAGE',
  price: 0.6,
  priceUnit: 'per_generation',
  moderation: 'auto',
  prompt: 'required',
  params: [
    {
      key: 'aspect_ratio',
      type: 'enum',
      label: 'wfc_aspect',
      default: '1:1',
      options: [{ value: '1:1', label: 'wfc_opt_square' }],
    },
  ],
  inputs: [],
  deprecated: false,
};

describe('MediaController', () => {
  let app: INestApplication;
  let controller: MediaController;
  let registry: { listModelsAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    registry = {
      listModelsAsync: vi.fn(() => Promise.resolve([model])),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [{ provide: MediaRegistryService, useValue: registry }],
    }).compile();

    controller = moduleRef.get(MediaController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /media/models?type=IMAGE отвечает 200 и списком моделей', async () => {
    const response = await request(app.getHttpServer())
      .get('/media/models?type=IMAGE')
      .expect(200);

    expect(registry.listModelsAsync).toHaveBeenCalledWith('IMAGE');
    expect(response.body).toEqual({ models: [model] });

    // Поля отдаются в camelCase (RULES 4.23).
    expect(response.body.models[0].priceUnit).toBe('per_generation');
    expect(response.body.models[0].price_unit).toBeUndefined();
  });

  it('GET /media/models без type запрашивает все типы', async () => {
    await request(app.getHttpServer()).get('/media/models').expect(200);

    expect(registry.listModelsAsync).toHaveBeenCalledWith(undefined);
  });

  it('GET /media/models?type=FOO отвечает 400 и не дёргает реестр', async () => {
    await request(app.getHttpServer()).get('/media/models?type=FOO').expect(400);

    expect(registry.listModelsAsync).not.toHaveBeenCalled();
  });

  it('делегирует в реестр и возвращает его результат', async () => {
    await expect(controller.listModelsAsync({ type: 'IMAGE' })).resolves.toEqual({
      models: [model],
    });
  });

  it('отдаёт пустой список, если реестр ничего не вернул', async () => {
    registry.listModelsAsync.mockResolvedValue([]);

    const response = await request(app.getHttpServer())
      .get('/media/models?type=VIDEO')
      .expect(200);

    expect(response.body).toEqual({ models: [] });
  });

  it('переводит ошибку upstream в 502, если повтор не поможет', async () => {
    registry.listModelsAsync.mockRejectedValue(
      new MediaProviderException('creativelab', 'media API ответил 401'),
    );

    const response = await request(app.getHttpServer())
      .get('/media/models?type=IMAGE')
      .expect(502);

    // В теле — причина, иначе клиент не отличит неверный ключ от падения.
    expect(response.body.message).toBe('[creativelab] media API ответил 401');
  });

  it('переводит временную ошибку upstream в 503', async () => {
    registry.listModelsAsync.mockRejectedValue(
      new MediaProviderException('creativelab', 'media API ответил 503', {
        retryable: true,
      }),
    );

    await request(app.getHttpServer())
      .get('/media/models?type=IMAGE')
      .expect(503);
  });

  it('не подменяет чужие ошибки: неизвестное исключение уходит выше', async () => {
    registry.listModelsAsync.mockRejectedValue(new Error('программная ошибка'));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(controller.listModelsAsync({ type: 'IMAGE' })).rejects.toThrow(
      'программная ошибка',
    );
  });
});
