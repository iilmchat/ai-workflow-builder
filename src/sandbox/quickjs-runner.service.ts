/**
 * Песочница пользовательского JavaScript на QuickJS-WASM (R7.5, KI-364).
 *
 * Зачем: узлу `condition` (и будущему agent-tool `code_eval`, DESIGN v0.9
 * § 3.4) нужны произвольные JS-выражения, но исполнять их в Node нельзя:
 * `new Function` — RCE, `vm2` — deprecated (CVE-2023-29017), `isolated-vm` —
 * native build под Windows + Docker, Node `vm` — небезопасен
 * (`this.constructor.constructor`). QuickJS-WASM — переносимый бинарник без
 * native toolchain: Figma/Cloudflare/Shopify используют ту же модель
 * (DESIGN v0.9 § 2.8, § 3.5).
 *
 * Изоляция держится на трёх ограничителях:
 * 1. **Realm.** Выражение исполняется в отдельном QuickJS-контексте, где нет
 *    `require`, `process`, `fetch`, `window`, `document` вообще — это не
 *    глобалы QuickJS. Встроенные `eval`/`Function`/`globalThis` удаляются из
 *    глобального объекта до исполнения кода, а глобалы, не входящие в
 *    allowlist, затеняются `const … = undefined`.
 * 2. **CPU.** `setInterruptHandler` + `shouldInterruptAfterDeadline` прерывает
 *    `while(true){}` по таймауту; контекст после этого уничтожается.
 * 3. **Память.** `setMemoryLimit` заставляет QuickJS бросить OOM вместо
 *    роста процесса; контекст тоже уничтожается.
 *
 * Модуль лениво грузит WASM: `getQuickJS()` вызывается при первом обращении,
 * а не на старте приложения (DESIGN § 7.3 — первый condition не должен ждать
 * инициализацию 30 мс).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getQuickJS,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';

/** Таймаут по умолчанию, мс (DESIGN v0.9 § 3.5). */
export const SANDBOX_DEFAULT_TIMEOUT_MS = 100;

/** Лимит памяти по умолчанию, МБ (DESIGN v0.9 § 3.5). */
export const SANDBOX_DEFAULT_MEMORY_MB = 16;

/**
 * Глобалы, которые разрешены выражению по умолчанию.
 *
 * Список из DESIGN v0.9 § 3.5. `input` — не глобал QuickJS, а переменная,
 * объявляемая setup-скриптом: в неё попадает значение входа узла. Остальные
 * имена — стандартные встроенные объекты QuickJS; всё, чего нет в списке,
 * затеняется `undefined`.
 */
export const SANDBOX_DEFAULT_ALLOWLIST: readonly string[] = [
  'input',
  'Math',
  'JSON',
  'Date',
  'String',
  'Number',
  'Array',
  'Object',
  'Boolean',
  'Error',
  'RegExp',
  'Map',
  'Set',
  'Promise',
  'Symbol',
];

/** Максимальный размер стека QuickJS, байт (защита от `function f(){f()}`). */
const MAX_STACK_SIZE_BYTES = 512 * 1024;

/** Верхняя граница таймаута, мс: защита от «случайного» `SANDBOX_TIMEOUT_MS`. */
const MAX_TIMEOUT_MS = 5_000;

/** Верхняя граница памяти, МБ: защита от «случайного» `SANDBOX_MEMORY_MB`. */
const MAX_MEMORY_MB = 256;

/** Текст ошибки при превышении CPU-лимита. */
export const SANDBOX_TIMEOUT_ERROR = 'Timeout exceeded';

/** Текст ошибки при превышении лимита памяти. */
export const SANDBOX_MEMORY_ERROR = 'Memory limit exceeded';

/** Текст ошибки при пустом выражении. */
const SANDBOX_EMPTY_EXPRESSION_ERROR = 'Expression is empty';

/** Текст ошибки, если вход не сериализуется в JSON. */
const SANDBOX_INPUT_ERROR = 'Input is not JSON-serializable';

/**
 * Опции одного вычисления.
 *
 * Все поля необязательны: значения по умолчанию берутся из env
 * (`SANDBOX_TIMEOUT_MS`, `SANDBOX_MEMORY_MB`) либо из констант модуля.
 */
