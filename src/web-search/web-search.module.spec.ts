/**
 * Тест DI-регистрации web-search-провайдеров (v0.10 S1; v0.15 S3).
 *
 * Проверяет контракт модуля:
 * - токен {@link WEB_SEARCH_PROVIDER} отдаёт провайдера, выбранного env
 *   `WEB_SEARCH_PROVIDER` (обратная совместимость старых графов);
 * - реестр знает дефолт и умеет вернуть провайдера по имени (`data.provider`);
 * - `GET /web-search/providers` перечисляет всех с флагом `configured` и не
 *   отдаёт ключи (RULES 5.1).
 *
 * `DbModule` и `AuthModule` нужны потому, что `WebSearchModule` импортирует
 * `AuthModule` ради `JwtAuthGuard` контроллера, а `AuthService` зависит от
 * `DRIZZLE`. Подключений к БД нет: `pg.Pool` создаётся лениво.
 */
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { DbModule } from '../db/db.module.js';
import { BingProvider } from './providers/bing.provider.js';
import { BraveProvider } from './providers/brave.provider.js';
import { TavilyProvider } from './providers/tavily.provider.js';
import { WebSearchController } from './web-search.controller.js';
import { WEB_SEARCH_PROVIDER, WebSearchModule } from './web-search.module.js';
import { WebSearchRegistryService } from './web-search.registry.js';

/** Секрет подписи: AuthModule читает его через `getOrThrow`. */
const JWT_SECRET = 'test-secret-at-least-32-characters-long';

/** Фиктивный DATABASE_URL: пул pg создаётся, но соединений не открывает. */
const DATABASE_URL = 'postgres://workflow:devpass123@127.0.0.1:5433/workflow_builder';

/** Переменные окружения, которые меняет spec. */
const MANAGED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'WEB_SEARCH_PROVIDER',
  'TAVILY_API_KEY',
  'BING_API_KEY',
  'BRAVE_API_KEY',
] as const;

/** Исходные значения переменных (чтобы не протекать между тестами). */
const initialEnv = new Map<string, string | undefined>(
  MANAGED_ENV.map((key) => [key, process.env[key]]),
);

/**
 * Восстанавливает окружение после теста.
 */
function restoreEnv(): void {
  for (const [key, value] of initialEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Собирает тестовый модуль web-search с заданным окружением.
 *
 * @param env - переменные окружения поверх дефолтных
 * @returns скомпилированный TestingModule
 */
async function buildModuleAsync(
  env: Record<string, string> = {},
): Promise<TestingModule> {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.JWT_SECRET = JWT_SECRET;

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      DbModule,
      WebSearchModule,
    ],
  }).compile();
}

describe('WebSearchModule (v0.10 S1, v0.15 S3)', () => {
  let moduleRef: TestingModule | null = null;

  afterEach(async () => {
    if (moduleRef !== null) {
      await moduleRef.close();
      moduleRef = null;
    }

    restoreEnv();
  });

  it('без WEB_SEARCH_PROVIDER отдаёт TavilyProvider и дефолт tavily', async () => {
    delete process.env.WEB_SEARCH_PROVIDER;
    moduleRef = await buildModuleAsync();

    const selected = moduleRef.get(WEB_SEARCH_PROVIDER);
    const tavily = moduleRef.get(TavilyProvider);
    const registry = moduleRef.get(WebSearchRegistryService);

    expect(selected).toBeInstanceOf(TavilyProvider);
    expect(selected).toBe(tavily);
    expect(selected.name).toBe('tavily');
    expect(registry.defaultName).toBe('tavily');
  });

  it('WEB_SEARCH_PROVIDER=bing регистрирует Bing дефолтным', async () => {
    moduleRef = await buildModuleAsync({
      WEB_SEARCH_PROVIDER: 'bing',
      BING_API_KEY: 'bing-test-key',
    });

    const selected = moduleRef.get(WEB_SEARCH_PROVIDER);
    const registry = moduleRef.get(WebSearchRegistryService);

    expect(selected).toBeInstanceOf(BingProvider);
    expect(registry.defaultName).toBe('bing');
    expect(registry.list()).toEqual([
      { name: 'tavily', configured: false },
      { name: 'bing', configured: true },
      { name: 'brave', configured: false },
    ]);
  });

  it('WEB_SEARCH_PROVIDER=brave регистрирует Brave дефолтным', async () => {
    moduleRef = await buildModuleAsync({
      WEB_SEARCH_PROVIDER: 'brave',
      BRAVE_API_KEY: 'brave-test-key',
    });

    const selected = moduleRef.get(WEB_SEARCH_PROVIDER);
    const registry = moduleRef.get(WebSearchRegistryService);

    expect(selected).toBeInstanceOf(BraveProvider);
    expect(registry.defaultName).toBe('brave');
  });

  it('getProvider выбирает провайдера по имени, а не только по env', async () => {
    moduleRef = await buildModuleAsync({
      WEB_SEARCH_PROVIDER: 'tavily',
      BRAVE_API_KEY: 'brave-test-key',
    });

    const registry = moduleRef.get(WebSearchRegistryService);

    expect(registry.getProvider()).toBeInstanceOf(TavilyProvider);
    expect(registry.getProvider('brave')).toBeInstanceOf(BraveProvider);
    expect(registry.getProvider('bing')).toBeInstanceOf(BingProvider);
  });

  it('GET /web-search/providers отдаёт дефолт и флаги без ключей', async () => {
    moduleRef = await buildModuleAsync({
      WEB_SEARCH_PROVIDER: 'bing',
      BING_API_KEY: 'secret-bing-key',
    });

    const controller = moduleRef.get(WebSearchController);
    const response = controller.listProviders();

    expect(response).toEqual({
      defaultProvider: 'bing',
      providers: [
        { name: 'tavily', configured: false },
        { name: 'bing', configured: true },
        { name: 'brave', configured: false },
      ],
    });
    // Ключи не должны попадать в ответ (RULES 5.1).
    expect(JSON.stringify(response)).not.toContain('secret-bing-key');
  });
});
