import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  IMediaProvider,
  MediaModelInfo,
  MediaType,
} from './media-provider.interface.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';

/**
 * Создаёт минимальную модель для проверок реестра.
 *
 * @param id - идентификатор модели
 * @returns описание модели
 */
function model(id: string): MediaModelInfo {
  return {
    id,
    code: id,
    type: 'IMAGE',
    price: 0,
    priceUnit: 'per_generation',
    // KI-317: тариф за вход не задан — модель берёт плату за генерацию.
    priceInput: null,
    priceInputUnit: null,
    moderation: 'auto',
    prompt: 'required',
    params: [],
    inputs: [],
  };
}

/**
 * Создаёт провайдера-заглушку.
 *
 * @param name - идентификатор провайдера
 * @param models - модели, которые он возвращает
 * @param isConfigured - сконфигурирован ли провайдер
 * @returns провайдер-заглушка с моком `listModelsAsync`
 */
function stubProvider(
  name: string,
  models: MediaModelInfo[],
  isConfigured = true,
): IMediaProvider & { listModelsAsync: ReturnType<typeof vi.fn> } {
  return {
    name,
    isConfigured,
    listModelsAsync: vi.fn((_type?: MediaType) => Promise.resolve(models)),
    // KI-317: заглушке нужен только `listModelsAsync`, но IMediaProvider
    // требует и методы задач — объявляем их моками без реализации.
    // R7.1: то же для инструмента (реестр его не вызывает — им пользуется
    // `MediaNodeExecutor`).
    createTaskAsync: vi.fn(),
    getTaskAsync: vi.fn(),
    applyToolAsync: vi.fn(),
  };
}

/**
 * Собирает реестр на заданных провайдерах.
 *
 * @param providers - провайдеры в порядке приоритета
 * @returns экземпляр реестра
 */
async function createRegistry(
  providers: IMediaProvider[],
): Promise<MediaRegistryService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MediaRegistryService,
      { provide: MEDIA_PROVIDERS, useValue: providers },
    ],
  }).compile();

  return moduleRef.get(MediaRegistryService);
}