export interface SandboxOptions {
  /** Таймаут вычисления, мс. Default — `SANDBOX_TIMEOUT_MS` (100). */
  timeoutMs?: number;
  /** Лимит памяти, МБ. Default — `SANDBOX_MEMORY_MB` (16). */
  memoryLimitMb?: number;
  /** Разрешённые имена. Default — {@link SANDBOX_DEFAULT_ALLOWLIST}. */
  allowlist?: readonly string[];
}

/** Результат вычисления в песочнице. */
export interface SandboxEvaluation {
  /** Значение выражения; `null`, если вычисление не удалось. */
  result: unknown;
  /** Текст ошибки; отсутствует при успехе. */
  error?: string;
}

/**
 * Ошибка «песочница недоступна».
 *
 * Бросается, если `SANDBOX_ENABLED=false` (режим `sandbox` запрещён админом)
 * или если WASM-модуль QuickJS не загрузился. Оба случая — конфигурационные, а
 * не ошибка пользовательского выражения, поэтому отделены от `error` в
 * {@link SandboxEvaluation}.
 */
export class SandboxUnavailableException extends Error {
  /**
   * @param message - причина недоступности (для текста ошибки узла)
   */
  constructor(message: string) {
    super(message);
    this.name = 'SandboxUnavailableException';
  }
}

/**
 * Исполняет JS-выражения в QuickJS-WASM (R7.5).
 *
 * Сервис stateless относительно вычислений: каждый вызов создаёт новый
 * runtime и контекст, а после вычисления уничтожает их. Это дороже переиспользования
 * контекста, зато исключает утечку состояния между узлами и делает «убийство»
 * контекста по таймауту/памяти безопасным.
 */
@Injectable()
export class QuickJsRunnerService {
  private readonly logger = new Logger(QuickJsRunnerService.name);

  /** Обещание загрузки WASM-модуля (lazy, одно на процесс). */
  private quickJsPromise: Promise<QuickJSWASMModule> | undefined;

  /** Разрешён ли режим `sandbox` (env `SANDBOX_ENABLED`, default false). */
  private readonly enabled: boolean;

  /** Таймаут по умолчанию, мс (env `SANDBOX_TIMEOUT_MS`). */
  private readonly defaultTimeoutMs: number;

  /** Лимит памяти по умолчанию, МБ (env `SANDBOX_MEMORY_MB`). */
  private readonly defaultMemoryLimitMb: number;

  /**
   * @param config - конфигурация приложения (RULES 4.6: env только через DI)
   */
  constructor(private readonly config: ConfigService) {
    this.enabled = readBoolean(config.get<unknown>('SANDBOX_ENABLED'), false);
    this.defaultTimeoutMs = clampInteger(
      config.get<unknown>('SANDBOX_TIMEOUT_MS'),
      SANDBOX_DEFAULT_TIMEOUT_MS,
      1,
      MAX_TIMEOUT_MS,
    );
    this.defaultMemoryLimitMb = clampInteger(
      config.get<unknown>('SANDBOX_MEMORY_MB'),
      SANDBOX_DEFAULT_MEMORY_MB,
      1,
      MAX_MEMORY_MB,
    );
  }

