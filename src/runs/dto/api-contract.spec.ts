/**
 * Паритет-гейт: REST-ответы backend ↔ `docs/development/api-contract.json` (KI-352).
 *
 * KI-352: `web/src/lib/api.ts` вручную повторял backend `RunResponse` (это было
 * записано и в JSDoc `ApiRunSchema`), но состав полей нигде не сверялся —
 * расхождение не роняло ни один spec. Здесь тот же приём, что в
 * `src/runs/dto/sse-contract.spec.ts` (KI-348), но применённый к REST-ответам.
 *
 * **Процесс (KI-352).** `docs/development/api-contract.json` — источник правды
 * по составу полей REST-ответов:
 * 1. backend изменил DTO ответа → падает **этот** spec;
 * 2. web не подтянул изменение (или подтянул раньше) → падает
 *    `web/src/lib/api-contract.spec.ts`;
 * 3. правка одного JSON синхронизирует обе стороны — и гейт снова зелёный.
 *
 * **Два источника полей на backend.** Там, где DTO ответа описан Zod-схемой
 * (`ExportWorkflowDto`), поля читаются из `ZodObject.shape` — ровно как в
 * SSE-гейте. Остальные четыре ответа Zod-схем не имеют: `RunResponse` — TS-интерфейс
 * в `src/runs/runs.service.ts`, `RunBudgetResponse` — TS-интерфейс в
 * `src/runs/dto/run-budget.dto.ts` (R7.1, KI-048), `ShareTokenDto` и
 * `SharedWorkflow` — TS-интерфейсы
 * в `src/workflow/dto/share-workflow.dto.ts` (у интерфейса нет runtime-состава).
 * Для них имена полей читаются из исходника компилятором TypeScript (`ts`), а не
 * гадаются регуляркой; появление Zod-схем ответов — отдельная задача (KI-358).
 *
 * Сравниваются **имена** полей (не типы и не проверки): гейт отвечает на вопрос
 * «тот же состав контракта?». Ужесточение самих схем-зеркал web (`z.uuid()`
 * вместо `z.string()`, `.min(1)` для `ExportWorkflowDto.name` и т.п.) — задача
 * KI-350.
 *
 * Путь к JSON и к исходникам строится от `import.meta.url`, а не от
 * `process.cwd()`: иначе spec зависел бы от каталога запуска (RULES 1.9, ср.
 * `sse-contract.spec.ts`). Разбор интерфейсов падает с понятным сообщением,
 * если интерфейс переименован/перенесён или наследует поля, — ложного зелёного
 * на пустом списке не будет.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ExportWorkflowSchema } from '../../workflow/dto/export-workflow.dto.js';

/** Каталог этого spec'а (`src/runs/dto`). */
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));

/** Абсолютный путь к контракту: spec лежит тремя уровнями ниже корня. */
const CONTRACT_PATH = join(
  SPEC_DIR,
  '..',
  '..',
  '..',
  'docs',
  'development',
  'api-contract.json',
);

/** Путь к контракту для сообщений об ошибке (в виде ссылки на файл). */
const CONTRACT_LABEL = 'docs/development/api-contract.json';

/** Файл с `RunResponse` (`POST /runs`, `GET /runs/:id`). */
const RUNS_SERVICE_PATH = join(SPEC_DIR, '..', 'runs.service.ts');

/** Файл с `ShareTokenDto` и `SharedWorkflow` (`/workflow/:id/share`, `/workflow/share/:token`). */
const SHARE_DTO_PATH = join(SPEC_DIR, '..', '..', 'workflow', 'dto', 'share-workflow.dto.ts');

/** Файл с `RunBudgetResponse` (`GET /runs/:id/budget`, R7.1). */
const RUN_BUDGET_DTO_PATH = join(SPEC_DIR, 'run-budget.dto.ts');

/**
 * Где объявлен DTO ответа и как из него читать поля.
 *
 * - `zod` — DTO описан Zod-схемой: поля берутся из `shape` (как в SSE-гейте);
 * - `interface` — DTO описан TS-интерфейсом (Zod-схемы нет): поля читаются из
 *   исходника компилятором TypeScript.
 */
type DtoSource =
  | { readonly kind: 'zod'; readonly schema: { readonly shape: object }; readonly label: string }
  | { readonly kind: 'interface'; readonly path: string; readonly label: string };

