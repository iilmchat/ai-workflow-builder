/**
 * Тест DI-регистрации web-search-провайдера (v0.10 S1).
 *
 * Проверяет контракт модуля: исполнитель узла (S2) получает провайдера по
 * токену {@link WEB_SEARCH_PROVIDER}, а не по конкретному классу. Это позволяет
 * позже добавить Bing/Google/Brave без правок executor'а.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TavilyProvider } from './tavily.provider.js';
import { WEB_SEARCH_PROVIDER, WebSearchModule } from './web-search.module.js';

describe('WebSearchModule (v0.10 S1)', () => {
  it('отдаёт TavilyProvider под токеном WEB_SEARCH_PROVIDER', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        WebSearchModule,
      ],
    }).compile();

    const selected = moduleRef.get(WEB_SEARCH_PROVIDER);
    const tavily = moduleRef.get(TavilyProvider);

    expect(selected).toBeInstanceOf(TavilyProvider);
    expect(selected).toBe(tavily);
    expect(selected.name).toBe('tavily');

    await moduleRef.close();
  });
});
