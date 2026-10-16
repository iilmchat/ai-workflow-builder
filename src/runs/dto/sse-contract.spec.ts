/**
 * Паритет-гейт: SSE-схемы backend ↔ `docs/development/sse-contract.json` (KI-348).
 *
 * До этого spec'а зеркало `web/src/types/run-stream.ts` синхронизировалось
 * вручную: расхождение (KI-NEW-B в v0.8.3) валило реальный SSE-поток, но
 * unit-тесты обеих сторон молчали — набор полей нигде не сверялся.
 *
 * **Процесс (KI-348).** `docs/development/sse-contract.json` — источник правды
 * по составу полей:
 * 1. backend изменил поля события/снимка → падает **этот** spec;
 * 2. frontend (зеркало) не подтянул изменение → падает
 *    `web/src/types/run-stream-contract.spec.ts`;
 * 3. правка одного JSON синхронизирует обе стороны — и гейт снова зелёный.
 *
 * Сравниваются **имена** полей (не типы и не проверки): гейт отвечает на вопрос
 * «тот же состав контракта?». Ужесточение самих проверок зеркала (`z.uuid()`
 * вместо `z.string()` и т.п.) — отдельная задача KI-350.
 *
 * Путь к JSON строится от `import.meta.url`, а не от `process.cwd()`: иначе
 * spec зависел бы от каталога запуска (RULES 1.9, ср. `api-prefixes.spec.ts`).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RunEventSchema } from './run-event.dto.js';
import { SnapshotMessageSchema } from './run-stream-message.dto.js';

/** Абсолютный путь к контракту: spec лежит в `src/runs/dto`, тремя уровнями ниже корня. */
const CONTRACT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'development',
  'sse-contract.json',
);

/** Путь к контракту для сообщений об ошибке (в виде ссылки на файл). */
const CONTRACT_LABEL = 'docs/development/sse-contract.json';

/** Структура JSON-контракта. */
interface SseContract {
  /** Версия формата: несовместимая правка формата поднимает её. */
  version: number;
  /** Дискриминатор события → имена полей (без самого `type`). */
  events: Record<string, string[]>;
  /** Поля блоков снимка. */
  snapshot: { run: string[]; node: string[] };
}

/** Фактические поля схем — та же структура, что в JSON, без `version`. */
type ActualContract = Omit<SseContract, 'version'>;

/** Разбор одного `shape`: дискриминатор и имена полей. */
interface ShapeView {
  /** Значение литерала `type` (например, `run_started`). */
  readonly type: string;
  /** Имена полей варианта, кроме дискриминатора `type`. */
  readonly fields: string[];
}

/** Кэш контракта: файл читается один раз на прогон spec-файла. */
let contractCache: SseContract | null = null;

/**
 * Читает `shape` Zod-объекта как набор имён полей.
 *
 * Поле `type` в список не попадает: это дискриминатор, его значение обязано
 * совпадать с ключом события в JSON (сверяется отдельно в тесте списка событий).
 *
 * @param shape - форма варианта (`ZodObject.shape`)
 * @returns значение дискриминатора и имена полей
 */
function readShape(shape: object): ShapeView {
  const literal = shape as { type?: { value?: unknown } };
  const value = literal.type?.value;

  return {
    type: typeof value === 'string' ? value : '',
    fields: Object.keys(shape).filter((field) => field !== 'type'),
  };
}

/**
 * Собирает фактические поля из Zod-схем backend.
 *
 * @returns события и блоки снимка в том же виде, что и JSON-контракт
 */
function actualContract(): ActualContract {
  const events: Record<string, string[]> = {};

  for (const option of RunEventSchema.options) {
    const { type, fields } = readShape(option.shape);

    events[type] = fields;
  }

  return {
    events,
    snapshot: {
      run: readShape(SnapshotMessageSchema.shape.run.shape).fields,
      node: readShape(SnapshotMessageSchema.shape.nodes.element.shape).fields,
    },
  };
}

/**
 * Сравнивает поля схемы с полями контракта.
 *
 * @param actual - поля из Zod-схемы
 * @param expected - поля из JSON-контракта
 * @returns добавленные и убранные поля (по одному разу, в порядке появления)
 */
function compareFields(
  actual: readonly string[],
  expected: readonly string[],
): { added: string[]; removed: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  return {
    added: [...actualSet].filter((field) => !expectedSet.has(field)),
    removed: [...expectedSet].filter((field) => !actualSet.has(field)),
  };
}

