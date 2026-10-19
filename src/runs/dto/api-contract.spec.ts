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
 * **Enum-домены (KI-440).** Секция `enums` контракта задаёт допустимые значения
 * поля (`<DTO>.<поле>` → отсортированный список): `CollaboratorResponse.role`,
 * `RunResponse.status`, `RunBudgetResponse.mode`. Backend-spec сверяет их с
 * Zod-схемами (`z.enum` из канонического списка ролей/статусов) и с
 * TS-литеральным типом `BudgetMode`; web-spec делает то же со своими
 * Zod-зеркалами. Раньше обе стороны могли разойтись в значениях роли молча —
 * ровно класс KI-437.
 *
 * Сравниваются **имена** полей и **значения** enum-доменов (не типы и не
 * проверки): гейт отвечает на вопрос «тот же состав контракта?». Ужесточение
 * самих схем-зеркал web (`z.uuid()` вместо `z.string()`, `.min(1)` для
 * `ExportWorkflowDto.name` и т.п.) — задача KI-350.
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
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_COLLABORATOR_ROLES,
  WORKFLOW_RUN_STATUSES,
} from '../../db/schema.js';
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

/** Файл с `CollaboratorResponse` (`/workflow/:id/collaborators`, R7.6). */
const COLLABORATOR_DTO_PATH = join(
  SPEC_DIR,
  '..',
  '..',
  'workflow',
  'dto',
  'collaborator.dto.ts',
);

/** Файл с `RunBudgetResponse` (`GET /runs/:id/budget`, R7.1). */
const RUN_BUDGET_DTO_PATH = join(SPEC_DIR, 'run-budget.dto.ts');

/** Файл с TS-типом `BudgetMode` — источник домена `RunBudgetResponse.mode`. */
const COST_BUDGET_SERVICE_PATH = join(SPEC_DIR, '..', 'cost-budget.service.ts');

/** Файл с `DocumentTemplateSummary` (`/workflow/:id/document-templates`, v0.11 S3). */
const DOCUMENT_TEMPLATE_DTO_PATH = join(
  SPEC_DIR,
  '..',
  '..',
  'documents',
  'dto',
  'document-template.dto.ts',
);

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
  // R7.6 (KI-197): участник workflow — новый REST-ответ, зеркало в web —
  // `CollaboratorSchema` (`web/src/types/collaborator.ts`).
  CollaboratorResponse: {
    kind: 'interface',
    path: COLLABORATOR_DTO_PATH,
    label: 'src/workflow/dto/collaborator.dto.ts',
  },
  // v0.11 S3: публичное представление DOCX-шаблона; зеркало в web —
  // `ApiDocumentTemplateSchema` (`web/src/lib/api.ts`).
  DocumentTemplateSummary: {
    kind: 'interface',
    path: DOCUMENT_TEMPLATE_DTO_PATH,
    label: 'src/documents/dto/document-template.dto.ts',
  },
  ExportWorkflowDto: {
    kind: 'zod',
    schema: ExportWorkflowSchema,
    label: 'src/workflow/dto/export-workflow.dto.ts',
  },
};

/**
 * Источник допустимых значений enum-домена (KI-440).
 *
 * - `zod` — домен задан Zod-схемой (`z.enum`): значения берутся из `options`;
 * - `literal-union` — домен задан TS-типом-объединением строковых литералов
 *   (`type BudgetMode = 'hard' | 'soft'`); у типа нет runtime-значения, поэтому
 *   он читается из исходника компилятором TypeScript.
 */
type EnumSource =
  | {
      readonly kind: 'zod';
      readonly schema: { readonly options: readonly string[] };
      readonly label: string;
    }
  | {
      readonly kind: 'literal-union';
      readonly path: string;
      readonly typeName: string;
      readonly label: string;
    };

/**
 * Роли в ответе `GET /workflow/:id/collaborators` (KI-399).
 *
 * `owner` — значение только ответа: владелец не строка
 * `workflow_collaborators` и через инвайт не назначается, поэтому в
 * `WORKFLOW_COLLABORATOR_ROLES` его нет. Домен собирается здесь, а не
 * дублируется литералами: канонический список ролей участия остаётся в
 * `src/db/schema.ts`.
 */
const PARTICIPANT_ROLES = ['owner', ...WORKFLOW_COLLABORATOR_ROLES] as const;

/**
 * Enum-домены, которые обязан кодировать контракт: `<DTO>.<поле>` → источник.
 *
 * Ключи обязаны совпадать с ключами `enums` в JSON (проверяется отдельным
 * тестом). Новое enum-поле ответа добавляется в оба места сразу, иначе гейт
 * упадёт — ровно как со списком полей.
 */
