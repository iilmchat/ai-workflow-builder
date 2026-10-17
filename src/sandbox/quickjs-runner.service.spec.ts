/**
 * Тесты WASM-песочницы QuickJS (R7.5, KI-364).
 *
 * Здесь проверяется реальный QuickJS-WASM, а не мок: смысл модуля — именно
 * изоляция и лимиты, которые мок не воспроизводит. WASM грузится один раз на
 * весь файл (первый `getQuickJS()` ~десятки мс), дальше каждый вызов создаёт
 * отдельный runtime.
 *
 * Тест timeout не должен «висеть»: если `setInterruptHandler` не сработает,
 * Vitest упадёт по своему таймауту — это и есть сигнал, что песочница не
 * убивает `while(true){}`.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  QuickJsRunnerService,
  SANDBOX_MEMORY_ERROR,
  SANDBOX_TIMEOUT_ERROR,
  SandboxUnavailableException,
} from './quickjs-runner.service.js';

/** Конфигурация песочницы по умолчанию для тестов (режим включён). */
const SANDBOX_CONFIG: Record<string, unknown> = {
  SANDBOX_ENABLED: true,
  SANDBOX_TIMEOUT_MS: 100,
  SANDBOX_MEMORY_MB: 16,
};

/**
 * Создаёт сервис через Nest TestingModule (RULES 4.13).
 *
 * @param config - значения, которые вернёт `ConfigService.get()`
 * @returns экземпляр {@link QuickJsRunnerService}
 */
async function createRunnerAsync(
  config: Record<string, unknown>,
): Promise<QuickJsRunnerService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      QuickJsRunnerService,
      {
        provide: ConfigService,
        useValue: { get: (key: string): unknown => config[key] },
      },
    ],
  }).compile();

  return moduleRef.get(QuickJsRunnerService);
}

