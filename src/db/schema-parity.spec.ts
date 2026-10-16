import {
  getTableColumns,
  getTableName,
  is,
  SQL,
  type Column,
} from 'drizzle-orm';
import {
  PgDialect,
  PgNumeric,
  PgTable,
  PgTimestamp,
} from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import * as schema from './schema.js';

/**
 * CI-гейт паритета Drizzle-схемы и фактических колонок PostgreSQL (KI-298).
 *
 * Зачем нужен: `drizzle-kit generate` сверяет `src/db/schema.ts` только со
 * snapshot в `drizzle/meta/`, а не с живой БД. Поэтому любой дрейф
 * «snapshot ↔ фактические колонки» невидим — генератор рапортует
 * «No schema changes». Так в v0.8.0 прошли дрейфы KI-293 (`timestamptz`) и
 * KI-296 (`notNull`). Этот spec читает `information_schema.columns` и падает
 * с человекочитаемым отчётом, если реальный тип / nullable / default
 * колонки расходится с Drizzle-схемой.
 *
 * Запуск: `DATABASE_URL=... pnpm test`. Без `DATABASE_URL` блок целиком
 * пропускается (`describe.skipIf`): Vitest не переносит переменные из `.env`
 * в `process.env`, поэтому локально без явного env spec — skipped.
 */

/** Схема БД, в которой живут таблицы приложения. */
const TABLE_SCHEMA = 'public';

/**
 * Колонки, обязательные к покрытию гейтом (перечислены в задаче KI-298).
 * Фактический список таблиц берётся из `src/db/schema.ts` — новые `pgTable`
 * попадают под гейт автоматически, но эти пять должны присутствовать всегда.
 */
const REQUIRED_TABLE_NAMES = [
  'workflows',
  'workflow_runs',
  'node_runs',
  'users',
  'refresh_tokens',
] as const;

/**
 * Сопоставление `columnType` Drizzle → `information_schema.columns.data_type`.
 *
 * `PgTimestamp` обрабатывается отдельно (тип зависит от `withTimezone`).
 * Если колонка имеет тип вне этой карты, гейт не «молчит», а рапортует
 * расхождение с подсказкой дополнить карту — молчание было бы той же
 * болезнью, что и сам KI-298.
 */
const PG_DATA_TYPE_BY_COLUMN_TYPE: Readonly<Record<string, string>> = {
  PgUUID: 'uuid',
  PgText: 'text',
  PgInteger: 'integer',
  PgJsonb: 'jsonb',
  PgBoolean: 'boolean',
  PgNumeric: 'numeric',
};

/** Строка ответа `information_schema.columns` (только нужные поля). */
type ActualColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

/** Фактическая колонка БД, приведённая к виду, удобному для сверки. */
interface ActualColumn {
  columnName: string;
  dataType: string;
  isNullable: 'YES' | 'NO';
  columnDefault: string | null;
  numericPrecision: number | null;
  numericScale: number | null;
}

/** Ожидание, выведенное из колонки Drizzle-схемы. */
interface ExpectedColumn {
  dataType: string | null;
  unmappedColumnType: string | null;
  notNull: boolean;
  defaultText: string | null;
  defaultNormalized: string | null;
  numericPrecision: number | undefined;
  numericScale: number | undefined;
}

/** Параметры формирования сообщения о дрейфе. */
interface DriftReport {
  table: string;
  /** Имя колонки; `null` — расхождение по таблице целиком (таблицы нет в БД). */
  column: string | null;
  drizzle: string;
  database: string;
  reasons: string[];
  solution: string;
}

/** Таблица схемы, найденная среди экспортов `src/db/schema.ts`. */
interface SchemaTable {
  name: string;
  table: PgTable;
}

/** SQL-запрос фактических колонок приложения. */
const ACTUAL_COLUMNS_QUERY = `
  SELECT table_name, column_name, data_type, is_nullable, column_default,
         numeric_precision, numeric_scale
    FROM information_schema.columns
   WHERE table_schema = $1
   ORDER BY table_name, ordinal_position
`;