describe('MediaRegistryService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('возвращает пустой список, если провайдер не сконфигурирован', async () => {
    const provider = stubProvider('creativelab', [model('flux-schnell')], false);
    const registry = await createRegistry([provider]);

    await expect(registry.listModelsAsync('IMAGE')).resolves.toEqual([]);
    // Неконфигурированного провайдера не дёргаем вовсе.
    expect(provider.listModelsAsync).not.toHaveBeenCalled();
  });

  it('возвращает пустой список, если провайдеров нет', async () => {
    const registry = await createRegistry([]);

    await expect(registry.listModelsAsync()).resolves.toEqual([]);
  });

  it('возвращает модели сконфигурированного провайдера и передаёт type', async () => {
    const provider = stubProvider('creativelab', [model('flux-schnell')]);
    const registry = await createRegistry([provider]);

    const models = await registry.listModelsAsync('IMAGE');

    // R7.3: реестр проставляет `provider` — по нему UI группирует селект.
    expect(models).toEqual([{ ...model('flux-schnell'), provider: 'creativelab' }]);
    expect(provider.listModelsAsync).toHaveBeenCalledWith('IMAGE');
  });

  it('работает без type (все типы)', async () => {
    const provider = stubProvider('creativelab', [model('kling')]);
    const registry = await createRegistry([provider]);

    await expect(registry.listModelsAsync()).resolves.toEqual([
      { ...model('kling'), provider: 'creativelab' },
    ]);
    expect(provider.listModelsAsync).toHaveBeenCalledWith(undefined);
  });

  it('склеивает модели нескольких провайдеров в порядке приоритета', async () => {
    const first = stubProvider('creativelab', [model('flux-schnell')]);
    const second = stubProvider('other-media', [model('kling')]);
    const registry = await createRegistry([first, second]);

    await expect(registry.listModelsAsync()).resolves.toEqual([
      { ...model('flux-schnell'), provider: 'creativelab' },
      { ...model('kling'), provider: 'other-media' },
    ]);
  });

  it('пробрасывает ошибку провайдера наверх', async () => {
    const provider = stubProvider('creativelab', []);
    provider.listModelsAsync.mockRejectedValue(new Error('upstream упал'));

    const registry = await createRegistry([provider]);

    await expect(registry.listModelsAsync('IMAGE')).rejects.toThrow('upstream упал');
  });

  it('при коллизии id оставляет первое объявление и пишет warning', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const first = stubProvider('creativelab', [model('shared-model')]);
    const second = stubProvider('other-media', [model('shared-model')]);
    const registry = await createRegistry([first, second]);

    const models = await registry.listModelsAsync('IMAGE');

    // Первый провайдер в приоритете: его модель остаётся, дубликат отброшен.
    expect(models).toEqual([
      { ...model('shared-model'), provider: 'creativelab' },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Модель shared-model уже объявлена'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('модель провайдера other-media пропущена'),
    );
  });

  it('listAllModelsAsync агрегирует каталоги всех провайдеров (R7.3)', async () => {
    const creativelab = stubProvider('creativelab', [model('flux-schnell')]);
    const replicate = stubProvider('replicate', [model('replicate:flux-dev')]);
    const fal = stubProvider('fal', [model('fal:flux-pro')]);
    const registry = await createRegistry([creativelab, replicate, fal]);

    const models = await registry.listAllModelsAsync('IMAGE');

    expect(models.map((item) => item.id)).toEqual([
      'flux-schnell',
      'replicate:flux-dev',
      'fal:flux-pro',
    ]);
    expect(replicate.listModelsAsync).toHaveBeenCalledWith('IMAGE');
  });

  it('listAllModelsAsync пропускает неконфигурированных провайдеров', async () => {
    const configured = stubProvider('creativelab', [model('flux-schnell')]);
    const disabled = stubProvider('replicate', [model('replicate:x')], false);
    const registry = await createRegistry([configured, disabled]);

    const models = await registry.listAllModelsAsync();

    expect(models.map((item) => item.id)).toEqual(['flux-schnell']);
    expect(disabled.listModelsAsync).not.toHaveBeenCalled();
  });

  it('resolveByModelAsync публичный и находит провайдера по модели (R7.3)', async () => {
    const creativelab = stubProvider('creativelab', [model('flux-schnell')]);
    const replicate = stubProvider('replicate', [model('replicate:flux-dev')]);
    const registry = await createRegistry([creativelab, replicate]);

    await expect(registry.resolveByModelAsync('replicate:flux-dev')).resolves.toBe(
      replicate,
    );
    await expect(registry.resolveByModelAsync('нет-такой')).rejects.toThrow(
      'Модель не поддерживается ни одним media-провайдером: нет-такой',
    );
  });

  it('resolveByModelAsync без провайдеров объясняет причину', async () => {
    const registry = await createRegistry([]);

    await expect(registry.resolveByModelAsync('flux-schnell')).rejects.toThrow(
      'Нет сконфигурированных media-провайдеров',
    );
  });

  it('findModelAsync возвращает модель, объявленную в каталоге', async () => {
    const creativelab = stubProvider('creativelab', [model('flux-schnell')]);
    const registry = await createRegistry([creativelab]);

    await expect(registry.findModelAsync('flux-schnell')).resolves.toEqual(
      model('flux-schnell'),
    );
    await expect(registry.findModelAsync('нет-такой')).resolves.toBeNull();
  });

  it('findParamsAsync берёт параметры из первого каталога, объявившего модель', async () => {
    const withParams = stubProvider('creativelab', [
      {
        ...model('shared'),
        params: [
          { key: 'size', type: 'enum', label: 'wfc_size', default: '1024' },
        ],
      },
    ]);
    const withoutParams = stubProvider('replicate', [model('shared')]);
    const registry = await createRegistry([withParams, withoutParams]);

    const params = await registry.findParamsAsync('shared');

    expect(params?.map((param) => param.key)).toEqual(['size']);
  });

  it('listProviderNames отдаёт провайдеров в порядке приоритета', async () => {
    const registry = await createRegistry([
      stubProvider('creativelab', []),
      stubProvider('replicate', []),
      stubProvider('fal', []),
    ]);

    expect(registry.listProviderNames()).toEqual([
      'creativelab',
      'replicate',
      'fal',
    ]);
  });

  it('проставляет provider моделям, которые его не заполнили (R7.3)', async () => {
    // Каталог CreativeLab строит свой маппер и поля `provider` не знает:
    // реестр обязан проставить его сам, иначе UI соберёт группу `undefined`
    // (найдено смоуком R7.3).
    const creativelab = stubProvider('creativelab', [model('bgremover')]);
    const registry = await createRegistry([creativelab]);

    const models = await registry.listModelsAsync();

    expect(models[0]?.provider).toBe('creativelab');
  });

  it('не перезаписывает provider, если его заполнил сам провайдер', async () => {
    const provider = stubProvider('replicate', [
      { ...model('replicate:flux-dev'), provider: 'replicate' },
    ]);
    const registry = await createRegistry([provider]);

    const models = await registry.listAllModelsAsync();

    expect(models[0]?.provider).toBe('replicate');
  });
});