  /**
   * Вычисляет JS-выражение в изолированном QuickJS-контексте.
   *
   * Код исполняется как strict-скрипт: `input` — глобальный `const`, всё, чего
   * нет в allowlist, затеняется `undefined`. Результат — completion value
   * последнего выражения, приведённый к хостовому значению через
   * `context.dump()`: объекты/массивы возвращаются как обычные JS-значения.
   *
   * @param expression - JS-выражение или последовательность операторов
   * @param input - значение входа узла (обычно `inputs.input`)
   * @param options - переопределения таймаута/памяти/allowlist
   * @returns `{ result }` при успехе либо `{ result: null, error }`
   * @throws SandboxUnavailableException если sandbox выключен в env или WASM
   *   не загрузился
   */
  async evaluateSandboxedAsync(
    expression: string,
    input: unknown,
    options: SandboxOptions = {},
  ): Promise<SandboxEvaluation> {
    if (!this.enabled) {
      throw new SandboxUnavailableException(
        'Sandbox disabled in env (SANDBOX_ENABLED=false)',
      );
    }

    if (typeof expression !== 'string' || expression.trim().length === 0) {
      return { result: null, error: SANDBOX_EMPTY_EXPRESSION_ERROR };
    }

    const timeoutMs = clampInteger(
      options.timeoutMs,
      this.defaultTimeoutMs,
      1,
      MAX_TIMEOUT_MS,
    );
    const memoryLimitMb = clampInteger(
      options.memoryLimitMb,
      this.defaultMemoryLimitMb,
      1,
      MAX_MEMORY_MB,
    );
    const allowlist = options.allowlist ?? SANDBOX_DEFAULT_ALLOWLIST;

    // Сериализация входа — до создания runtime: ошибка JSON не должна
    // выглядеть как падение песочницы.
    let inputLiteral: string;

    try {
      const serialized = JSON.stringify(input === undefined ? null : input);

      inputLiteral = JSON.stringify(serialized ?? 'null');
    } catch (error: unknown) {
      this.logger.warn(
        `Sandbox: вход не сериализуется в JSON (${toMessage(error)}) — ` +
          'вычисление отклонено',
      );

      return { result: null, error: SANDBOX_INPUT_ERROR };
    }

    const quickjs = await this.loadQuickJsAsync();
    const runtime = quickjs.newRuntime();

    try {
      runtime.setMemoryLimit(memoryLimitMb * 1024 * 1024);
      runtime.setMaxStackSize(MAX_STACK_SIZE_BYTES);
      runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

      const context = runtime.newContext();

      try {
        return this.evaluateInContext(context, expression, inputLiteral, allowlist);
      } finally {
        // Уничтожение контекста — это и есть «kill VM» при timeout/OOM:
        // следующий вызов создаст новый runtime, состояние не переживёт его.
        context.dispose();
      }
    } catch (error: unknown) {
      // `SandboxUnavailableException` здесь означает, что сломался сам WASM,
      // а не пользовательское выражение: пробрасываем наверх (fallback узла).
      if (error instanceof SandboxUnavailableException) {
        throw error;
      }

      this.logger.error(`Sandbox: ошибка runtime — ${toMessage(error)}`);

      return { result: null, error: classifySandboxError(error) };
    } finally {
      runtime.dispose();
    }
  }

  /**
   * Лениво загружает WASM-модуль QuickJS.
   *
   * @returns singleton-модуль QuickJS
   * @throws SandboxUnavailableException если WASM не загрузился
   */
  private async loadQuickJsAsync(): Promise<QuickJSWASMModule> {
    if (this.quickJsPromise === undefined) {
      this.quickJsPromise = getQuickJS().catch((error: unknown) => {
        this.logger.error(`Sandbox: QuickJS-WASM не загрузился — ${toMessage(error)}`);

        throw new SandboxUnavailableException(
          `Sandbox unavailable: QuickJS-WASM failed to load (${toMessage(error)})`,
        );
      });
    }

    return this.quickJsPromise;
  }

