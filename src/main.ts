import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Грейсфул-шатдаун: OnApplicationShutdown закрывает пул pg (DbModule) и
  // соединения BullMQ с Redis (RULES 4.12).
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
