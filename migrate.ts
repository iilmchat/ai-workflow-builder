import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

async function run() {
  const url = process.env.DATABASE_URL;
  console.log('URL:', url);

  if (!url) {
    throw new Error('DATABASE_URL не задан в .env');
  }

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