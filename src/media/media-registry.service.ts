import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  IMediaProvider,
  MediaModelInfo,
  MediaType,
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
