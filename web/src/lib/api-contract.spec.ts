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
 * `ApiRunBudgetSchema`, `ShareTokenSchema`, `SharedWorkflowSchema`,
 * `ExportWorkflowSchema`). На backend
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
import {
  ApiDocumentTemplateSchema,
  ApiRunBudgetSchema,
  ApiRunSchema,
  McpServersResponseSchema,
  McpServerStatusSchema,
  McpServerSummarySchema,
  McpToolSummarySchema,
  McpTransportSchema,
  RunHistoryResponseSchema,
  RunSummarySchema,
  WebSearchProviderInfoSchema,
  WebSearchProviderNameSchema,
  WebSearchProvidersResponseSchema,
} from './api';
import { CollaboratorSchema } from './collaborators-api';
import { ExportWorkflowSchema } from './export-import-api';
import { ShareTokenSchema, SharedWorkflowSchema } from './share-api';
import { NodeRunSnapshotSchema, RunStatusSchema } from '@/types/run-stream';

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
  // R7.6 (KI-197): участники workflow — новое зеркало REST-ответа.
  CollaboratorResponse: CollaboratorSchema,
  // v0.11 S3: публичное представление DOCX-шаблона (document-templates API).
  DocumentTemplateSummary: ApiDocumentTemplateSchema,
  ExportWorkflowDto: ExportWorkflowSchema,
  // v0.11 S8 (DESIGN § 3.2.6): каталог MCP-серверов для UI agent-узла.
  McpServersResponse: McpServersResponseSchema,
  McpServerSummary: McpServerSummarySchema,
  McpToolSummary: McpToolSummarySchema,
  // v0.11 S12 (DESIGN § 3.4.2): `GET /runs/:id/nodes` отдаёт массив снимков
  // узлов той же Zod-схемой, что и SSE-снимок.
  NodeRunSnapshot: NodeRunSnapshotSchema,
  RunResponse: ApiRunSchema,
  // R7.1 (KI-048): бюджет запуска — новое зеркало REST-ответа.
  RunBudgetResponse: ApiRunBudgetSchema,
  // v0.14 S1 (DESIGN V014 § 3.1): история запусков workflow.
  RunHistoryResponse: RunHistoryResponseSchema,
  RunSummary: RunSummarySchema,
  ShareTokenDto: ShareTokenSchema,
  SharedWorkflow: SharedWorkflowSchema,
  // v0.16 S1 (KI-548): конфигурация web-search для селекта провайдера.
  WebSearchProvidersResponse: WebSearchProvidersResponseSchema,
  WebSearchProviderInfo: WebSearchProviderInfoSchema,
};

/** Структура JSON-контракта. */
interface ApiContract {
  /** Версия формата: несовместимая правка формата поднимает её. */
  version: number;
  /** Имя backend-DTO → отсортированные имена полей ответа. */
  responses: Record<string, string[]>;
  /** `<DTO>.<поле>` → отсортированные допустимые значения (KI-440). */
  enums?: Record<string, string[]>;
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
    // v0.11 S12: узлов в `RunResponse` больше нет (история — отдельная ручка
    // `GET /runs/:id/nodes`), зато добавлен `error` для failed-запуска.
    expect(contract.responses.RunResponse).toEqual([
      'createdAt',
      'error',
      'id',
      'status',
      'workflowId',
    ]);
    expect(actualContract().RunResponse).toEqual(contract.responses.RunResponse);
  });

  it('NodeRunSnapshot зеркалит общую с SSE схему снимка узла (v0.11 S12)', () => {
    const contract = readContract();

    // Один и тот же `NodeRunSnapshotSchema` используется SSE-снимком
    // (`NodeRunSnapshotSchema` в `types/run-stream.ts`) и ответом
    // `GET /runs/:id/nodes`; гейт не даст формату разойтись.
    expect(actualContract().NodeRunSnapshot).toEqual(
      contract.responses.NodeRunSnapshot,
    );
    expect(contract.responses.NodeRunSnapshot).toContain('outputs');
    expect(contract.responses.NodeRunSnapshot).toContain('error');
  });

  it('MCP-каталог зеркалит контракт и не содержит секретов (v0.11 S8)', () => {
    const contract = readContract();
    const actual = actualContract();

    // Три вложенных DTO каталога MCP: поля совпадают с JSON.
    expect(actual.McpServersResponse).toEqual(
      contract.responses.McpServersResponse,
    );
    expect(actual.McpServerSummary).toEqual(
      contract.responses.McpServerSummary,
    );
    expect(actual.McpToolSummary).toEqual(contract.responses.McpToolSummary);

    // URL/заголовки/токены не должны появиться в ответе даже как поля.
    for (const fields of Object.values({
      McpServersResponse: actual.McpServersResponse,
      McpServerSummary: actual.McpServerSummary,
      McpToolSummary: actual.McpToolSummary,
    })) {
      expect(fields).not.toContain('url');
      expect(fields).not.toContain('headers');
      expect(fields).not.toContain('tokenEnv');
    }

    // Enum-домены статуса и транспорта совпадают со своей стороной (KI-440).
    expect([...McpServerStatusSchema.options].sort()).toEqual(
      contract.enums?.['McpServerSummary.status'],
    );
    expect([...McpTransportSchema.options].sort()).toEqual(
      contract.enums?.['McpServerSummary.transport'],
    );
  });

  it('RunHistoryResponse/RunSummary зеркалят контракт и статусы (v0.14 S1)', () => {
    const contract = readContract();
    const actual = actualContract();

    // v0.14 S1: новая ручка `GET /workflow/:id/runs` отдаёт конверт пагинации
    // и лёгкую сводку запуска. v0.16 S1: `runs`, `nextCursor`, `total` (KI-542).
    expect(contract.responses.RunHistoryResponse).toEqual([
      'nextCursor',
      'runs',
      'total',
    ]);
    expect(actual.RunHistoryResponse).toEqual(
      contract.responses.RunHistoryResponse,
    );
    expect(actual.RunSummary).toEqual(contract.responses.RunSummary);

    // v0.16 S1 (KI-542): у элемента есть курсор keyset-пагинации; offset из
    // контракта удалён. Гейт не даст забыть поле на одной из сторон.
    expect(contract.responses.RunSummary).toContain('cursor');
    expect(actual.RunSummary).toContain('cursor');

    // `status` сводки — тот же домен, что у SSE и `RunResponse` (KI-336):
    // история не вводит второй набор значений статусов.
    expect([...RunStatusSchema.options].sort()).toEqual(
      contract.enums?.['RunSummary.status'],
    );
  });

  it('web-search контракт зеркалит поля и домен провайдера (v0.16 S1, KI-548)', () => {
    const contract = readContract();
    const actual = actualContract();

    expect(actual.WebSearchProvidersResponse).toEqual(
      contract.responses.WebSearchProvidersResponse,
    );
    expect(actual.WebSearchProviderInfo).toEqual(
      contract.responses.WebSearchProviderInfo,
    );

    // Ключи/токены не должны появиться в ответе даже как поля.
    for (const fields of [
      actual.WebSearchProvidersResponse,
      actual.WebSearchProviderInfo,
    ]) {
      expect(fields).not.toContain('apiKey');
      expect(fields).not.toContain('token');
    }

    // Один домен у имени провайдера и у дефолта (KI-548).
    expect([...WebSearchProviderNameSchema.options].sort()).toEqual(
      contract.enums?.['WebSearchProviderInfo.name'],
    );
    expect([...WebSearchProviderNameSchema.options].sort()).toEqual(
      contract.enums?.['WebSearchProvidersResponse.defaultProvider'],
    );
  });
});