  /**
   * Выполняет выражение в готовом контексте QuickJS.
   *
   * @param context - свежий контекст QuickJS
   * @param expression - пользовательское выражение
   * @param inputLiteral - JSON-строка входа, уже экранированная как JS-литерал
   * @param allowlist - разрешённые имена
   * @returns результат либо текст ошибки
   */
  private evaluateInContext(
    context: QuickJSContext,
    expression: string,
    inputLiteral: string,
    allowlist: readonly string[],
  ): SandboxEvaluation {
    const globalNames = this.readGlobalNames(context);

    // Вход разбирается ОТДЕЛЬНЫМ скриптом до объявления `const JSON = …`:
    // глобальные `const` поднимаются (TDZ) на весь скрипт, поэтому
    // `JSON.parse` в том же скрипте, где JSON затеняется, упал бы с
    // «JSON is not initialized».
    const inputResult = context.evalCode(
      `globalThis.__sandboxInput = JSON.parse(${inputLiteral});`,
      'sandbox-input.js',
    );

    if (inputResult.error) {
      const dumped: unknown = context.dump(inputResult.error);

      inputResult.error.dispose();

      return { result: null, error: classifySandboxError(dumped) };
    }

    inputResult.value.dispose();

    // Убирает `Function` из цепочки `({}).constructor.constructor` ДО того, как
    // setup затенит `Object`/`Function` (иначе обращение к ним даст undefined).
    // Без этого `constructor.constructor('return …')()` создаёт функцию в
    // realm'е песочницы: хоста она не достаёт, но формально обходит запрет
    // `Function` (DESIGN v0.9 § 3.5).
    this.hardenFunctionConstructor(context);

    // Затенение неразрешённых глобалов и `input`. Глобальные `const`-биндинги
    // переживают переход к следующему `evalCode`, поэтому пользовательский код
    // видит `input` и не видит `Math`, если `Math` не разрешён.
    const setupResult = context.evalCode(
      buildSandboxSetup(allowlist, globalNames),
      'sandbox-setup.js',
    );

    if (setupResult.error) {
      const dumped: unknown = context.dump(setupResult.error);

      setupResult.error.dispose();

      return { result: null, error: classifySandboxError(dumped) };
    }

    setupResult.value.dispose();

    // `eval`/`Function`/`globalThis` удаляются после setup: setup ещё
    // пользуется `globalThis.__sandboxInput`.
    this.removeDangerousGlobals(context);

    // Пользовательский код исполняется как script, а не как тело `return (...)`
    // обёртки: иначе `while (true) {}` (тест timeout) — синтаксическая ошибка.
    // `evalCode` возвращает completion value последнего выражения, то есть для
    // `input.value > 100` — boolean, для `({ a: 1 })` — объект.
    const evaluation = context.evalCode(
      `'use strict';\n${expression}`,
      'sandbox-expression.js',
    );

    if (evaluation.error) {
      const dumped: unknown = context.dump(evaluation.error);

      evaluation.error.dispose();

      return { result: null, error: classifySandboxError(dumped) };
    }

    const value: unknown = context.dump(evaluation.value);

    evaluation.value.dispose();

    return { result: value };
  }

  /**
   * Читает имена собственных свойств глобального объекта QuickJS.
   *
   * Нужно, чтобы затенять **все** стандартные глобалы, не попавшие в allowlist,
   * а не только заранее известный список.
   *
   * @param context - контекст QuickJS (до удаления `globalThis`)
   * @returns имена глобалов; пустой массив, если чтение не удалось
   */
  private readGlobalNames(context: QuickJSContext): string[] {
    const result = context.evalCode('Object.getOwnPropertyNames(globalThis)');

    if (result.error) {
      result.error.dispose();

      return [];
    }

    const dumped: unknown = context.dump(result.value);

    result.value.dispose();

    if (!Array.isArray(dumped)) {
      return [];
    }

    return dumped.filter((name): name is string => typeof name === 'string');
  }

  /**
   * Обрывает `Function.prototype.constructor`.
   *
   * `delete globalThis.Function` убирает прямое имя, но `({}).constructor`
   * (то есть `Object`) наследует `constructor` от `Function.prototype` — через
   * него создаётся любая функция. Свойство конфигурируемое, поэтому его можно
   * заменить на `undefined` в realm'е песочницы. Хоста это не открывает, но
   * делает обещанный запрет `Function` реальным, а не декоративным.
   *
   * @param context - контекст QuickJS (до затенения `Object`/`Function`)
   */
  private hardenFunctionConstructor(context: QuickJSContext): void {
    const result = context.evalCode(`
      (function () {
        try {
          Object.defineProperty(Function.prototype, 'constructor', {
            value: undefined,
            writable: false,
            configurable: false,
          });
        } catch (error) {}
      })();
    `);

    if (result.error) {
      result.error.dispose();
    } else {
      result.value.dispose();
    }
  }

  /**
   * Удаляет `eval`, `Function` и `globalThis` из глобального объекта QuickJS.
   *
   * Эти имена существуют в любом JS-realm, поэтому «отсутствием в QuickJS» их
   * не убрать. `eval` нельзя затенять `const` в strict-режиме (SyntaxError),
   * а удаление свойства даёт `ReferenceError` при любом обращении — и в
   * пользовательском коде, и в функции, созданной через
   * `constructor.constructor('return eval')()`.
   *
   * @param context - контекст QuickJS
   */
  private removeDangerousGlobals(context: QuickJSContext): void {
    const result = context.evalCode(`
      (function () {
        try {
          delete globalThis.eval;
          delete globalThis.Function;
          delete globalThis.globalThis;
        } catch (error) {}
      })();
    `);

    if (result.error) {
      result.error.dispose();
    } else {
      result.value.dispose();
    }
  }
}

