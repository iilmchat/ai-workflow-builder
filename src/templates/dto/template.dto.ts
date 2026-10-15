import { z } from 'zod';
import { ExportWorkflowSchema } from '../../workflow/dto/export-workflow.dto.js';

/**
 * Zod-схема краткой карточки шаблона для UI (R6.6.1, DESIGN v0.8 § 9).
 *
 * Полный граф в списке не отдаётся: `GET /templates` должен оставаться дешёвым
 * даже когда шаблонов станет много, поэтому клиент получает только метаданные
 * и число узлов, а сам граф — при инстанцировании.
 */
export const TemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodeCount: z.number().int().nonnegative(),
});

/** Краткая карточка шаблона. */
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

/**
 * Zod-схема файла шаблона `src/templates/*.json`.
 *
 * Расширяет {@link ExportWorkflowSchema} (шаблон — тот же sharable-артефакт,
 * что отдаёт `GET /workflow/:id/export`) единственным полем `description`.
 *
 * Почему `.extend()`, а не отдельная схема: Zod по умолчанию **отбрасывает**
 * неизвестные ключи, поэтому `description` из JSON не дожил бы до
 * `TemplateSummary` — он молча терялся бы (та же ловушка, что KI-149).
 * Валидация при этом остаётся «через ExportWorkflowSchema»: расширение
 * проверяет все её поля и добавляет одно обязательное.
 */
export const TemplateFileSchema = ExportWorkflowSchema.extend({
  description: z.string().min(1),
});

/** Валидированное содержимое файла шаблона. */
export type TemplateFile = z.infer<typeof TemplateFileSchema>;
