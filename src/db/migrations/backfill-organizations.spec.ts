import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from '../../auth/auth.constants.js';
import {
  DEMO_ORGANIZATION_NAME,
  backfillOrganizationsAsync,
} from './backfill-organizations.js';

/**
 * Интеграционный тест backfill'а арендаторов (v1.0 S1, DESIGN § 3.1).
 *
 * Запускается только при заданном `DATABASE_URL` (как
 * `schema-parity.spec.ts`): без живой БД проверять нечего. Тест **не трогает
 * `public`**: каждая сцена создаёт собственную схему `scratch_*`, переключает
 * `search_path` и работает только внутри неё. Всё выполняется в одной
 * транзакции, которая в `afterAll` откатывается, а схемы удаляются
 * дополнительно — даже если тест упал, в БД не остаётся мусора и блокировок на
 * таблицах приложения.
 *
 * Проверяется: создание персональных организаций (включая детерминированную
 * демо-организацию), привязка пользователей и наследование организации
 * workflow от владельца, идемпотентность повторного прогона, включение NOT NULL
 * и штатный проход на пустых таблицах.
 */

/** Строка выборки организаций. */
type OrganizationRow = { id: string; name: string };

/** Строка выборки пользователей с именем организации. */
type UserWithOrganizationRow = {
  id: string;
  email: string;
  organization_id: string;
  org_name: string;
};

/** Строка `information_schema.columns` по `organization_id`. */
type OrganizationColumnRow = { table_name: string; is_nullable: string };

/**
 * Создаёт пустую scratch-схему и минимальные таблицы приложения.
 *
 * Минимальные таблицы повторяют форму реальных (`organization_id` — nullable,
 * потому что ровно такой её оставляет миграция 0014), но без CHECK/FK:
 * backfill'у нужны только имена колонок и последовательность шагов.
 *
 * @param client - клиент `pg` внутри уже открытой транзакции.
 * @returns Имя созданной схемы (для проверок и уборки).
 * @throws {Error} Если DDL не выполнился.
 */
async function createScratchSchemaAsync(client: Client): Promise<string> {
  const schemaName = `scratch_organizations_${randomUUID().replaceAll('-', '')}`;

  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET LOCAL search_path TO "${schemaName}"`);
  await client.query(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE users (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      organization_id uuid
    )
  `);
  await client.query(`
    CREATE TABLE workflows (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      organization_id uuid
    )
  `);

  return schemaName;
}

/**
 * Читает организации текущей scratch-схемы.
 *
 * @param client - клиент `pg`.
 * @returns Строки организаций, отсортированные по имени.
 * @throws {Error} Если запрос не выполнился.
 */
async function selectOrganizationsAsync(
  client: Client,
): Promise<OrganizationRow[]> {
  const result = await client.query<OrganizationRow>(
    'SELECT id, name FROM organizations ORDER BY name',
  );

  return result.rows;
}

