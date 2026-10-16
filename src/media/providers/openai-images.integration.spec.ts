import { ConfigService } from '@nestjs/config';
import { MediaProviderException } from '../media-provider.interface.js';
import { OpenAiImagesProvider } from './openai-images.provider.js';

/**
 * Интеграционный тест прямого провайдера OpenAI Images (R7.3, DESIGN § 3.3).
 *
 * Тесты с реальным ключом гоняются **только при заданном ключе**
 * (`OPENAI_IMAGES_API_KEY` или `OPENAI_API_KEY`) и делают **реальный платный**
 * вызов `gpt-image-1`: проверяется то, что мок не проверяет, — фактический
 * контракт OpenAI (`/v1/images/generations` с `base64`) и то, что провайдер
 * доводит ответ до `MediaTaskResult` (`status: 'done'`, непустой
 * `data:`-URI).
 *
 * В CI ключа нет, поэтому эти тесты **пропускаются** (`skipIf`), а не падают.
 * Тест ветки «ключа нет» гоняется всегда: он не ходит в сеть.
 *
 * Запуск вручную: `OPENAI_API_KEY=<ваш-ключ> pnpm exec vitest run
 * src/media/providers/openai-images.integration.spec.ts`.
 */

/** Ключ из окружения: отдельный для Images либо общий ключ OpenAI. */
const API_KEY =
  process.env.OPENAI_IMAGES_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
/** Base URL из окружения (пусто — дефолт провайдера). */
const BASE_URL = process.env.OPENAI_IMAGES_BASE_URL;
/** Есть ли ключ: без него интеграционные тесты пропускаются. */
const hasKey = API_KEY.length > 0;
/** Таймаут реального вызова: генерация идёт десятками секунд. */
const LIVE_TIMEOUT_MS = 180_000;

/**
 * Создаёт заглушку `ConfigService` для реального вызова.
 *
 * @returns заглушка ConfigService со значениями из окружения
 */
function configStub(): ConfigService {
  const values: Record<string, string | number | undefined> = {
    OPENAI_IMAGES_API_KEY: API_KEY,
    OPENAI_IMAGES_BASE_URL: BASE_URL,
    MEDIA_USD_RUB_RATE: 100,
  };

  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('OpenAiImagesProvider — интеграция (R7.3)', () => {
  it('без ключа провайдер не сконфигурирован и бросает при вызове', async () => {
    const provider = new OpenAiImagesProvider({
      get: () => undefined,
    } as unknown as ConfigService);

    expect(provider.isConfigured).toBe(false);
    await expect(provider.listModelsAsync()).rejects.toThrow(
      MediaProviderException,
    );
  });

  describe.skipIf(!hasKey)('с реальным ключом', () => {
    it(
      'генерирует картинку gpt-image-1 и отдаёт data:image/png;base64',
      async () => {
        const provider = new OpenAiImagesProvider(configStub());

        expect(provider.isConfigured).toBe(true);

        const task = await provider.createTaskAsync({
          model: 'openai_images:gpt-image-1',
          prompt: 'a red circle on a white background, flat design',
          params: { size: '1024x1024', quality: 'low' },
          idempotencyKey: `integration:${Date.now()}`,
        });

        expect(task.status).toBe('done');
        expect(task.model).toBe('gpt-image-1');
        expect(task.resultUrls).toHaveLength(1);
        expect(task.resultUrls[0]?.startsWith('data:image/png;base64,')).toBe(
          true,
        );
        // Содержимое действительно base64 и непустое: мок такое не проверяет.
        expect((task.resultUrls[0] ?? '').length).toBeGreaterThan(1_000);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'каталог моделей собирается при доступном upstream',
      async () => {
        const provider = new OpenAiImagesProvider(configStub());

        const models = await provider.listModelsAsync('IMAGE');

        expect(models.map((model) => model.id)).toEqual([
          'openai_images:gpt-image-1',
          'openai_images:dall-e-3',
        ]);
      },
      LIVE_TIMEOUT_MS,
    );
  });
});