const ENUM_SOURCES: Record<string, EnumSource> = {
  'CollaboratorResponse.role': {
    kind: 'zod',
    schema: z.enum(PARTICIPANT_ROLES),
    label: 'src/db/schema.ts + src/workflow/dto/collaborator.dto.ts',
  },
  // `BudgetMode` — TS-тип без runtime-константы, поэтому читается из исходника.
  'RunBudgetResponse.mode': {
    kind: 'literal-union',
    path: COST_BUDGET_SERVICE_PATH,
    typeName: 'BudgetMode',
    label: 'src/runs/cost-budget.service.ts',
  },
  'RunResponse.status': {
    kind: 'zod',
    schema: z.enum(WORKFLOW_RUN_STATUSES),
    label: 'src/db/schema.ts',
  },
};

/** Структура JSON-контракта. */
interface ApiContract {
  /** Версия формата: несовместимая правка формата поднимает её. */
  version: number;
  /** Имя backend-DTO → отсортированные имена полей ответа. */
  responses: Record<string, string[]>;
  /** `<DTO>.<поле>` → отсортированные допустимые значения (KI-440). */
  enums: Record<string, string[]>;
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
 * Собирает строковые литералы из узла типа.
 *
 * Поддержан только домен, который действительно есть в DTO: объединение
 * строковых литералов (`'hard' | 'soft'`). Всё остальное (ссылки на другие
 * типы, шаблонные литералы) роняет разбор: молча пустой список дал бы ложно
 * зелёный гейт.
 *
 * @param node - узел типа из AST
 * @param typeName - имя типа (для сообщения)
 * @param label - путь к файлу для сообщения об ошибке
 * @returns значения литералов в порядке объявления
 * @throws Error если встретился неподдержанный член объединения
 */
function collectStringLiterals(
  node: ts.TypeNode,
  typeName: string,
  label: string,
): string[] {
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return [node.literal.text];
  }

  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap((child) => collectStringLiterals(child, typeName, label));
  }

  throw new Error(
    `Тип ${typeName} (${label}) содержит не-строковый член: ` +
      'разбор enum-домена в api-contract.spec.ts его не понимает',
  );
}

/**
 * Читает домен из TS-типа-объединения строковых литералов.
 *
 * @param filePath - абсолютный путь к файлу с типом
 * @param typeName - имя типа (например, `BudgetMode`)
 * @param label - путь к файлу для сообщения об ошибке (в виде ссылки на файл)
 * @returns значения литералов
 * @throws Error если тип не найден или содержит не-строковый член
 */
async function readLiteralUnionAsync(
  filePath: string,
  typeName: string,
  label: string,
): Promise<string[]> {
  const source = await readSourceAsync(filePath);

  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== typeName) {
      continue;
    }

    const values = collectStringLiterals(statement.type, typeName, label);

    if (values.length === 0) {
      throw new Error(
        `Тип ${typeName} (${label}) разобран без значений: проверь разбор в api-contract.spec.ts`,
      );
    }

    return values;
  }

  throw new Error(
    `Тип ${typeName} не найден в ${label}: обнови ENUM_SOURCES в api-contract.spec.ts`,
  );
}

/**
 * Читает допустимые значения одного enum-домена — из Zod-схемы либо из
 * TS-типа-объединения.
 *
 * @param key - ключ домена `<DTO>.<поле>`
 * @param source - где домен объявлен и как читать его значения
 * @returns отсортированные значения
 * @throws Error если значения прочитать нельзя (см. {@link readLiteralUnionAsync})
 */
async function readEnumValuesAsync(key: string, source: EnumSource): Promise<string[]> {
  if (source.kind === 'zod') {
    const values = source.schema.options.map(String).sort();

    if (values.length === 0) {
      throw new Error(
        `Enum ${key} (${source.label}) разобран без значений: проверь разбор в api-contract.spec.ts`,
      );
    }

    return values;
  }

  return (await readLiteralUnionAsync(source.path, source.typeName, source.label))
    .slice()
    .sort();
}

/**
 * Собирает фактические enum-домены всех гейтуемых полей.
 *
 * @returns `<DTO>.<поле>` → отсортированные значения (та же структура, что в JSON)
 */
async function actualEnumsAsync(): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    Object.entries(ENUM_SOURCES).map(
      async ([key, source]): Promise<[string, string[]]> => [
        key,
        await readEnumValuesAsync(key, source),
      ],
    ),
  );

  return Object.fromEntries(entries);
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
 * Собирает сообщение о расхождении enum-домена (KI-440).
 *
 * @param key - ключ домена `<DTO>.<поле>` (в кавычках-ёлочках для падежа)
 * @param diff - добавленные и убранные значения
 * @returns текст ошибки для `expect`
 */