/**
 * Собирает setup-программу QuickJS: объявляет `input` и затеняет глобалы, не
 * входящие в allowlist.
 *
 * Затенение сделано глобальными `const <name> = undefined`: эти биндинги
 * относятся к global lexical environment и видны следующему `evalCode` в том
 * же контексте, поэтому пользовательское выражение видит `input` и не видит
 * `Math`, если `Math` не разрешён. Имена `eval`/`Function`/`globalThis`
 * пропускаются — они не затеняются, а удаляются из глобального объекта (см.
 * {@link QuickJsRunnerService.removeDangerousGlobals}), иначе обращение к ним
 * давало бы `undefined` вместо `ReferenceError`.
 *
 * Сам вход уже лежит в `globalThis.__sandboxInput` (разбирается отдельным
 * скриптом до затенения `JSON`): здесь он только копируется в `input`.
 *
 * @param allowlist - разрешённые имена
 * @param globalNames - имена глобалов QuickJS
 * @returns исходник setup-скрипта
 */
function buildSandboxSetup(
  allowlist: readonly string[],
  globalNames: readonly string[],
): string {
  const allowed = new Set(allowlist);
  const removedGlobals = new Set(['eval', 'Function', 'globalThis']);
  /**
   * Глобальные свойства, которые нельзя переобъявить через `const`:
   * `Infinity`/`NaN`/`undefined` — non-configurable, объявление даёт
   * `SyntaxError: redeclaration`. Они и так безопасны (не дают доступа к хосту).
   */
  const nonRedeclarable = new Set(['undefined', 'Infinity', 'NaN']);
  const shadowed = new Set<string>();

  for (const name of globalNames) {
    if (name === 'arguments' || name === 'input') {
      continue;
    }

    if (removedGlobals.has(name) || nonRedeclarable.has(name) || allowed.has(name)) {
      continue;
    }

    if (!isValidIdentifier(name) || KEYWORDS.has(name)) {
      continue;
    }

    shadowed.add(name);
  }

  const declarations = [...shadowed].map((name) => `const ${name} = undefined;`);
  const bindings = [
    'const input = globalThis.__sandboxInput;',
    'delete globalThis.__sandboxInput;',
    ...declarations,
  ];

  return bindings.join('\n');
}

/**
 * Приводит любую ошибку песочницы к понятному тексту.
 *
 * @param dumped - значение, полученное из `context.dump()` (ошибка или иное)
 * @returns `Timeout exceeded` / `Memory limit exceeded` либо исходный текст
 */
function classifySandboxError(dumped: unknown): string {
  const message = describeError(dumped);

  if (/interrupted/i.test(message)) {
    return SANDBOX_TIMEOUT_ERROR;
  }

  if (/out of memory|memory limit|allocation (?:failed|error)|\boom\b/i.test(message)) {
    return SANDBOX_MEMORY_ERROR;
  }

  return message;
}

/**
 * Строит читаемый текст ошибки из значения QuickJS.
 *
 * @param dumped - значение из `context.dump()`
 * @returns текст ошибки
 */
function describeError(dumped: unknown): string {
  if (typeof dumped === 'string') {
    return dumped;
  }

  if (typeof dumped === 'object' && dumped !== null) {
    const record = dumped as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : 'Error';
    const message = typeof record.message === 'string' ? record.message : '';

    return message.length > 0 ? `${name}: ${message}` : name;
  }

  return toMessage(dumped);
}

/**
 * Приводит неизвестное значение к строке.
 *
 * @param value - значение
 * @returns строка (без `[object Object]` для Error)
 */
function toMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  return String(value);
}

/**
 * Читает boolean из конфигурации (ConfigService может отдать строку).
 *
 * @param value - сырое значение
 * @param fallback - значение, если распознать не удалось
 * @returns boolean
 */
function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  return fallback;
}

/**
 * Приводит значение к целому числу в заданных границах.
 *
 * @param value - сырое значение
 * @param fallback - значение по умолчанию
 * @param min - нижняя граница
 * @param max - верхняя граница
 * @returns целое число
 */
function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(numeric), min), max);
}

/**
 * Проверяет, что строка — валидный JS-идентификатор.
 *
 * @param value - имя глобала
 * @returns `true`, если имя можно объявить через `const`
 */
function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

/** Ключевые слова JS, которые нельзя использовать как имя `const`. */
const KEYWORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);