/**
 * Известные гейту DTO ответов: имя DTO → где он объявлен.
 *
 * Ключи обязаны совпадать с ключами `responses` в JSON-контракте (проверяется
 * отдельным тестом) — новый REST-ответ добавляется в оба места сразу.
 *
 * Вне гейта осознанно остались: `Workflow` (ответ `GET /workflow` — это строка
 * Drizzle-таблицы `workflows`, а не DTO; состав полей расходится с web-зеркалом
 * на `shareToken`, KI-356), `NodeSchema`/`EdgeSchema` (внутренние DTO движка,
 * не REST-ответы, KI-357), `TemplateSummary` (`src/templates/dto` — вне
 * read-scope KI-352, KI-357), `LlmModelInfo`/`MediaModelInfo` (зеркала живут в
 * `src/llm/**` и `src/media/**` — вне scope KI-352, KI-357).
 */const DTO_SOURCES: Record<string, DtoSource> = {
  RunResponse: {
    kind: 'interface',
    path: RUNS_SERVICE_PATH,
    label: 'src/runs/runs.service.ts',
  },
  // R7.1 (KI-048): бюджет запуска — отдельный REST-ответ, зеркало в web —
  // `ApiRunBudgetSchema` (`web/src/lib/api.ts`).
  RunBudgetResponse: {
    kind: 'interface',
    path: RUN_BUDGET_DTO_PATH,
    label: 'src/runs/dto/run-budget.dto.ts',
  },
  ShareTokenDto: {
    kind: 'interface',
    path: SHARE_DTO_PATH,
    label: 'src/workflow/dto/share-workflow.dto.ts',
  },
  SharedWorkflow: {
    kind: 'interface',
    path: SHARE_DTO_PATH,
    label: 'src/workflow/dto/share-workflow.dto.ts',
  },
  ExportWorkflowDto: {
    kind: 'zod',
    schema: ExportWorkflowSchema,
    label: 'src/workflow/dto/export-workflow.dto.ts',
  },
};

/** Структура JSON-контракта. */
interface ApiContract {
  /** Версия формата: несовместимая правка формата поднимает её. */
  version: number;
  /** Имя backend-DTO → отсортированные имена полей ответа. */
  responses: Record<string, string[]>;
}

/** Кэш разобранных исходников: один файл читается один раз на прогон spec-файла. */
const sourceCache = new Map<string, ts.SourceFile>();

/** Кэш контракта: файл читается один раз на прогон spec-файла. */
let contractCache: ApiContract | null = null;

/**
 * Читает и разбирает исходник (результат кэшируется по пути).
 *
 * @param filePath - абсолютный путь к `.ts`-файлу
 * @returns разобранный `SourceFile` вместе с узлами
 * @throws Error если файл недоступен
 */
async function readSourceAsync(filePath: string): Promise<ts.SourceFile> {
  const cached = sourceCache.get(filePath);

  if (cached !== undefined) {
    return cached;
  }

  const source = ts.createSourceFile(
    filePath,
    await readFile(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  sourceCache.set(filePath, source);

  return source;
}

/**
 * Читает имена полей TS-интерфейса из исходника.
 *
 * Заменяет `ZodObject.shape` там, где Zod-схемы у ответа нет (см. JSDoc файла).
 * Наследование полей и нестандартные члены (индексные сигнатуры, методы)
 * намеренно роняют разбор: молча неполный список полей дал бы ложно зелёный
 * гейт.
 *
 * @param filePath - абсолютный путь к файлу с интерфейсом
 * @param interfaceName - имя интерфейса (например, `RunResponse`)
 * @param label - путь к файлу для сообщения об ошибке (в виде ссылки на файл)
 * @returns имена полей в порядке объявления
 * @throws Error если интерфейс не найден, наследует поля, содержит неподдержанный
 *   член или объявлен без полей
 */
async function readInterfaceFieldsAsync(
  filePath: string,
  interfaceName: string,
  label: string,
): Promise<string[]> {
  const source = await readSourceAsync(filePath);

  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== interfaceName) {
      continue;
    }

    if (statement.heritageClauses !== undefined && statement.heritageClauses.length > 0) {
      throw new Error(
        `Интерфейс ${interfaceName} (${label}) наследует поля: разбор в api-contract.spec.ts неполон — перечисли поля явно`,
      );
    }

    const fields = statement.members.map((member) => {
      if (ts.isPropertySignature(member) && member.name !== undefined && ts.isIdentifier(member.name)) {
        return member.name.text;
      }

      throw new Error(
        `Интерфейс ${interfaceName} (${label}) содержит член не-свойство: разбор в api-contract.spec.ts его не понимает`,
      );
    });

    if (fields.length === 0) {
      throw new Error(
        `Интерфейс ${interfaceName} (${label}) разобран без полей: проверь разбор в api-contract.spec.ts`,
      );
    }

    return fields;
  }

  throw new Error(
    `Интерфейс ${interfaceName} не найден в ${label}: обнови DTO_SOURCES в api-contract.spec.ts`,
  );
}

