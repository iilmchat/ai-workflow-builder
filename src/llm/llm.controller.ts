import { Controller, Get } from '@nestjs/common';
import { LlmRegistryService, type LlmModelInfo } from './llm-registry.service.js';

/**
 * HTTP-контроллер LLM-модуля (R4.1b).
 *
 * Отдаёт список моделей для UI-селекта. Роут внутренний (для SPA), поэтому
 * успешный ответ — «как есть» массив, без обёртки `{ success, data }`; формат
 * ошибок остаётся глобальным (RULES 1.6).
 */
@Controller('llm')
export class LlmController {
  /**
   * @param registry - реестр провайдеров (источник списка моделей)
   */
  constructor(private readonly registry: LlmRegistryService) {}

  /**
   * `GET /llm/models` — модели, доступные для выбора в UI.
   *
   * Возвращаются только модели сконфигурированных провайдеров (KI-039):
   * предлагать модели без API-ключа нельзя, вызов такой модели гарантированно
   * упадёт. Пустой массив означает, что ключей нет вовсе.
   *
   * @returns массив `{ provider, id, label }` в порядке приоритета провайдеров
   */
  @Get('models')
  listModels(): LlmModelInfo[] {
    return this.registry.listModels();
  }
}
