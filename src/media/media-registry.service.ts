import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MediaTaskResult } from './dto/media-task.mapper.js';
import {
  MediaProviderException,
  type CreateMediaTaskInput,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaParam,
  type MediaType,
} from './media-provider.interface.js';

/** Токен DI со списком media-провайдеров (см. `MediaModule`). */
export const MEDIA_PROVIDERS = 'MEDIA_PROVIDERS';

/**
 * Реестр media-провайдеров (v0.6.0b.2.1).
 *
 * Пока провайдер один (`creativelab`), но реестр уже собран как агрегатор:
 * когда появится второй media-провайдер (v0.6.0b.2.x), достаточно передать его
 * в конструктор — контроллер, дедупликация и UI не изменятся.
 *
 * Провайдеры приходят по конструктору (RULES 1.3); сконфигурированные
 * определяются на месте по `isConfigured`, как в `LlmRegistryService`.
 */
@Injectable()
export class MediaRegistryService {
  private readonly logger = new Logger(MediaRegistryService.name);

  /** Все media-провайдеры в порядке приоритета. */
  private readonly providers: readonly IMediaProvider[];

  /**
   * @param providers - media-провайдеры в порядке приоритета
   */
  constructor(@Inject(MEDIA_PROVIDERS) providers: readonly IMediaProvider[]) {
    this.providers = providers;
  }

  /**
   * Возвращает media-модели указанного типа от всех сконфигурированных
   * провайдеров.
   *
   * Если ни один провайдер не сконфигурирован, возвращается **пустой массив**,
   * а не ошибка: отсутствие ключа — штатное состояние (пользователь может не
   * пользоваться media-узлами), а `GET /media/models` должен отвечать
   * `{ models: [] }`, чтобы UI просто не показывал ни одной модели. Ошибка
   * была бы неотличима от поломки upstream и ломала бы загрузку страницы.
   *
   * @param type - тип модели, либо `undefined` — модели всех типов
   * @returns модели всех сконфигурированных провайдеров; пустой массив, если
   *   ни один не сконфигурирован
   * @throws MediaProviderException если сконфигурированный провайдер ответил
   *   ошибкой (пробрасывается наверх как есть)
   */
  async listModelsAsync(
    type?: MediaType,
  ): Promise<readonly MediaModelInfo[]> {
    const configured = this.providers.filter(
      (provider) => provider.isConfigured,
    );

    if (configured.length === 0) {
      this.logger.debug('Нет сконфигурированных media-провайдеров');

      return [];
    }

    const results = await Promise.all(
      configured.map((provider) => provider.listModelsAsync(type)),
    );

    return this.deduplicate(configured, results);
  }

  /**
   * Создаёт задачу генерации у провайдера, которому принадлежит модель.
   *
   * Маршрутизация идёт по id модели: реестр просматривает каталоги
   * сконфигурированных провайдеров и берёт первого, кто объявил модель. Так
   * исполнитель узла не знает, какой провайдер её обслуживает, и добавление
   * второго провайдера не требует правок в executor'е.
   *
   * @param input - модель, промпт, параметры и ключ идемпотентности
   * @returns задача с `taskId`; при `done` — с `resultUrls` и `costRub`
   * @throws MediaProviderException если ни один провайдер не сконфигурирован,
   *   модель никем не объявлена или провайдер ответил ошибкой
   */
  async createTaskAsync(input: CreateMediaTaskInput): Promise<MediaTaskResult> {
    const provider = await this.resolveByModelAsync(input.model);

    return provider.createTaskAsync(input);
  }

  /**
   * Возвращает состояние задачи у подходящего провайдера.
   *
   * @param taskId - id задачи в upstream
   * @param model - id модели, если известен: сужает круг провайдеров
   * @returns текущее состояние задачи
   * @throws MediaProviderException если подходящий провайдер не найден или
   *   ответил ошибкой
   */
  async getTaskAsync(taskId: string, model?: string): Promise<MediaTaskResult> {
    const provider = model
      ? await this.resolveByModelAsync(model)
      : this.providers.find((candidate) => candidate.isConfigured);

    if (!provider) {
      throw new MediaProviderException(
        'media',
        'Нет сконфигурированных media-провайдеров',
      );
    }

    return provider.getTaskAsync(taskId);
  }

  /**
   * Возвращает параметры, объявленные моделью в каталоге (KI-181).
   *
   * Нужны исполнителю media-узла: набор параметров у моделей разный, поэтому
   * запрос собирается по каталогу, а не по хардкоду.
   *
   * @param modelId - id модели из каталога
   * @returns параметры модели либо `null`, если модель не найдена (каталог
   *   недоступен или модель не объявлена ни одним провайдером)
   */
  async findParamsAsync(modelId: string): Promise<readonly MediaParam[] | null> {
    const configured = this.providers.filter(
      (provider) => provider.isConfigured,
    );

    for (const provider of configured) {
      const models = await provider.listModelsAsync();
      const found = models.find((model) => model.id === modelId);

      if (found) {
        return found.params;
      }
    }

    return null;
  }

  /**
   * Находит провайдера, объявившего модель.
   *
   * @param modelId - id модели из каталога
   * @returns провайдер, обслуживающий модель
   * @throws MediaProviderException если модель не объявлена ни одним
   *   сконфигурированным провайдером
   */
  private async resolveByModelAsync(modelId: string): Promise<IMediaProvider> {
    const configured = this.providers.filter(
      (provider) => provider.isConfigured,
    );

    for (const provider of configured) {
      const models = await provider.listModelsAsync();

      if (models.some((model) => model.id === modelId)) {
        return provider;
      }
    }

    throw new MediaProviderException(
      'media',
      `Модель не поддерживается ни одним media-провайдером: ${modelId}`,
    );
  }

  /**
   * Склеивает ответы провайдеров, убирая дубликаты id.
   *
   * При коллизии (два провайдера объявили один id) побеждает **первый в
   * порядке приоритета**, а конфликт пишется предупреждением. Так id модели
   * всегда уходит в один и тот же upstream: «последний побеждает» делал бы
   * маршрутизацию зависимой от порядка объявления провайдеров.
   *
   * @param providers - провайдеры в порядке приоритета (параллельно `results`)
   * @param results - ответы провайдеров
   * @returns объединённый список без дубликатов
   */
  private deduplicate(
    providers: readonly IMediaProvider[],
    results: ReadonlyArray<readonly MediaModelInfo[]>,
  ): readonly MediaModelInfo[] {
    const merged: MediaModelInfo[] = [];
    const seen = new Set<string>();

    results.forEach((models, index) => {
      const providerName = providers[index]?.name ?? 'unknown';

      for (const model of models) {
        if (seen.has(model.id)) {
          this.logger.warn(
            `Модель ${model.id} уже объявлена другим media-провайдером; использована первая, модель провайдера ${providerName} пропущена`,
          );
          continue;
        }

        seen.add(model.id);
        merged.push(model);
      }
    });

    return merged;
  }
}
