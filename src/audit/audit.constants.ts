/**
 * Известные коды действий журнала аудита (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Код — стабильный строковый идентификатор действия, который попадает в
 * `audit_logs.action`. CHECK-ограничения на набор значений нет (см.
 * `src/db/schema.ts`): новое действие не должно требовать миграции, поэтому
 * список здесь — единственный источник для кода приложения и UI. Формат —
 * `<сущность>.<глагол>` (`workflow.create`, `run.start`), чтобы действия
 * группировались по объекту.
 *
 * Для маршрутов, которых нет в списке, интерсептор пишет fallback
 * `http.<метод>` (см. {@link resolveAuditAction}) — журнал не теряет запись.
 */
export const AUDIT_ACTIONS = [
  'workflow.create',
  'workflow.import',
  'workflow.update',
  'workflow.delete',
  'workflow.share',
  'workflow.unshare',
  'workflow.instantiate',
  'collaborator.invite',
  'collaborator.update',
  'collaborator.remove',
  'document_template.create',
  'document_template.delete',
  'member.invite',
  'member.role_change',
  'member.remove',
  'run.start',
] as const;

/** Код известного действия журнала аудита (`audit_logs.action`). */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Описание маршрута мутирующего запроса: метод + шаблон пути → код действия.
 *
 * Путь в журнале — **фактический** URL запроса, а не шаблон Nest: идентификаторы
 * в нём заменены реальными значениями (uuid workflow, слаг шаблона), поэтому
 * сегменты-идентификаторы описаны `[^/]+`, а не литералами.
 */
interface AuditActionRoute {
  /** HTTP-метод маршрута (интерсептор пишет только мутирующие). */
  readonly method: 'POST' | 'PATCH' | 'DELETE';
  /** Шаблон фактического пути (полное совпадение, без query-строки). */
  readonly pattern: RegExp;
  /** Код действия, которое соответствует маршруту. */
  readonly action: AuditAction;
}

/**
 * Таблица маршрутов аудита: порядок не важен — каждый шаблон привязан к методу
 * и ограничен `^…$`, поэтому пересечений между записями нет.
 *
 * Маршруты сверены с контроллерами (`workflow.controller.ts`,
 * `templates.controller.ts`, `runs.controller.ts`,
 * `document-templates.controller.ts`, `org-members.controller.ts` v1.0.0 S5):
 * если ручка меняет путь, журнал начнёт писать fallback `http.<метод>` — это
 * видно в аудите и не ломает запись.
 */
const AUDIT_ACTION_ROUTES: readonly AuditActionRoute[] = [
  { method: 'POST', pattern: /^\/workflow$/, action: 'workflow.create' },
  { method: 'POST', pattern: /^\/workflow\/import$/, action: 'workflow.import' },
  { method: 'POST', pattern: /^\/workflow\/[^/]+\/share$/, action: 'workflow.share' },
  {
    method: 'POST',
    pattern: /^\/workflow\/[^/]+\/collaborators$/,
    action: 'collaborator.invite',
  },
  {
    method: 'POST',
    pattern: /^\/templates\/[^/]+\/instantiate$/,
    action: 'workflow.instantiate',
  },
  {
    method: 'POST',
    pattern: /^\/workflow\/[^/]+\/document-templates$/,
    action: 'document_template.create',
  },
  // v1.0.0 S5 (KI-563): приглашение в организацию — действие команды.
  // Email в metadata пишется, пароль/токены — нет (см. AuditInterceptor).
  {
    method: 'POST',
    pattern: /^\/admin\/members\/invite$/,
    action: 'member.invite',
  },
  { method: 'POST', pattern: /^\/runs$/, action: 'run.start' },
  // v1.1.0 S2 (KI-586): управление составом организации — смена роли и
  // удаление участника (только owner). В metadata попадают путь/параметры и
  // тело запроса; пароли/токены вырезает AuditInterceptor.
  {
    method: 'PATCH',
    pattern: /^\/admin\/members\/[^/]+$/,
    action: 'member.role_change',
  },
  {
    method: 'DELETE',
    pattern: /^\/admin\/members\/[^/]+$/,
    action: 'member.remove',
  },
  { method: 'PATCH', pattern: /^\/workflow\/[^/]+$/, action: 'workflow.update' },
  {
    method: 'PATCH',
    pattern: /^\/workflow\/[^/]+\/collaborators\/[^/]+$/,
    action: 'collaborator.update',
  },
  { method: 'DELETE', pattern: /^\/workflow\/[^/]+$/, action: 'workflow.delete' },
  {
    method: 'DELETE',
    pattern: /^\/workflow\/[^/]+\/share$/,
    action: 'workflow.unshare',
  },
  {
    method: 'DELETE',
    pattern: /^\/workflow\/[^/]+\/collaborators\/[^/]+$/,
    action: 'collaborator.remove',
  },
  {
    method: 'DELETE',
    pattern: /^\/workflow\/[^/]+\/document-templates\/[^/]+$/,
    action: 'document_template.delete',
  },
];

/**
 * Приводит фактический путь запроса к нормализованному виду для сверки.
 *
 * Query-строка и хэш отбрасываются (в журнал они тоже не должны попадать —
 * там могут оказаться токены), хвостовой слэш снимается. Внутренняя функция:
 * вызывающий код работает с {@link resolveAuditAction}.
 *
 * @param path - фактический путь запроса (`request.path`)
 * @returns путь без query-строки, хэша и хвостового слэша
 */
function normalizeAuditPath(path: string): string {
  const pathname = path.split('?')[0].split('#')[0];
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;

  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

/**
 * Определяет код действия журнала по методу и фактическому пути запроса.
 *
 * Сначала путь нормализуется (query-строка, хэш и хвостовой слэш не влияют на
 * результат), затем сверяется с {@link AUDIT_ACTION_ROUTES}. Если маршрут не
 * описан, возвращается fallback `http.<метод в lowercase>`: интерсептор всё
 * равно пишет запись, и новое действие не теряется из журнала.
 *
 * @param method - HTTP-метод запроса (`POST`/`PATCH`/`DELETE`; регистр не важен)
 * @param path - фактический путь запроса (`/workflow/<uuid>/share`)
 * @returns известный код действия из {@link AUDIT_ACTIONS} либо `http.<метод>`
 */
export function resolveAuditAction(method: string, path: string): string {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = normalizeAuditPath(path);

  const route = AUDIT_ACTION_ROUTES.find(
    (candidate) =>
      candidate.method === normalizedMethod && candidate.pattern.test(normalizedPath),
  );

  if (route !== undefined) {
    return route.action;
  }

  return `http.${normalizedMethod.toLowerCase()}`;
}
