import { z } from 'zod';

/**
 * Zod-схемы задач GPTunnel CreativeLab (v0.6.0b.2.2).
 *
 * Upstream отдаёт snake_case, поэтому схемы читают JSON «как есть»;
 * переименование в camelCase делает маппер (`media-task.mapper.ts`), а не
 * Zod (RULES 1.17, 4.23).
 */

/**
 * Тело `POST /media/tasks`.
 *
 * `idempotency_key` обязателен: worker может повторить задание после падения
 * (KI-040), и без ключа каждый retry создавал бы новую платную генерацию.
 */
export const CreateMediaTaskSchema = z.object({
  /** id модели из `listModels`. */
  model: z.string().min(1),
  /** Текстовый промпт (обязателен для моделей с `prompt: 'required'`). */
  prompt: z.string().min(1).optional(),
  /** Динамические параметры модели (см. `MediaParam`). */
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  /** Ссылки на входные файлы по ролям (загрузка файлов — v0.6.0b.2.3+). */
  inputs: z.record(z.string(), z.array(z.url())).optional(),
  /**
   * Ключ идемпотентности: retry с тем же ключом не создаст дубль, а вернёт
   * ранее созданную задачу (upstream отвечает `code: 23` при смене тела с тем
   * же ключом).
   */
  idempotency_key: z.string().min(8).max(128),
});

/** Тело `POST /media/tasks`. */
export type CreateMediaTaskDto = z.infer<typeof CreateMediaTaskSchema>;

/** Статус задачи генерации. */
export const MediaTaskStatusSchema = z.enum([
  'queued',
  'running',
  'done',
  'failed',
]);

/**
 * Ошибка задачи от upstream.
 *
 * Upstream отдаёт причину падения **в двух формах**: строкой (валидация входа)
 * и объектом `{ code, title, message }` (падение на стороне провайдера,
 * например `EXCEPTION`). Раньше схема ждала только строку, поэтому ответ с
 * объектом не проходил `safeParse`, и вместо реальной причины пользователь
 * видел `Invalid input, check schema issues` (KI-181).
 */
export const MediaTaskErrorSchema = z.union([
  z.string(),
  z.object({
    code: z.number().int().optional(),
    title: z.string().optional(),
    message: z.string().optional(),
  }),
]);

/** Ответ `POST /media/tasks` и `GET /media/tasks/:id`. */
export const MediaTaskResponseSchema = z.object({
  /** Код ответа upstream (`0` — успех). */
  code: z.number().int(),
  /** id задачи для опроса статуса. */
  id: z.string(),
  /** id модели, принявшей задачу (может отличаться при redirect, см. KI-077). */
  model: z.string(),
  /** Текущий статус. */
  status: MediaTaskStatusSchema,
  /** Промпт, как его принял upstream. */
  prompt: z.string().optional(),
  /** Параметры, как их принял upstream. */
  params: z.record(z.string(), z.unknown()).optional(),
  /** Итоговая стоимость задачи в рублях (заполняется к моменту `done`). */
  price: z.number().nonnegative().optional(),
  /** URL-ы результата (48 часов жизни, см. KI-077). */
  // KI-111: upstream отдаёт массив объектов { url }, а не массив строк.
  result: z.array(z.object({ url: z.url() })).optional(),
  /** Причина падения при `status: 'failed'` (строка либо объект). */
  error: MediaTaskErrorSchema.optional(),
  /**
   * Вернул ли upstream стоимость за упавшую задачу.
   *
   * `yandex-art` при падении отдаёт `refunded: true` — цена в ответе есть,
   * но фактически не списана.
   */
  refunded: z.boolean().optional(),
  /** Предупреждения upstream, например о снятой модели. */
  warnings: z
    .array(z.object({ code: z.string(), message: z.string().optional() }))
    .optional(),
  /** Время создания задачи (unix ms). */
  created_at: z.number().int().optional(),
});

/** Сырой ответ upstream по задаче (snake_case). */
export type MediaTaskResponseDto = z.infer<typeof MediaTaskResponseSchema>;
