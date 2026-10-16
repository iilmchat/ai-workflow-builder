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
    createTaskAsync: vi.fn(),
    getTaskAsync: vi.fn(),
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

    expect(models).toEqual([model('flux-schnell')]);
    expect(provider.listModelsAsync).toHaveBeenCalledWith('IMAGE');
  });

  it('работает без type (все типы)', async () => {
    const provider = stubProvider('creativelab', [model('kling')]);
    const registry = await createRegistry([provider]);

    await expect(registry.listModelsAsync()).resolves.toEqual([model('kling')]);
    expect(provider.listModelsAsync).toHaveBeenCalledWith(undefined);
  });

  it('склеивает модели нескольких провайдеров в порядке приоритета', async () => {
    const first = stubProvider('creativelab', [model('flux-schnell')]);
    const second = stubProvider('other-media', [model('kling')]);
    const registry = await createRegistry([first, second]);

    await expect(registry.listModelsAsync()).resolves.toEqual([
      model('flux-schnell'),
      model('kling'),
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
    expect(models).toEqual([model('shared-model')]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Модель shared-model уже объявлена'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('модель провайдера other-media пропущена'),
    );
  });
});