/**
 * Собирает все `pgTable` из `src/db/schema.ts`.
 *
 * @returns Отсортированный по имени список таблиц схемы.
 */
function collectSchemaTables(): SchemaTable[] {
  const tables: SchemaTable[] = [];
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      tables.push({ name: getTableName(value), table: value });
    }
  }
  return tables.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Приводит SQL-выражение default к сравнимому виду: срезает явные приведения
 * типов (`::text`, `::jsonb`), внешние кавычки, пробелы и регистр.
 *
 * Нужно потому, что БД хранит default как SQL-текст (`'pending'::text`,
 * `'{}'::jsonb`, `1`), а Drizzle — как JS-значение или SQL-выражение.
 *
 * @param raw — `column_default` из information_schema или рендер Drizzle-SQL.
 * @returns Нормализованное значение для сравнения.
 */
function normalizeDefault(raw: string): string {
  return raw
    .replace(/::[\w\s.]+(\(\d+(,\s*\d+)?\))?/g, '')
    .replace(/^'(.*)'$/s, '$1')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Рендерит JS-значение default в SQL-подобный текст для отчёта.
 *
 * @param value — значение default из Drizzle.
 * @returns Текст для подписи в сообщении о дрейфе.
 */
function renderLiteral(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value) ?? String(value);
}

/**
 * Описывает default колонки для подписи и для сравнения.
 *
 * @param value — `column.default` из Drizzle (`unknown`).
 * @returns Текст для человека и нормализованная строка (`null`, если default нет).
 */
function describeDefault(value: unknown): {
  text: string | null;
  normalized: string | null;
} {
  if (value === undefined || value === null) {
    return { text: null, normalized: null };
  }
  const rendered =
    value instanceof SQL
      ? new PgDialect().sqlToQuery(value).sql
      : renderLiteral(value);
  return { text: rendered, normalized: normalizeDefault(rendered) };
}

/**
 * Строит ожидание колонки из метаданных Drizzle-схемы.
 *
 * @param column — колонка из `getTableColumns(table)`.
 * @returns Ожидаемый тип, обязательность, default и (для numeric) precision/scale.
 */
function buildExpectation(column: Column): ExpectedColumn {
  let dataType: string | null =
    PG_DATA_TYPE_BY_COLUMN_TYPE[column.columnType] ?? null;
  if (column.columnType === 'PgTimestamp') {
    dataType =
      is(column, PgTimestamp) && column.withTimezone
        ? 'timestamp with time zone'
        : 'timestamp without time zone';
  }
  const defaultInfo = describeDefault(column.default);
  const numeric = is(column, PgNumeric) ? column : null;
  return {
    dataType,
    unmappedColumnType: dataType === null ? column.columnType : null,
    notNull: column.notNull,
    defaultText: defaultInfo.text,
    defaultNormalized: defaultInfo.normalized,
    numericPrecision: numeric?.precision,
    numericScale: numeric?.scale,
  };
}

/**
 * Подпись колонки так, как её объявляет Drizzle-схема.
 *
 * @param expected — ожидание из схемы.
 * @returns Строка вида `timestamp with time zone NOT NULL DEFAULT now()`.
 */
function renderDrizzleSignature(expected: ExpectedColumn): string {
  const type = expected.unmappedColumnType
    ? `<нет маппинга для ${expected.unmappedColumnType}>`
    : expected.dataType;
  const nullability = expected.notNull ? 'NOT NULL' : '(nullable)';
  const defaultValue =
    expected.defaultText === null ? '' : ` DEFAULT ${expected.defaultText}`;
  return `${type} ${nullability}${defaultValue}`;
}

/**
 * Подпись колонки так, как её описывает живая БД.
 *
 * @param actual — фактическая колонка из `information_schema.columns`.
 * @returns Строка вида `timestamp without time zone (nullable)`.
 */
function renderDatabaseSignature(actual: ActualColumn): string {
  const nullability = actual.isNullable === 'NO' ? 'NOT NULL' : '(nullable)';
  const defaultValue =
    actual.columnDefault === null ? '' : ` DEFAULT ${actual.columnDefault}`;
  return `${actual.dataType} ${nullability}${defaultValue}`;
}

