import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { backfillOrganizationsAsync } from './src/db/migrations/backfill-organizations.js';

async function run() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL не задан в .env');
  }

  // KI-205: URL целиком содержит пароль — в лог отдаём только хост и базу
  // (RULES 5.1/5.3).
  const target = new URL(url);
  console.log(`База: ${target.host}${target.pathname}`);

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    console.log('Применяем миграции...');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Миграции применены');

    // v1.0 S1 (DESIGN_V100_ENTERPRISE § 3.1): миграция 0014 добавляет
    // organization_id nullable — backfill заполняет колонки и включает NOT
    // NULL. Отдельная транзакция на том же пуле: частично заполненная БД не
    // останется после ошибки, повторный запуск идемпотентен.
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await backfillOrganizationsAsync(client);
      await client.query('COMMIT');
      console.log(
        '✅ Организации: backfill выполнен, organization_id заполнен, NOT NULL включён',
      );
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Соединение могло уже разорваться — исходная ошибка важнее.
      }

      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

run().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