describe.skipIf(!process.env.DATABASE_URL)(
  'Backfill организаций (v1.0 S1)',
  () => {
    let client: Client | undefined;
    /** Схемы, созданные в транзакции (для дополнительной уборки в afterAll). */
    const scratchSchemas: string[] = [];
    /** Снимок организаций после первого прогона — для проверки идемпотентности. */
    let organizationsAfterFirstRun: OrganizationRow[] = [];

    beforeAll(async () => {
      const url = process.env.DATABASE_URL;

      if (!url) {
        throw new Error('DATABASE_URL не задан — интеграционный тест пропущен');
      }

      client = new Client({
        connectionString: url,
        connectionTimeoutMillis: 5_000,
        application_name: 'backfill-organizations-spec',
      });
      await client.connect();
      // Одна транзакция на весь spec: DDL и ALTER TABLE SET NOT NULL откатятся
      // в afterAll, public-таблицы не блокируются.
      await client.query('BEGIN');
    }, 30_000);

    afterAll(async () => {
      if (client === undefined) {
        return;
      }

      // Откат убирает таблицы и схемы, созданные внутри транзакции.
      try {
        await client.query('ROLLBACK');
      } catch {
        // Соединение могло разорваться — уборка ниже всё равно выполнится.
      }

      for (const schemaName of scratchSchemas) {
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        } catch {
          // Схемы уже нет после отката — это штатный случай.
        }
      }

      await client.end();
      client = undefined;
    });

    it('создаёт организации и назначает их пользователям и workflow', async () => {
      const databaseClient = client;

      if (!databaseClient) {
        throw new Error('клиент БД не инициализирован');
      }

      scratchSchemas.push(await createScratchSchemaAsync(databaseClient));

      const aliceId = randomUUID();
      const bobId = randomUUID();
      const demoWorkflowId = randomUUID();
      const aliceWorkflowId = randomUUID();
      const bobWorkflowId = randomUUID();

      await databaseClient.query(
        `INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4), ($5, $6)`,
        [
          DEMO_USER_ID,
          DEMO_USER_EMAIL,
          aliceId,
          'alice@example.com',
          bobId,
          'bob@example.com',
        ],
      );
      await databaseClient.query(
        `INSERT INTO workflows (id, user_id) VALUES ($1, $2), ($3, $4), ($5, $6)`,
        [
          demoWorkflowId,
          DEMO_USER_ID,
          aliceWorkflowId,
          aliceId,
          bobWorkflowId,
          bobId,
        ],
      );

      await backfillOrganizationsAsync(databaseClient);

      const organizations = await selectOrganizationsAsync(databaseClient);

      expect(organizations.map((organization) => organization.name)).toEqual([
        'Personal Workspace - alice@example.com',
        'Personal Workspace - bob@example.com',
        DEMO_ORGANIZATION_NAME,
      ]);
      expect(
        organizations.find(
          (organization) => organization.name === DEMO_ORGANIZATION_NAME,
        )?.id,
      ).toBe(DEMO_ORG_ID);

      const users = await databaseClient.query<UserWithOrganizationRow>(`
      SELECT u.id, u.email, u.organization_id, o.name AS org_name
        FROM users u
        JOIN organizations o ON o.id = u.organization_id
       ORDER BY u.email
    `);

      expect(users.rows).toHaveLength(3);
      for (const user of users.rows) {
        expect(user.org_name).toBe(`Personal Workspace - ${user.email}`);
      }
      expect(
        users.rows.find((user) => user.email === DEMO_USER_EMAIL)
          ?.organization_id,
      ).toBe(DEMO_ORG_ID);

      const workflowMismatch = await databaseClient.query<{
        mismatched: number;
      }>(`
      SELECT count(*)::int AS mismatched
        FROM workflows w
        JOIN users u ON u.id = w.user_id
       WHERE w.organization_id IS DISTINCT FROM u.organization_id
    `);

      expect(workflowMismatch.rows[0]?.mismatched).toBe(0);

      const nullWorkflows = await databaseClient.query<{ null_count: number }>(
        'SELECT count(*)::int AS null_count FROM workflows WHERE organization_id IS NULL',
      );

      expect(nullWorkflows.rows[0]?.null_count).toBe(0);

      // Шаг 7: NOT NULL включён для обеих колонок.
      const nullability = await databaseClient.query<OrganizationColumnRow>(
        `SELECT table_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND column_name = 'organization_id'
        ORDER BY table_name`,
      );

      expect(nullability.rows).toEqual([
        { table_name: 'users', is_nullable: 'NO' },
        { table_name: 'workflows', is_nullable: 'NO' },
      ]);

      organizationsAfterFirstRun = organizations;
    });

    it('идемпотентен: второй прогон не создаёт дублей и не меняет привязки', async () => {
      const databaseClient = client;

      if (!databaseClient) {
        throw new Error('клиент БД не инициализирован');
      }

      await expect(
        backfillOrganizationsAsync(databaseClient),
      ).resolves.toBeUndefined();

      const organizations = await selectOrganizationsAsync(databaseClient);

      expect(organizations).toEqual(organizationsAfterFirstRun);

      const unassigned = await databaseClient.query<{
        null_users: number;
        null_workflows: number;
      }>(`
      SELECT (SELECT count(*) FROM users WHERE organization_id IS NULL)::int AS null_users,
             (SELECT count(*) FROM workflows WHERE organization_id IS NULL)::int AS null_workflows
    `);

      expect(unassigned.rows[0]).toEqual({ null_users: 0, null_workflows: 0 });
    });

    it('на пустых users/workflows проходит без ошибок и включает NOT NULL', async () => {
      const databaseClient = client;

      if (!databaseClient) {
        throw new Error('клиент БД не инициализирован');
      }

      scratchSchemas.push(await createScratchSchemaAsync(databaseClient));

      await expect(
        backfillOrganizationsAsync(databaseClient),
      ).resolves.toBeUndefined();

      // Пустые users/workflows не мешают: шаг 1 под EXISTS не создаёт
      // демо-организацию (демо-пользователя нет), шаги 2–5 не находят строк,
      // шаг 7 включает ограничение.
      const organizations = await selectOrganizationsAsync(databaseClient);

      expect(organizations).toEqual([]);

      const counts = await databaseClient.query<{
        users: number;
        workflows: number;
      }>(`
      SELECT (SELECT count(*) FROM users)::int AS users,
             (SELECT count(*) FROM workflows)::int AS workflows
    `);

      expect(counts.rows[0]).toEqual({ users: 0, workflows: 0 });

      const nullability = await databaseClient.query<OrganizationColumnRow>(
        `SELECT table_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND column_name = 'organization_id'
        ORDER BY table_name`,
      );

      expect(nullability.rows).toEqual([
        { table_name: 'users', is_nullable: 'NO' },
        { table_name: 'workflows', is_nullable: 'NO' },
      ]);
    });
  },
);