/**
 * Читает имена полей одного DTO ответа — из Zod-схемы либо из TS-интерфейса.
 *
 * @param name - имя DTO (ключ контракта)
 * @param source - где DTO объявлен и как читать его поля
 * @returns отсортированные имена полей
 * @throws Error если состав полей прочитать нельзя (см. {@link readInterfaceFieldsAsync})
 */
async function readFieldsAsync(name: string, source: DtoSource): Promise<string[]> {
  if (source.kind === 'zod') {
    const fields = Object.keys(source.schema.shape).sort();

    if (fields.length === 0) {
      throw new Error(
        `Схема ${name} (${source.label}) разобрана без полей: проверь разбор в api-contract.spec.ts`,
      );
    }

    return fields;
  }

  return (await readInterfaceFieldsAsync(source.path, name, source.label)).slice().sort();
}

/**
 * Собирает фактические поля всех гейтуемых DTO.
 *
 * @returns имя DTO → отсортированные имена полей (та же структура, что в JSON)
 */
async function actualContractAsync(): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    Object.entries(DTO_SOURCES).map(
      async ([name, source]): Promise<[string, string[]]> => [
        name,
        await readFieldsAsync(name, source),
      ],
    ),
  );

  return Object.fromEntries(entries);
}

/**
 * Сравнивает поля схемы с полями контракта.
 *
 * @param actual - поля из backend-DTO
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

  return `Схема backend ${actions.join(' и ')}, но JSON не обновлён: ${CONTRACT_LABEL}`;
}

/**
 * Читает JSON-контракт (результат кэшируется).
 *
 * @returns разобранный контракт
 * @throws SyntaxError если файл не является валидным JSON
 */
async function readContractAsync(): Promise<ApiContract> {
  if (contractCache !== null) {
    return contractCache;
  }

  contractCache = JSON.parse(await readFile(CONTRACT_PATH, 'utf8')) as ApiContract;

  return contractCache;
}

describe('REST-контракт: backend DTO ↔ docs/development/api-contract.json (KI-352)', () => {
  it('версия формата контракта — 1', async () => {
    expect((await readContractAsync()).version).toBe(1);
  });

  it('список DTO в JSON совпадает со списком DTO, объявленных в коде', async () => {
    const contract = await readContractAsync();
    const actual = await actualContractAsync();

    expect(Object.keys(contract.responses).sort()).toEqual(Object.keys(DTO_SOURCES).sort());

    // Защита от «пустого» разбора: если схема/интерфейс перестанет читаться,
    // сравнение пустых списков было бы ложно зелёным (см. readFieldsAsync).
    for (const [name, fields] of Object.entries(actual)) {
      expect(fields.length, `DTO ${name} разобран без полей`).toBeGreaterThan(0);
    }
  });

  it('поля каждого DTO совпадают с JSON-контрактом', async () => {
    const contract = await readContractAsync();
    const actual = await actualContractAsync();
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
    // Backend добавил поле в ответ, JSON не обновили — гейт обязан упасть.
    expect(compareFields(['createdAt', 'id', 'workflowId'], ['createdAt', 'id'])).toEqual({
      added: ['workflowId'],
      removed: [],
    });
    // Backend убрал поле: JSON отстал с другой стороны, сообщение — про убранное.
    expect(compareFields(['createdAt'], ['createdAt', 'id'])).toEqual({
      added: [],
      removed: ['id'],
    });
    expect(
      mismatchMessage('«ответ RunResponse»', { added: ['workflowId'], removed: [] }),
    ).toBe(
      'Схема backend добавила поле workflowId в «ответ RunResponse», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
    // Обратное расхождение (JSON отстал) называет убранное поле и предлог «из».
    expect(mismatchMessage('«ответ RunResponse»', { added: [], removed: ['ghost'] })).toBe(
      'Схема backend убрала поле ghost из «ответ RunResponse», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
  });

  it('разбор падает, если интерфейс переименован или перенесён (защита от ложного зелёного)', async () => {
    await expect(
      readInterfaceFieldsAsync(RUNS_SERVICE_PATH, 'GhostResponse', 'src/runs/runs.service.ts'),
    ).rejects.toThrow(/не найден/);
  });
});
