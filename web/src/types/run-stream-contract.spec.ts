/**
 * Паритет-гейт: SSE-зеркало frontend ↔ `docs/development/sse-contract.json` (KI-348).
 *
 * Зеркало `web/src/types/run-stream.ts` синхронизируется вручную, и до этого
 * spec'а расхождение с backend (KI-NEW-B в v0.8.3) валило реальный SSE-поток,
 * оставаясь незамеченным в unit-тестах: состав полей нигде не сверялся.
 *
 * **Процесс (KI-348).** `docs/development/sse-contract.json` — источник правды
 * по составу полей:
 * 1. backend изменил поля события/снимка → падает
 *    `src/runs/dto/sse-contract.spec.ts`;
 * 2. зеркало не подтянуло изменение → падает **этот** spec;
 * 3. правка одного JSON синхронизирует обе стороны — и гейт снова зелёный.
 *
 * Сравниваются **имена** полей (не типы и не проверки): гейт отвечает на вопрос
 * «тот же состав контракта?». Ужесточение проверок зеркала (`z.uuid()` вместо
 * `z.string()`, `durationMs` с `.nonnegative()`) — отдельная задача KI-350.
 *
 * Контракт читается через Vite `import.meta.glob(..., { query: '?raw' })`, а не
 * через `node:fs`: в `web/tsconfig.app.json` стоит `types: ["vite/client"]`,
 * поэтому модули `node:*` не типизированы и `pnpm build` (`tsc -b`) падал бы
 * (ср. `web/src/lib/api-prefixes.spec.ts`). Файл встраивается в тестовый бандл
 * на этапе сборки, поэтому функция синхронная — I/O в рантайме нет (RULES 1.4).
 */
import { describe, expect, it } from 'vitest';
import { RunEventSchema, SnapshotMessageSchema } from './run-stream';

/**
 * Путь к контракту для сообщений об ошибке (в виде ссылки на файл).
 *
 * Сам pattern для `import.meta.glob` задан строковым литералом в коде: Vite
 * разбирает его статически, поэтому переменную туда подставить нельзя.
 */
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

/** Фактические поля зеркала — та же структура, что в JSON, без `version`. */
type ActualContract = Omit<SseContract, 'version'>;

/** Разбор одного `shape`: дискриминатор и имена полей. */
interface ShapeView {
  /** Значение литерала `type` (например, `run_started`). */
  readonly type: string;
  /** Имена полей варианта, кроме дискриминатора `type`. */
  readonly fields: string[];
}

/** Кэш контракта: `import.meta.glob` возвращает текст сразу, разбор — один раз. */
let contractCache: SseContract | null = null;

/**
 * Читает JSON-контракт из тестового бандла.
 *
 * @returns разобранный контракт
 * @throws Error если glob не нашёл файл (тогда spec падает с понятным текстом,
 *   а не с пустым сравнением)
 * @throws SyntaxError если файл не является валидным JSON
 */
function readContract(): SseContract {
  if (contractCache !== null) {
    return contractCache;
  }

  const raw = import.meta.glob('../../../docs/development/sse-contract.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, unknown>;
  const content = Object.values(raw)[0];

  if (typeof content !== 'string' || content.length === 0) {
    throw new Error(
      `Не прочитан ${CONTRACT_LABEL}: проверь pattern import.meta.glob в этом spec'е`,
    );
  }

  contractCache = JSON.parse(content) as SseContract;

  return contractCache;
}

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
 * Собирает фактические поля из Zod-схем зеркала.
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
 * @param actual - поля из Zod-схемы зеркала
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

  return `Схема web-зеркала ${actions.join(' и ')}, но JSON не обновлён: ${CONTRACT_LABEL}`;
}

describe('SSE-контракт: web-зеркало ↔ docs/development/sse-contract.json (KI-348)', () => {
  it('версия формата контракта — 1', () => {
    expect(readContract().version).toBe(1);
  });

  it('список событий в JSON совпадает со списком дискриминаторов зеркала', () => {
    const contract = readContract();
    const actual = actualContract();

    // Защита от «пустого» разбора: если `options`/`shape` перестанут читаться,
    // сравнение пустых списков было бы ложно зелёным.
    expect(Object.keys(actual.events)).toHaveLength(RunEventSchema.options.length);
    expect(Object.keys(actual.events).sort()).toEqual(
      Object.keys(contract.events).sort(),
    );
  });

  it('поля каждого события совпадают с JSON-контрактом', () => {
    const contract = readContract();
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

  it('snapshot.run и snapshot.node совпадают с JSON-контрактом', () => {
    const contract = readContract();
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
    // Backend добавил поле в событие, зеркало и JSON не обновили.
    expect(
      compareFields(['runId', 'startedAt', 'workflowId'], ['runId', 'startedAt']),
    ).toEqual({ added: ['workflowId'], removed: [] });
    // Backend убрал поле: зеркало отстало с другой стороны.
    expect(compareFields(['runId'], ['runId', 'startedAt'])).toEqual({
      added: [],
      removed: ['startedAt'],
    });
    expect(
      mismatchMessage('«событие run_started»', { added: ['workflowId'], removed: [] }),
    ).toBe(
      'Схема web-зеркала добавила поле workflowId в «событие run_started», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
    // Обратное расхождение (JSON отстал) называет убранное поле и предлог «из».
    expect(
      mismatchMessage('«snapshot.run»', { added: [], removed: ['ghost'] }),
    ).toBe(
      'Схема web-зеркала убрала поле ghost из «snapshot.run», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
  });
});
