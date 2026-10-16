/**
 * Паритет-гейт: REST-зеркала frontend ↔ `docs/development/api-contract.json` (KI-352).
 *
 * KI-352: `web/src/lib/api.ts` вручную повторял backend `RunResponse` (это было
 * записано и в JSDoc `ApiRunSchema`), но состав полей нигде не сверялся. Здесь
 * тот же приём, что в `web/src/types/run-stream-contract.spec.ts` (KI-348), но
 * для REST-ответов.
 *
 * **Процесс (KI-352).** `docs/development/api-contract.json` — источник правды
 * по составу полей REST-ответов:
 * 1. backend изменил DTO ответа → падает
 *    `src/runs/dto/api-contract.spec.ts`;
 * 2. зеркало не подтянуло изменение (или подтянуло раньше) → падает **этот**
 *    spec;
 * 3. правка одного JSON синхронизирует обе стороны — и гейт снова зелёный.
 *
 * Состав полей берётся из `ZodObject.shape` зеркал (`ApiRunSchema`,
 * `ShareTokenSchema`, `SharedWorkflowSchema`, `ExportWorkflowSchema`). На backend
 * Zod-схемой описан только `ExportWorkflowDto`; у остальных ответов там
 * TS-интерфейсы, поэтому backend-гейт читает их поля компилятором TypeScript —
 * состав контракта от этого не меняется, меняется только способ разбора.
 * Сравниваются **имена** полей (не типы и не проверки): гейт отвечает на вопрос
 * «тот же состав контракта?». Ужесточение самих зеркал (`z.uuid()` вместо
 * `z.string()`, `.min(1)` для `ExportWorkflowDto.name` и т.п.) — задача KI-350.
 *
 * Контракт читается через Vite `import.meta.glob(..., { query: '?raw' })`, а не
 * через `node:fs`: в `web/tsconfig.app.json` стоит `types: ["vite/client"]`,
 * поэтому модули `node:*` не типизированы и `pnpm build` (`tsc -b`) падал бы
 * (ср. `web/src/types/run-stream-contract.spec.ts`). Файл встраивается в
 * тестовый бандл на этапе сборки, поэтому функция синхронная — I/O в рантайме
 * нет (RULES 1.4).
 */
import { describe, expect, it } from 'vitest';
import { ApiRunSchema } from './api';
import { ExportWorkflowSchema } from './export-import-api';
import { ShareTokenSchema, SharedWorkflowSchema } from './share-api';

/**
 * Путь к контракту для сообщений об ошибке (в виде ссылки на файл).
 *
 * Сам pattern для `import.meta.glob` задан строковым литералом в коде: Vite
 * разбирает его статически, поэтому переменную туда подставить нельзя.
 */
const CONTRACT_LABEL = 'docs/development/api-contract.json';

/** Схема-зеркало: для сверки состава полей достаточно `.shape`. */
interface MirrorSchema {
  /** Форма Zod-объекта: имя поля → Zod-тип. */
  readonly shape: object;
}

/**
 * Зеркала REST-ответов: имя backend-DTO → Zod-схема web.
 *
 * Ключи обязаны совпадать с ключами `responses` в JSON-контракте (проверяется
 * отдельным тестом).
 *
 * Вне гейта осознанно остались: `ApiWorkflowSchema` (backend-зеркало — строка
 * Drizzle-таблицы `workflows`, а не DTO ответа; состав расходится на
 * `shareToken`, KI-356), `ApiNodeSchema`/`ApiEdgeSchema` (внутренние DTO движка,
 * не REST-ответы, KI-357), `TemplateSummarySchema` (backend-зеркало лежит в
 * `src/templates/dto` — вне read-scope KI-352, KI-357),
 * `LlmModelInfoSchema`/`MediaModelInfoSchema` (зеркала backend лежат в
 * `src/llm/**` и `src/media/**` — вне scope KI-352, KI-357).
 */
const MIRROR_SCHEMAS: Record<string, MirrorSchema> = {
  ExportWorkflowDto: ExportWorkflowSchema,
  RunResponse: ApiRunSchema,
  ShareTokenDto: ShareTokenSchema,
  SharedWorkflow: SharedWorkflowSchema,
};

/** Структура JSON-контракта. */
interface ApiContract {
  /** Версия формата: несовместимая правка формата поднимает её. */
  version: number;
  /** Имя backend-DTO → отсортированные имена полей ответа. */
  responses: Record<string, string[]>;
}

