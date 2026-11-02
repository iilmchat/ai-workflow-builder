import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from '../../auth/auth.constants.js';

/**
 * Backfill арендаторов v1.0 S1 (DESIGN_V100_ENTERPRISE § 3.1).
 *
 * Миграция `0014_*` добавляет `users.organization_id` и
 * `workflows.organization_id` **nullable**: в существующей БД уже есть данные,
 * и `ADD COLUMN ... NOT NULL` без DEFAULT упал бы. Этот модуль заполняет
 * колонки и только затем включает NOT NULL.
 *
 * Запускается из `migrate.ts` после `migrate()` в отдельной транзакции
 * (`BEGIN`/`COMMIT`/`ROLLBACK`): либо данные и ограничение применяются
 * целиком, либо откатываются. Все шаги идемпотентны — повторный прогон на уже
 * заполненной БД ничего не меняет:
 *
 * 1. детерминированная организация демо-пользователя (id
 *    {@link DEMO_ORG_ID} из `src/auth/auth.constants.ts`) — только если сам
 *    демо-пользователь существует (на пустых `users` скрипт завершается);
 * 2. демо-пользователь детерминированно привязывается к ней;
 * 3. остальным пользователям без организации создаётся персональная
 *    `Personal Workspace - <email>` (с защитой `NOT EXISTS` по имени);
 * 4. пользователи привязываются к организации по её имени;
 * 5. workflow без организации наследует организацию владельца
 *    (`workflows.user_id → users.organization_id`);
 * 6. DO-блок падает понятной ошибкой, если что-то осталось без организации:
 *    «осиротевшие» workflow (владелец не найден) молча не переприсваиваются;
 * 7. `SET NOT NULL` для обеих колонок.
 *
 * Пустые таблицы `users`/`workflows` обрабатываются штатно: шаги 1–6 ничего не
 * меняют (демо-организация не создаётся, если демо-пользователя нет), шаг 7
 * включает ограничение на пустых данных.
 */

/**
 * Имя персональной организации демо-пользователя.
 *
 * Формат совпадает с остальными персональными организациями
 * (`Personal Workspace - <email>`), поэтому демо-пользователь не выделяется в
 * списке арендаторов. Id организации в этот модуль не дублируется: единственный
 * источник — `DEMO_ORG_ID` из `src/auth/auth.constants.ts`.
 */
export const DEMO_ORGANIZATION_NAME = `Personal Workspace - ${DEMO_USER_EMAIL}`;

/**
 * Минимальный исполнитель SQL для backfill'а.
 *
 * Backfill не требует параметров и не читает результат, поэтому достаточно
 * одного метода `query(text)`. Этому интерфейсу структурно удовлетворяют и
 * `pg.Pool`, и `pg.PoolClient` — модуль не зависит от конкретного клиента
 * (`migrate.ts` передаёт клиент, полученный из пула).
 */
export interface BackfillExecutor {
  /**
   * Выполняет SQL-текст без параметров.
   *
   * @param text - SQL-выражение (backfill передаёт только литералы из
   *   `auth.constants.ts`; значения из БД интерполируются на стороне SQL).
   * @returns Промис результата выполнения; backfill содержимое не использует.
   * @throws {Error} Если запрос не выполнился — ошибка пробрасывается наружу,
   *   чтобы транзакция в `migrate.ts` откатилась.
   */
  query(text: string): Promise<unknown>;
}

/**
 * Экранирует значение как SQL-строковый литерал.
 *
 * Используется только для констант (`DEMO_USER_ID`, `DEMO_ORG_ID`, имя
 * демо-организации): пользовательские данные в SQL не интерполируются (RULES
 * 5.1 — никакой конкатенации внешних значений), но экранирование одиночной
 * кавычки сохраняется, чтобы литерал оставался корректным при смене констант.
 *
 * @param value - значение для литерала.
 * @returns Литерал в одинарных кавычках с удвоенными одиночными кавычками.
 */
function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Собирает SQL-шаги backfill'а в порядке применения.
 *
 * Шаги намеренно не объединяются в один запрос: шаг 6 — DO-блок с `RAISE`, и
 * его диагностика должна выполняться после шагов заполнения, а шаг 7 — после
 * успешной проверки. Условия `IS DISTINCT FROM`/`IS NULL` в шагах 2–5 и
 * `NOT EXISTS` в шаге 3 делают каждый шаг идемпотентным.
 *
 * @returns Массив SQL-выражений для последовательного выполнения.
 */
