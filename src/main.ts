import 'dotenv/config';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Refresh-токен приходит httpOnly-cookie (R6.1b): без парсера
  // `req.cookies` пуст, и POST /auth/refresh всегда отвечал бы 401.
  app.use(cookieParser());

  // Грейсфул-шатдаун: OnApplicationShutdown закрывает пул pg (DbModule) и
  // соединения BullMQ с Redis (RULES 4.12).
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