/** Кэш контракта: `import.meta.glob` возвращает текст сразу, разбор — один раз. */
let contractCache: ApiContract | null = null;

/**
 * Читает JSON-контракт из тестового бандла.
 *
 * @returns разобранный контракт
 * @throws Error если glob не нашёл файл (тогда spec падает с понятным текстом,
 *   а не с пустым сравнением)
 * @throws SyntaxError если файл не является валидным JSON
 */
function readContract(): ApiContract {
  if (contractCache !== null) {
    return contractCache;
  }

  const raw = import.meta.glob('../../../docs/development/api-contract.json', {
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

  contractCache = JSON.parse(content) as ApiContract;

  return contractCache;
}

/**
 * Собирает фактические поля всех зеркал.
 *
 * @returns имя DTO → отсортированные имена полей (та же структура, что в JSON)
 */
function actualContract(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(MIRROR_SCHEMAS).map(([name, schema]) => [
      name,
      Object.keys(schema.shape).sort(),
    ]),
  );
}

/**
 * Сравнивает поля схемы-зеркала с полями контракта.
 *
 * @param actual - поля из Zod-схемы web
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
 * @param target - что сверялось, в кавычках («ответ RunResponse»): кавычки
 *   снимают вопрос падежа («в «ответ …»»)
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

describe('REST-контракт: web-зеркала ↔ docs/development/api-contract.json (KI-352)', () => {
  it('версия формата контракта — 1', () => {
    expect(readContract().version).toBe(1);
  });

  it('список DTO в JSON совпадает со списком зеркал', () => {
    const contract = readContract();
    const actual = actualContract();

    expect(Object.keys(contract.responses).sort()).toEqual(Object.keys(MIRROR_SCHEMAS).sort());

    // Защита от «пустого» разбора: если `shape` перестанет читаться, сравнение
    // пустых списков было бы ложно зелёным.
    for (const [name, fields] of Object.entries(actual)) {
      expect(fields.length, `Зеркало ${name} разобрано без полей`).toBeGreaterThan(0);
    }
  });

  it('поля каждого зеркала совпадают с JSON-контрактом', () => {
    const contract = readContract();
    const actual = actualContract();
    const mismatches: string[] = [];

    for (const [name, fields] of Object.entries(actual)) {
      const diff = compareFields(fields, contract.responses[name] ?? []);

      if (diff.added.length > 0 || diff.removed.length > 0) {
        mismatches.push(mismatchMessage(`«ответ ${name}»`, diff));
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('гейт ловит добавленное и убранное поле (негативная проверка)', () => {
    expect(compareFields(['createdAt', 'id'], ['createdAt', 'id'])).toEqual({
      added: [],
      removed: [],
    });
    // Web добавил поле в зеркало, JSON не обновили — гейт обязан упасть.
    expect(compareFields(['createdAt', 'id', 'workflowId'], ['createdAt', 'id'])).toEqual({
      added: ['workflowId'],
      removed: [],
    });
    // Web убрал поле: JSON отстал с другой стороны, сообщение — про убранное.
    expect(compareFields(['createdAt'], ['createdAt', 'id'])).toEqual({
      added: [],
      removed: ['id'],
    });
    expect(
      mismatchMessage('«ответ RunResponse»', { added: ['workflowId'], removed: [] }),
    ).toBe(
      'Схема web-зеркала добавила поле workflowId в «ответ RunResponse», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
    // Обратное расхождение (JSON отстал) называет убранное поле и предлог «из».
    expect(mismatchMessage('«ответ RunResponse»', { added: [], removed: ['ghost'] })).toBe(
      'Схема web-зеркала убрала поле ghost из «ответ RunResponse», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
  });

  it('RunResponse описан в контракте и зеркалится ApiRunSchema (регрессия KI-352)', () => {
    const contract = readContract();

    // KI-352: именно эта пара (backend `RunResponse` ↔ `ApiRunSchema`) раньше
    // расходилась молча — поле обязано быть в контракте и в зеркале.
    expect(contract.responses.RunResponse).toEqual(['createdAt', 'id', 'status', 'workflowId']);
    expect(actualContract().RunResponse).toEqual(contract.responses.RunResponse);
  });
});
