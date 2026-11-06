import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';

/**
 * Таймаут пинга LM Studio (мс).
 *
 * Сервер локальный: если он не запущен, healthcheck не должен ждать дольше.
 * Значение совпадает с таймаутом разведки каталога моделей в
 * `LlmProviderFactory` (`LMSTUDIO_DISCOVERY_TIMEOUT_MS`).
 */
const LMSTUDIO_PING_TIMEOUT_MS = 3_000;

/**
 * Провайдер локального LM Studio (v1.2 S1, DESIGN V120 § 3.1).
 *
 * Технически LM Studio — тот же OpenAI-совместимый API, поэтому класс
 * наследует {@link OpenAiCompatibleProvider}: генерация, embeddings и разбор
 * ошибок не дублируются. Отличие одно — **доступность**: локальный сервер
 * может быть выключен, пока облачные ключи настроены, поэтому
 * {@link isAvailableAsync} пингует `GET {baseURL}/models` с коротким таймаутом.
 *
 * Экземпляр создаёт только `LlmProviderFactory` (с ключом-заглушкой и
 * `isLocal: true`), поэтому DI-декоратор здесь не нужен.
 */
export class LmStudioProvider extends OpenAiCompatibleProvider {
  /**
   * Проверяет доступность локального сервера (v1.2 S1).
   *
   * Запрос намеренно короткий и без ретраев: healthcheck вызывается раз в
   * 30 секунд, а роутер — только когда статус ещё неизвестен. Любая ошибка
   * (нет соединения, не-2xx, таймаут) означает «недоступен», а не исключение:
   * решение о fallback принимает вызывающий код.
   *
   * Тело ответа не разбирается: достаточно кода 2xx — каталог моделей на этом
   * этапе не нужен (его уже прочитала фабрика при старте).
   *
   * @returns `true`, если `GET /models` ответил 2xx
   */
  async isAvailableAsync(): Promise<boolean> {
    const signal = AbortSignal.timeout(LMSTUDIO_PING_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${this.baseURL.replace(/\/+$/, '')}/models`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        },
      );

      return response.ok;
    } catch {
      // Штатная ситуация: LM Studio не запущен. Логирует healthcheck при
      // смене статуса, а не провайдер — иначе лог спамился бы каждые 30 с.
      return false;
    }
  }
}
