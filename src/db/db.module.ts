import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

/** Инъекционный токен drizzle-клиента. */
export const DRIZZLE = 'DRIZZLE';

/** Инъекционный токен схемы (таблицы + relations). */
export const DB_SCHEMA = 'DB_SCHEMA';

/** Тип drizzle-клиента для инъекции в сервисы. */
export type Database = ReturnType<typeof createDrizzleClient>;

function createDrizzleClient(url: string) {
  const pool = new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL is not set — добавьте его в .env в корне проекта');
        }
        return createDrizzleClient(url);
      },
    },
    { provide: DB_SCHEMA, useValue: schema },
  ],
  exports: [DRIZZLE, DB_SCHEMA],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}