/**
 * Собирает понятное сообщение о расхождении — с указанием, что именно править.
 *
 * @param target - что сверялось, в кавычках («событие node_failed»,
 *   «snapshot.run»): кавычки снимают вопрос падежа («в «событие …»»)
 * @param diff - добавленные и убранные поля
 * @returns текст ошибки для `expect`
 */
function mismatchMessage(
  target: string,
  diff: { added: string[]; removed: string[] },
): string {
  const actions: string[] = [];

  if (diff.added.length > 0) {
    actions.push(`добавила поле ${diff.added.join(', ')} в ${target}`);
  }

  if (diff.removed.length > 0) {
    actions.push(`убрала поле ${diff.removed.join(', ')} из ${target}`);
  }

  return `Схема backend ${actions.join(' и ')}, но JSON не обновлён: ${CONTRACT_LABEL}`;
}

/**
 * Читает JSON-контракт (результат кэшируется).
 *
 * @returns разобранный контракт
 * @throws SyntaxError если файл не является валидным JSON
 */
async function readContractAsync(): Promise<SseContract> {
  if (contractCache !== null) {
    return contractCache;
  }

  contractCache = JSON.parse(await readFile(CONTRACT_PATH, 'utf8')) as SseContract;

  return contractCache;
}

describe('SSE-контракт: backend DTO ↔ docs/development/sse-contract.json (KI-348)', () => {
  it('версия формата контракта — 1', async () => {
    expect((await readContractAsync()).version).toBe(1);
  });

  it('список событий в JSON совпадает со списком дискриминаторов схем', async () => {
    const contract = await readContractAsync();
    const actual = actualContract();

    // Защита от «пустого» разбора: если `options`/`shape` перестанут читаться,
    // сравнение пустых списков было бы ложно зелёным.
    expect(Object.keys(actual.events)).toHaveLength(RunEventSchema.options.length);
    expect(Object.keys(actual.events).sort()).toEqual(
      Object.keys(contract.events).sort(),
    );
  });

  it('поля каждого события совпадают с JSON-контрактом', async () => {
    const contract = await readContractAsync();
    const actual = actualContract();
    const mismatches: string[] = [];

    for (const [type, fields] of Object.entries(actual.events)) {
      const diff = compareFields(fields, contract.events[type] ?? []);

      if (diff.added.length > 0 || diff.removed.length > 0) {
        mismatches.push(mismatchMessage(`«событие ${type}»`, diff));
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('snapshot.run и snapshot.node совпадают с JSON-контрактом', async () => {
    const contract = await readContractAsync();
    const actual = actualContract();
    const mismatches: string[] = [];

    for (const block of ['run', 'node'] as const) {
      const diff = compareFields(actual.snapshot[block], contract.snapshot[block]);

      if (diff.added.length > 0 || diff.removed.length > 0) {
        mismatches.push(mismatchMessage(`«snapshot.${block}»`, diff));
      }
    }

    // Регрессия KI-347: `error` запуска обязан быть в контракте снимка.
    expect(actual.snapshot.run).toContain('error');
    expect(mismatches).toEqual([]);
  });

  it('гейт ловит добавленное и убранное поле (негативная проверка)', () => {
    expect(compareFields(['runId', 'startedAt'], ['runId', 'startedAt'])).toEqual({
      added: [],
      removed: [],
    });
    // Backend добавил поле в событие, JSON не обновили — гейт обязан упасть.
    expect(
      compareFields(['runId', 'startedAt', 'workflowId'], ['runId', 'startedAt']),
    ).toEqual({ added: ['workflowId'], removed: [] });
    // Backend убрал поле: JSON отстал с другой стороны, сообщение — про убранное.
    expect(compareFields(['runId'], ['runId', 'startedAt'])).toEqual({
      added: [],
      removed: ['startedAt'],
    });
    expect(
      mismatchMessage('«событие run_started»', { added: ['workflowId'], removed: [] }),
    ).toBe(
      'Схема backend добавила поле workflowId в «событие run_started», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
    // Обратное расхождение (JSON отстал) называет убранное поле и предлог «из».
    expect(
      mismatchMessage('«snapshot.run»', { added: [], removed: ['ghost'] }),
    ).toBe(
      'Схема backend убрала поле ghost из «snapshot.run», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
  });
});