/**
 * Формирует человекочитаемый блок о дрейфе одной колонки.
 *
 * @param report — параметры расхождения.
 * @returns Многострочное сообщение для `expect(...).toEqual([])`.
 */
function formatDrift(report: DriftReport): string {
  const header =
    report.column === null
      ? `Дрейф схемы: ${report.table} — таблица целиком`
      : `Дрейф схемы: ${report.table}.${report.column}`;
  return [
    header,
    `  Drizzle: ${report.drizzle}`,
    `  БД:      ${report.database}`,
    `  Расхождения: ${report.reasons.join(', ')}`,
    `  Решение: ${report.solution}`,
  ].join('\n');
}

/**
 * Сверяет одну колонку схемы с фактической колонкой БД.
 *
 * @param tableName — имя таблицы.
 * @param columnName — имя колонки в БД (snake_case).
 * @param expected — ожидание, выведенное из Drizzle-схемы.
 * @param actual — фактическая колонка из БД или `undefined`, если её нет.
 * @returns Список сообщений о дрейфе (пустой, если колонка совпала).
 */
function diffColumn(
  tableName: string,
  columnName: string,
  expected: ExpectedColumn,
  actual: ActualColumn | undefined,
): string[] {
  if (actual === undefined) {
    return [
      formatDrift({
        table: tableName,
        column: columnName,
        drizzle: renderDrizzleSignature(expected),
        database: '—',
        reasons: ['колонка отсутствует в БД'],
        solution: 'pnpm db:generate; применить миграцию',
      }),
    ];
  }
  const reasons: string[] = [];
  if (expected.unmappedColumnType !== null) {
    reasons.push(
      `тип Drizzle '${expected.unmappedColumnType}' не сопоставлен с data_type`,
    );
  } else if (expected.dataType !== actual.dataType) {
    reasons.push(`тип: '${expected.dataType}' ≠ '${actual.dataType}'`);
  }
  const expectedNullable = expected.notNull ? 'NO' : 'YES';
  if (expectedNullable !== actual.isNullable) {
    reasons.push(
      expected.notNull
        ? 'в БД колонка nullable, в схеме NOT NULL'
        : 'в схеме nullable, в БД NOT NULL',
    );
  }
  const actualNormalized =
    actual.columnDefault === null
      ? null
      : normalizeDefault(actual.columnDefault);
  if (expected.defaultText === null && actual.columnDefault !== null) {
    reasons.push(`лишний default в БД: ${actual.columnDefault}`);
  } else if (expected.defaultText !== null && actual.columnDefault === null) {
    reasons.push(
      `default отсутствует в БД (в схеме — ${expected.defaultText})`,
    );
  } else if (
    expected.defaultText !== null &&
    expected.defaultNormalized !== actualNormalized
  ) {
    reasons.push(
      `default: ${expected.defaultText} ≠ ${actual.columnDefault ?? '—'}`,
    );
  }
  if (
    expected.numericPrecision !== undefined ||
    expected.numericScale !== undefined
  ) {
    const expectedShape = `${expected.numericPrecision ?? '—'},${expected.numericScale ?? '—'}`;
    const actualShape = `${actual.numericPrecision ?? '—'},${actual.numericScale ?? '—'}`;
    if (expectedShape !== actualShape) {
      reasons.push(`precision/scale: '${expectedShape}' ≠ '${actualShape}'`);
    }
  }
  if (reasons.length === 0) {
    return [];
  }
  return [
    formatDrift({
      table: tableName,
      column: columnName,
      drizzle: renderDrizzleSignature(expected),
      database: renderDatabaseSignature(actual),
      reasons,
      solution: 'pnpm db:generate; применить миграцию',
    }),
  ];
}

/**
 * Сверяет одну таблицу схемы с фактическими колонками БД.
 *
 * @param schemaTable — таблица из `src/db/schema.ts`.
 * @param actualByTable — карта фактических колонок БД по имени таблицы.
 * @returns Список сообщений о дрейфе (пустой, если таблица совпала).
 */
