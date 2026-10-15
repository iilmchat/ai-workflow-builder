/**
 * Публичное представление workflow (R6.2.1, DESIGN v0.8 § 4).
 *
 * Отдаётся по share-ссылке **без аутентификации**, поэтому здесь нет
 * `userId`, `shareToken`, `updatedAt` и любых служебных полей: клиент видит
 * только то, что нужно для read-only отрисовки графа.
 */
export interface SharedWorkflow {
  /** uuid workflow. */
  id: string;
  /** Название графа. */
  name: string;
  /** Узлы графа (форма — как в БД, валидация на движке). */
  nodes: unknown[];
  /** Связи графа. */
  edges: unknown[];
  /** Дата создания в ISO-8601. */
  createdAt: string;
}

/**
 * Ответ на `POST /workflow/:id/share`.
 *
 * `shareUrl` — **относительный** путь: абсолютный URL собирает клиент
 * (origin ему известен), а backend не знает публичный домен.
 */
export interface ShareTokenDto {
  /** Capability-токен (uuid v4); в логи не пишется (RULES 5.9). */
  shareToken: string;
  /** Относительная ссылка вида `/workflow/share/<token>`. */
  shareUrl: string;
}