function buildStatements(): readonly string[] {
  const demoUserId = sqlLiteral(DEMO_USER_ID);

  return [
    // 1. Организация демо-пользователя с детерминированным id. Условие
    // EXISTS: если пользователей нет вообще, скрипт просто завершается и
    // организаций не создаёт.
    `
      INSERT INTO organizations (id, name)
      SELECT ${sqlLiteral(DEMO_ORG_ID)}, ${sqlLiteral(DEMO_ORGANIZATION_NAME)}
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ${demoUserId})
      ON CONFLICT (id) DO NOTHING
    `,
    // 2. Демо-пользователь детерминированно принадлежит демо-организации:
    // IS DISTINCT FROM переприсваивает его и после частичного/legacy-состояния
    // (AUTH_DISABLED полагается на эту организацию), но не пишет строку зря.
    `
      UPDATE users
         SET organization_id = ${sqlLiteral(DEMO_ORG_ID)}
       WHERE id = ${demoUserId}
         AND organization_id IS DISTINCT FROM ${sqlLiteral(DEMO_ORG_ID)}
    `,
    // 3. Персональная организация каждому пользователю без организации.
    // NOT EXISTS по имени не даёт создать дубль при повторном прогоне.
    `
      INSERT INTO organizations (name)
      SELECT 'Personal Workspace - ' || users.email
        FROM users
       WHERE users.organization_id IS NULL
         AND NOT EXISTS (
               SELECT 1
                 FROM organizations
                WHERE organizations.name = 'Personal Workspace - ' || users.email
             )
    `,
    // 4. Привязка пользователей к организациям по имени.
    `
      UPDATE users
         SET organization_id = organizations.id
        FROM organizations
       WHERE users.organization_id IS NULL
         AND organizations.name = 'Personal Workspace - ' || users.email
    `,
    // 5. Workflow наследует организацию владельца.
    `
      UPDATE workflows
         SET organization_id = users.organization_id
        FROM users
       WHERE workflows.organization_id IS NULL
         AND workflows.user_id = users.id
    `,
    // 6. Проверка полноты: без PII, только количество строк. Осиротевшие
    // workflow (user_id без строки в users) не переприсваиваются молча.
    `
      DO $backfill$
      DECLARE
        users_without_org bigint;
        workflows_without_org bigint;
      BEGIN
        SELECT count(*) INTO users_without_org
          FROM users
         WHERE organization_id IS NULL;

        SELECT count(*) INTO workflows_without_org
          FROM workflows
         WHERE organization_id IS NULL;

        IF users_without_org > 0 OR workflows_without_org > 0 THEN
          RAISE EXCEPTION
            'Backfill арендаторов неполон: без organization_id осталось users=%, workflows=%. Осиротевшие workflow (user_id без строки в users) автоматически не переприсваиваются — устраните причину и повторите миграцию.',
            users_without_org, workflows_without_org;
        END IF;
      END
      $backfill$
    `,
    // 7. Только после успешного заполнения включаем NOT NULL.
    'ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL',
    'ALTER TABLE workflows ALTER COLUMN organization_id SET NOT NULL',
  ];
}

/**
 * Заполняет `users.organization_id` и `workflows.organization_id` и включает
 * NOT NULL (v1.0 S1, DESIGN_V100_ENTERPRISE § 3.1).
 *
 * Вызывается из `migrate.ts` сразу после `migrate()` на том же клиенте и в той
 * же транзакции (`BEGIN`/`COMMIT`/`ROLLBACK`): миграция 0014 добавляет колонки
 * nullable, а `SET NOT NULL` в шаге 7 допустим только после проверки шага 6.
 *
 * @param executor - минимальный исполнитель SQL (`pg.Pool`/`pg.PoolClient`).
 *   Шаги выполняются строго последовательно: они зависят друг от друга.
 * @returns Промис, который завершается после включения NOT NULL для обеих
 *   колонок; пустые таблицы `users`/`workflows` не мешают.
 * @throws {Error} Если SQL-шаг не выполнился или шаг 6 нашёл строки без
 *   организации — ошибка уходит в `migrate.ts`, где транзакция откатывается.
 */
export async function backfillOrganizationsAsync(
  executor: BackfillExecutor,
): Promise<void> {
  // Шаги зависимы (организация → пользователи → workflow → NOT NULL), поэтому
  // здесь нужна последовательность, а не `Promise.all` (RULES 4.17 — про
  // независимые операции, к этому случаю неприменим).
  for (const statement of buildStatements()) {
    await executor.query(statement);
  }
}