describe('QuickJsRunnerService', () => {
  let runner: QuickJsRunnerService;

  beforeAll(async () => {
    runner = await createRunnerAsync(SANDBOX_CONFIG);
  });

  describe('базовый eval', () => {
    it('input.value > 100 → true', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'input.value > 100',
        { value: 150 },
      );

      expect(error).toBeUndefined();
      expect(result).toBe(true);
    });

    it('input.value > 100 → false', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'input.value > 100',
        { value: 50 },
      );

      expect(error).toBeUndefined();
      expect(result).toBe(false);
    });

    it('строковое выражение: includes + length', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        "input.length > 3 && input.includes('foo')",
        'foobar',
      );

      expect(error).toBeUndefined();
      expect(result).toBe(true);
    });

    it('арифметика по полям входа', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'input.a * input.b + 1',
        { a: 6, b: 7 },
      );

      expect(error).toBeUndefined();
      expect(result).toBe(43);
    });

    it('объект как результат возвращается как JS-объект', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        '({ doubled: input.value * 2, ok: true })',
        { value: 21 },
      );

      expect(error).toBeUndefined();
      expect(result).toEqual({ doubled: 42, ok: true });
    });

    it('массив как результат возвращается как JS-массив', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'input.map((n) => n * 2)',
        [1, 2, 3],
      );

      expect(error).toBeUndefined();
      expect(result).toEqual([2, 4, 6]);
    });

    it('Math / JSON / Date доступны по умолчанию', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        "JSON.stringify({ max: Math.max(1, 2), year: new Date(0).getUTCFullYear() })",
        null,
      );

      expect(error).toBeUndefined();
      expect(result).toBe('{"max":2,"year":1970}');
    });

    it('несколько операторов: completion value последнего', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'const doubled = input.value * 2;\ndoubled > 100;',
        { value: 60 },
      );

      expect(error).toBeUndefined();
      expect(result).toBe(true);
    });
  });

  describe('лимиты', () => {
    it('while(true){} прерывается по таймауту', async () => {
      const startedAt = Date.now();
      const { result, error } = await runner.evaluateSandboxedAsync(
        'while (true) {}',
        null,
      );
      const elapsedMs = Date.now() - startedAt;

      expect(result).toBeNull();
      expect(error).toBe(SANDBOX_TIMEOUT_ERROR);
      // 100 мс лимита + накладные расходы на создание runtime.
      expect(elapsedMs).toBeLessThan(2_000);
    });

    it('кастомный timeoutMs=25 тоже прерывает цикл', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        'for (;;) {}',
        null,
        { timeoutMs: 25 },
      );

      expect(error).toBe(SANDBOX_TIMEOUT_ERROR);
    });

    it('лимит памяти: огромный массив → Memory limit exceeded', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'new Array(1000000000).fill(0)',
        null,
        { memoryLimitMb: 16 },
      );

      expect(result).toBeNull();
      expect(error).toBe(SANDBOX_MEMORY_ERROR);
    });
  });

  describe('запрещённые глобалы', () => {
    it('eval() недоступен', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        "eval('1 + 1')",
        null,
      );

      expect(error).toMatch(/not defined|not a function/i);
    });

    it('new Function() недоступен', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        "new Function('return 1')()",
        null,
      );

      expect(error).toMatch(/not defined|not a function|not a constructor/i);
    });

    it('require() недоступен', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        "require('node:fs')",
        null,
      );

      expect(error).toMatch(/not defined|not a function/i);
    });

    it('process недоступен', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        'process.env',
        null,
      );

      expect(error).toMatch(/not defined|not a function/i);
    });

    it("constructor.constructor('return process')() не достаёт process", async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        "({}).constructor.constructor('return process')()",
        null,
      );

      expect(error).toMatch(/not defined|not a function/i);
    });

    it("constructor.constructor не создаёт функцию (Function.prototype.constructor оборван)", async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        "({}).constructor.constructor('return 1')()",
        null,
      );

      expect(error).toMatch(/not a function|undefined/i);
    });

    it('globalThis недоступен', async () => {
      const { error } = await runner.evaluateSandboxedAsync('globalThis', null);

      expect(error).toMatch(/not defined/i);
    });

    it('typeof globalThis === "undefined"', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'typeof globalThis',
        null,
      );

      expect(error).toBeUndefined();
      expect(result).toBe('undefined');
    });
  });

  describe('allowlist', () => {
    it('Math недоступен, если его нет в allowlist', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        'Math.max(1, 2)',
        null,
        { allowlist: ['input'] },
      );

      expect(error).toMatch(/Math|undefined/i);
    });

    it('кастомный allowlist сохраняет input', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'input.value + 1',
        { value: 41 },
        { allowlist: ['input', 'Number'] },
      );

      expect(error).toBeUndefined();
      expect(result).toBe(42);
    });
  });

  describe('ошибки выражения', () => {
    it('пустое выражение → понятная ошибка', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync('   ', null);

      expect(result).toBeNull();
      expect(error).toBe('Expression is empty');
    });

    it('исключение внутри выражения возвращается текстом', async () => {
      // `Error` не входит в allowlist по умолчанию (DESIGN § 3.5), поэтому
      // проверяем проброс произвольного значения.
      const { error } = await runner.evaluateSandboxedAsync("throw 'boom'", null);

      expect(error).toContain('boom');
    });

    it('синтаксическая ошибка возвращается текстом', async () => {
      const { error } = await runner.evaluateSandboxedAsync(
        'input.value >>>',
        { value: 1 },
      );

      expect(error).toMatch(/SyntaxError/i);
    });

    it('не-JSON вход отклоняется до запуска VM', async () => {
      const { result, error } = await runner.evaluateSandboxedAsync(
        'input',
        { big: 1n },
      );

      expect(result).toBeNull();
      expect(error).toBe('Input is not JSON-serializable');
    });
  });

  describe('выключенная песочница', () => {
    it('SANDBOX_ENABLED=false → SandboxUnavailableException', async () => {
      const disabledRunner = await createRunnerAsync({
        ...SANDBOX_CONFIG,
        SANDBOX_ENABLED: false,
      });

      await expect(
        disabledRunner.evaluateSandboxedAsync('true', null),
      ).rejects.toThrow(SandboxUnavailableException);
      await expect(
        disabledRunner.evaluateSandboxedAsync('true', null),
      ).rejects.toThrow('Sandbox disabled in env');
    });
  });
});