function diffTable(
  schemaTable: SchemaTable,
  actualByTable: Map<string, ActualColumn[]>,
): string[] {
  const actualColumns = actualByTable.get(schemaTable.name) ?? [];
  if (actualColumns.length === 0) {
    return [
      formatDrift({
        table: schemaTable.name,
        column: null,
        drizzle: 'таблица объявлена в src/db/schema.ts',
        database: '—',
        reasons: ['таблица отсутствует в БД'],
        solution: 'pnpm db:generate; применить миграцию',
      }),
    ];
  }
  const actualByName = new Map(
    actualColumns.map((column) => [column.columnName, column]),
  );
  const drift: string[] = [];
  for (const column of Object.values(getTableColumns(schemaTable.table))) {
    const expected = buildExpectation(column);
    const actual = actualByName.get(column.name);
    actualByName.delete(column.name);
    drift.push(...diffColumn(schemaTable.name, column.name, expected, actual));
  }
  for (const extra of actualByName.values()) {
    drift.push(
      formatDrift({
        table: schemaTable.name,
        column: extra.columnName,
        drizzle: '—',
        database: renderDatabaseSignature(extra),
        reasons: ['колонка отсутствует в Drizzle-схеме'],
        solution:
          'добавить колонку в src/db/schema.ts (или удалить её из БД) и выполнить pnpm db:generate',
      }),
    );
  }
  return drift;
}

/**
 * Читает фактические колонки приложения из `information_schema.columns`.
 *
 * @param client — подключённый клиент `pg` (одно соединение, без пула).
 * @returns Карта «имя таблицы → список колонок».
 * @throws {Error} Если запрос к `information_schema` не выполнился.
 */
async function loadActualColumnsAsync(
  client: Client,
): Promise<Map<string, ActualColumn[]>> {
  const result = await client.query<ActualColumnRow>(ACTUAL_COLUMNS_QUERY, [
    TABLE_SCHEMA,
  ]);
  const byTable = new Map<string, ActualColumn[]>();
  for (const row of result.rows) {
    const columns = byTable.get(row.table_name) ?? [];
    columns.push({
      columnName: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable === 'NO' ? 'NO' : 'YES',
      columnDefault: row.column_default,
      numericPrecision: row.numeric_precision,
      numericScale: row.numeric_scale,
    });
    byTable.set(row.table_name, columns);
  }
  return byTable;
}

/** Таблицы, объявленные в `src/db/schema.ts`. */
const schemaTables = collectSchemaTables();

/** Подключение к БД и снимок фактических колонок (заполняются в `beforeAll`). */
let client: Client | undefined;
let actualColumnsByTable = new Map<string, ActualColumn[]>();

describe.skipIf(!process.env.DATABASE_URL)(
  'Паритет Drizzle-схемы и колонок Postgres (KI-298)',
  () => {
    beforeAll(async () => {
      const url = process.env.DATABASE_URL;
      if (!url) {
        // Недостижимо: describe пропускается через skipIf. Страховка от регрессии гейта.
        throw new Error(
          'DATABASE_URL не задан — паритет схемы проверить нельзя',
        );
      }
      client = new Client({
        connectionString: url,
        connectionTimeoutMillis: 5_000,
        application_name: 'schema-parity-spec',
      });
      await client.connect();
      actualColumnsByTable = await loadActualColumnsAsync(client);
    }, 30_000);

    afterAll(async () => {
      if (client !== undefined) {
        await client.end();
        client = undefined;
      }
    });

    it('объявляет в схеме все обязательные таблицы KI-298', () => {
      expect(schemaTables.map((table) => table.name)).toEqual(
        expect.arrayContaining([...REQUIRED_TABLE_NAMES]),
      );
    });

    for (const schemaTable of schemaTables) {
      it(`таблица ${schemaTable.name}: колонки, типы и default совпадают с БД`, () => {
        expect(diffTable(schemaTable, actualColumnsByTable)).toEqual([]);
      });
    }
  },
);
