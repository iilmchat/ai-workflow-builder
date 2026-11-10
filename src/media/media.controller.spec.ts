import type { INestApplication } from '@nestjs/common';
import { BadRequestException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Response } from 'express';
import {
  SafeHttpClient,
  type SafeHttpBufferResponse,
} from '../common/http/safe-http.client.js';
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
  // KI-317: тариф за вход не задан — модель берёт плату за генерацию.
  priceInput: null,
  priceInputUnit: null,
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
  let safeHttp: { fetchBufferAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    registry = {
      listModelsAsync: vi.fn(() => Promise.resolve([model])),
    };
    safeHttp = { fetchBufferAsync: vi.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: MediaRegistryService, useValue: registry },
        { provide: SafeHttpClient, useValue: safeHttp },
      ],
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

  it('GET /media/download отдаёт Content-Disposition и тело файла (S8.2, KI-466)', async () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const upstream: SafeHttpBufferResponse = {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      buffer,
      contentType: 'image/png',
      finalUrl: 'https://cdn.example.com/path/cat.png',
    };
    safeHttp.fetchBufferAsync.mockResolvedValue(upstream);

    const response = await request(app.getHttpServer())
      .get('/media/download')
      .query({ url: 'https://cdn.example.com/path/cat.png' })
      .expect(200);

    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="cat.png"',
    );
    expect(response.headers['content-type']).toContain('image/png');
    expect(Buffer.from(response.body)).toEqual(buffer);
  });

  it('блокирует http://127.0.0.1 до сетевого вызова (SSRF)', async () => {
    // Настоящий клиент: литерал loopback блокируется до DNS/транспорта.
    const realClient = new SafeHttpClient();
    const realController = new MediaController(
      registry as unknown as MediaRegistryService,
      realClient,
    );
    const setHeader = vi.fn();
    const end = vi.fn();
    const response = {
      setHeader,
      end,
    } as unknown as Response;

    await expect(
      realController.downloadAsync(
        { url: 'http://127.0.0.1/secret' },
        response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(end).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });
});