function enumMismatchMessage(
  key: string,
  diff: { added: string[]; removed: string[] },
): string {
  const actions: string[] = [];

  if (diff.added.length > 0) {
    actions.push(`добавила значение ${diff.added.join(', ')} в enum «${key}»`);
  }

  if (diff.removed.length > 0) {
    actions.push(`убрала значение ${diff.removed.join(', ')} из enum «${key}»`);
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

  it('список enum-доменов в JSON совпадает со списком, объявленным в коде (KI-440)', async () => {
    const contract = await readContractAsync();
    const actual = await actualEnumsAsync();

    expect(contract.enums).toBeTypeOf('object');
    expect(Object.keys(contract.enums).sort()).toEqual(Object.keys(ENUM_SOURCES).sort());

    // Защита от «пустого» разбора: пустой список значений прошёл бы сравнение
    // с пустым JSON-списком, не поймав ни одного расхождения.
    for (const [key, values] of Object.entries(actual)) {
      expect(values.length, `Enum ${key} разобран без значений`).toBeGreaterThan(0);
    }
  });

  it('значения enum-доменов совпадают с Zod-схемами и TS-типами backend (KI-440)', async () => {
    const contract = await readContractAsync();
    const actual = await actualEnumsAsync();
    const mismatches: string[] = [];

    for (const [key, values] of Object.entries(actual)) {
      const diff = compareFields(values, contract.enums[key] ?? []);

      if (diff.added.length > 0 || diff.removed.length > 0) {
        mismatches.push(enumMismatchMessage(key, diff));
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('enum-домены ссылаются на объявленные поля и отсортированы (KI-440)', async () => {
    const contract = await readContractAsync();

    for (const [key, values] of Object.entries(contract.enums)) {
      const dot = key.indexOf('.');

      expect(dot, `Ключ ${key} должен иметь вид <DTO>.<поле>`).toBeGreaterThan(0);

      const dto = key.slice(0, dot);
      const field = key.slice(dot + 1);

      expect(contract.responses[dto], `DTO ${dto} не объявлен в responses`).toBeDefined();
      expect(contract.responses[dto]).toContain(field);
      expect(values.length, `Enum ${key} пуст`).toBeGreaterThan(0);
      expect(values, `Enum ${key} не отсортирован`).toEqual([...values].sort());
      expect(new Set(values).size, `Enum ${key} содержит дубли`).toBe(values.length);
    }
  });

  it('CollaboratorResponse.role кодирует owner/editor/viewer (регрессия KI-440)', async () => {
    expect((await readContractAsync()).enums['CollaboratorResponse.role']).toEqual([
      'editor',
      'owner',
      'viewer',
    ]);
  });

  it('RunResponse.status и RunBudgetResponse.mode кодируют свои домены (KI-440)', async () => {
    const contract = await readContractAsync();

    expect(contract.enums['RunResponse.status']).toEqual([
      'cancelled',
      'completed',
      'failed',
      'pending',
      'running',
    ]);
    expect(contract.enums['RunBudgetResponse.mode']).toEqual(['hard', 'soft']);
  });

  it('гейт ловит добавленное и убранное значение enum (негативная проверка)', () => {
    expect(compareFields(['editor', 'owner', 'viewer'], ['editor', 'owner', 'viewer'])).toEqual(
      { added: [], removed: [] },
    );
    // Backend добавил роль в ответ, JSON не обновили — гейт обязан упасть.
    expect(compareFields(['editor', 'owner', 'viewer'], ['editor', 'owner'])).toEqual({
      added: ['viewer'],
      removed: [],
    });
    // Backend убрал роль: JSON отстал с другой стороны.
    expect(compareFields(['owner', 'viewer'], ['editor', 'owner', 'viewer'])).toEqual({
      added: [],
      removed: ['editor'],
    });
    expect(
      enumMismatchMessage('CollaboratorResponse.role', {
        added: ['viewer'],
        removed: [],
      }),
    ).toBe(
      'Схема backend добавила значение viewer в enum «CollaboratorResponse.role», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
    expect(
      enumMismatchMessage('CollaboratorResponse.role', {
        added: [],
        removed: ['editor'],
      }),
    ).toBe(
      'Схема backend убрала значение editor из enum «CollaboratorResponse.role», ' +
        `но JSON не обновлён: ${CONTRACT_LABEL}`,
    );
  });

  it('разбор enum падает, если TS-тип переименован или содержит не-литерал', async () => {
    await expect(
      readLiteralUnionAsync(
        COST_BUDGET_SERVICE_PATH,
        'GhostMode',
        'src/runs/cost-budget.service.ts',
      ),
    ).rejects.toThrow(/не найден/);
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
