import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

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
  } finally {
    await pool.end();
  }
}

run().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});