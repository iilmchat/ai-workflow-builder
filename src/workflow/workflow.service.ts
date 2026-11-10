import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  users,
  workflowCollaborators,
  workflows,
  type Workflow,
} from '../db/schema.js';
import type { EdgeDto, NodeDto } from '../engine/dto/index.js';
import {
  collectGraphIssues,
  type CollaboratorResponse,
  type CreateWorkflowDto,
  type ExportWorkflowDto,
  type ImportWorkflowDto,
  type InviteCollaboratorDto,
  type ShareTokenDto,
  type SharedWorkflow,
  type UpdateCollaboratorRoleDto,
  type UpdateWorkflowDto,
  type WorkflowListItem,
} from './dto/index.js';
import {
  workflowAccessFilter,
  workflowAccessListFilter,
  workflowAccessRoleExpression,
  workflowOwnerFilter,
  type WorkflowAccess,
  type WorkflowAccessRole,
  type WorkflowAccessRoleWithOwner,
} from './workflow-access.js';

/** Значение limit по умолчанию для постраничного списка. */
const DEFAULT_LIMIT = 50;
/** Значение offset по умолчанию для постраничного списка. */
const DEFAULT_OFFSET = 0;
/** Префикс относительной share-ссылки (R6.2.1). */
const SHARE_URL_PREFIX = '/workflow/share/';
/**
 * Версия формата экспорта (R6.6.1, DESIGN v0.8 § 9).
 *
 * Это версия **артефакта**, а не колонка `workflows.version`: экспорт всегда
 * помечается единицей, иначе строка с другим значением колонки дала бы файл,
 * который не проходит `ImportWorkflowSchema` (`z.literal(1)`).
 */
const EXPORT_FORMAT_VERSION = 1 as const;

/**
 * Сервис CRUD-операций над workflow.
 *
 * Большинство методов принимает {@link WorkflowAccess} — пользователя и его
 * организацию из access-токена. Изоляция арендаторов (v1.0.0 S2, DESIGN V100
 * § 3.1) применяется на уровне SQL: каждая выборка workflow ограничена
 * `organization_id`, а доступ владельца/участника проверяется теми же
 * предикатами из `workflow-access.ts`.
 *
 * **Write-пути и KI-605.** `createAsync`/`importAsync` принимают только
 * `userId` (`sub`), а организацию читают из `users` — подложить устаревший
 * `orgId` через контроллер нельзя (v1.1.0 S5). Остальные методы по-прежнему
 * получают `WorkflowAccess`, но guard отдаёт в нём проверенную БД-организацию.
 *
 * Необязательный `access` сохранён только у `findAllAsync`/`findOneAsync`/
 * `updateAsync`/`removeAsync` для внутренних вызовов и тестов: без него фильтра
 * по пользователю нет (прежнее поведение). Публичный share-доступ
 * ({@link findSharedAsync}) работает по токену и намеренно не ограничен
 * организацией.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Резолвит организацию актора из БД по `sub` access-токена (v1.1.0 S5,
   * KI-605).
   *
   * Write-пути не должны доверять `orgId` из токена: даже если guard уже
   * проверил его, сервис — вторая граница (RULES 1.17) и может быть вызван
   * напрямую (внутренние сценарии/тесты). Отсутствие строки `users` —
   * 401, как в `AuditService.listAsync`.
   *
   * @param userId - `sub` access-токена
   * @returns контекст доступа с организацией из `users`
   * @throws UnauthorizedException если пользователя нет
   */
  private async resolveAccessAsync(userId: string): Promise<WorkflowAccess> {
    const [actor] = await this.db
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (actor === undefined) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return { userId, orgId: actor.organizationId };
  }

  /**
   * Проверяет форму графа перед записью (KI-017, RULES § 1.17).
   *
   * Zod-схема уже валидирует HTTP-вход, но сервис — вторая граница: его
   * вызывают напрямую импорт и внутренние сценарии, а в БД не должен попасть
   * граф со ссылкой на несуществующий узел или дубликатом `id`.
   *
   * @param nodes - узлы графа
   * @param edges - связи графа
   * @throws BadRequestException если граф некорректен
   */
  private assertGraphValid(
    nodes: readonly unknown[],
    edges: readonly unknown[],
  ): void {
    const issues = collectGraphIssues(nodes, edges);

    if (issues.length > 0) {
      throw new BadRequestException(
        issues.map((issue) => issue.message).join('; '),
      );
    }
  }

  /**
   * Создаёт новый workflow.
   *
   * Владелец приходит из access-токена (`userId`), организация-арендатор
   * читается из `users` (v1.1.0 S5, KI-605): подложить чужой/устаревший
   * `orgId` в токен или вызвать сервис с чужой парой больше нельзя.
   *
   * `nodes`/`edges` — уже с применёнными значениями по умолчанию `[]`.
   *
   * @param dto - валидированные данные создания workflow
   * @param userId - `sub` access-токена (владелец нового workflow)
   * @returns созданная запись workflow
   * @throws UnauthorizedException если пользователя нет в БД
   */
  async createAsync(dto: CreateWorkflowDto, userId: string): Promise<Workflow> {
    const access = await this.resolveAccessAsync(userId);

    // KI-017: defense in depth — прямой вызов сервиса не должен обходить
    // валидацию графа из DTO.
    this.assertGraphValid(dto.nodes, dto.edges);

    const [created] = await this.db
      .insert(workflows)
      .values({
        userId: access.userId,
        organizationId: access.orgId,
        name: dto.name,
        description: dto.description,
        nodes: dto.nodes as NodeDto[],
        edges: dto.edges as EdgeDto[],
      })
      .returning();

    this.logger.debug(
      `Workflow создан: id=${created.id}, userId=${created.userId}`,
    );

    return created;
  }

  /**
   * Импортирует workflow: создаёт **новую** запись у текущего владельца
   * (R6.6.1, DESIGN v0.8 § 9).
   *
   * Служебные поля артефакта (`exportedAt`, `version`) в БД не переносятся:
   * `version` — версия формата экспорта, а не колонка `workflows.version`, а
   * `exportedAt` описывает момент выгрузки, а не создания копии. `id` нового
   * графа генерирует БД (`gen_random_uuid()`), поэтому повторный импорт одного
   * файла даёт независимые workflow.
   *
   * Отдельного INSERT здесь нет намеренно: вставка делегируется
   * {@link createAsync}, чтобы у импорта и создания был ровно один путь записи
   * (иначе разошлись бы дефолты и набор колонок).
   *
   * Транзакция (RULES 4.22) не нужна: запись одна, связанных изменений нет.
   *
   * @param dto - валидированный артефакт (то, что отдаёт `GET /workflow/:id/export`)
   * @param userId - `sub` access-токена (владелец нового workflow)
   * @returns созданный workflow
   * @throws UnauthorizedException если пользователя нет в БД
   */
  async importAsync(dto: ImportWorkflowDto, userId: string): Promise<Workflow> {
    const created = await this.createAsync(
      { name: dto.name, nodes: dto.nodes, edges: dto.edges },
      userId,
    );

    this.logger.debug(
      `Workflow импортирован: id=${created.id}, узлов=${dto.nodes.length}, связей=${dto.edges.length}`,
    );

    return created;
  }

  /**
   * Возвращает список доступных пользователю workflow с пагинацией (R7.6,
   * KI-398; изоляция арендатора — v1.0.0 S2).
   *
   * Доступные — это собственные графы **и** чужие, где пользователь участник
   * (`viewer`/`editor`), но только внутри организации пользователя: по
   * `workflows.organization_id` фильтрует {@link workflowAccessListFilter}
   * (DESIGN V100 § 3.1), поэтому графы другого арендатора в список не попадают
   * даже при знании их uuid.
   *
   * `accessRole` вычисляется тем же запросом (коррелированный подзапрос по
   * `workflow_collaborators`), а не отдельным запросом на строку: иначе список
   * из 50 графов дал бы N+1. Роль нужна UI, чтобы скрыть Save/Run у viewer
   * (KI-397).
   *
   * Без `access` (внутренние вызовы и тесты) фильтра нет, а роль — `owner`:
   * это прежнее поведение «вернуть все доступные графы», и без пользователя
   * понятия «участник» не существует.
   *
   * Сортировка — по `createdAt` по убыванию (сначала новые).
   *
   * @param access - необязательный контекст доступа: пользователь и организация
   * @param limit - максимум записей в ответе, по умолчанию 50
   * @param offset - сколько записей пропустить, по умолчанию 0
   * @returns массив workflow с ролью пользователя в каждом
   */
  async findAllAsync(
    access?: WorkflowAccess,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
  ): Promise<WorkflowListItem[]> {
    const accessRole =
      access === undefined
        ? sql<WorkflowAccessRoleWithOwner>`'owner'`.as('access_role')
        : workflowAccessRoleExpression(access.userId);

    return this.db
      .select({ ...getTableColumns(workflows), accessRole })
      .from(workflows)
      .where(
        access === undefined ? undefined : this.buildListAccessFilter(access),
      )
      .orderBy(desc(workflows.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Возвращает один workflow по идентификатору.
   *
   * @param id - uuid workflow
   * @param access - необязательный контекст доступа; если передан, запись
   *   ищется с учётом принадлежности организации и роли (владелец/участник)
   * @returns найденный workflow или `null`
   */
  async findOneAsync(
    id: string,
    access?: WorkflowAccess,
  ): Promise<Workflow | null> {
    const [found] = await this.db
      .select()
      .from(workflows)
      .where(this.buildAccessFilter(id, access))
      .limit(1);

    return found ?? null;
  }

  /**
   * Экспортирует доступный пользователю workflow в sharable JSON
   * (R6.6.1, DESIGN v0.8 § 9; доступ участников — R7.6).
   *
   * Выборка идёт явной проекцией (`name`, `nodes`, `edges`) с фильтром доступа
   * (владелец или участник) **и** организацией арендатора (v1.0.0 S2), а не
   * `select()` целиком: так служебные поля (`id`, `userId`, `shareToken`,
   * `createdAt`) не могут попасть в артефакт даже случайно — это структурная
   * гарантия, а не договорённость (артефакт уходит наружу, и `shareToken` в нём
   * был бы capability-утечкой, RULES 5.9).
   *
   * `exportedAt` — момент выгрузки в ISO-8601, информационное поле: импорт его
   * игнорирует.
   *
   * @param id - uuid workflow
   * @param access - пользователь и его организация из access-токена
   * @returns артефакт `{ version, name, nodes, edges, exportedAt }`
   * @throws NotFoundException если workflow не существует или недоступен
   */
  async exportAsync(
    id: string,
    access: WorkflowAccess,
  ): Promise<ExportWorkflowDto> {
    const [found] = await this.db
      .select({
        name: workflows.name,
        nodes: workflows.nodes,
        edges: workflows.edges,
      })
      .from(workflows)
      .where(this.buildAccessFilter(id, access))
      .limit(1);

    // Чужой workflow неотличим от несуществующего: 404, а не 403 (как share).
    if (!found) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }

    return {
      version: EXPORT_FORMAT_VERSION,
      name: found.name,
      nodes: found.nodes,
      edges: found.edges,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Обновляет workflow и помечает его свежим `updatedAt`.
   *
   * KI-300: колонка `version` — ревизия **содержимого графа**, по ней ссылки
   * `sub_workflow` определяют, что сохранённый снимок устарел (R6.7). Поэтому
   * `version` инкрементируется только при реальном изменении `nodes`/`edges`
   * (deep-equal с текущей строкой):
   *
   * - `name`/`description` — метаданные, они не влияют на исполнение, и их
   *   правка иначе давала бы ложный warning «есть новая версия» у всех ссылок;
   * - автосохранение без правок (payload идентичен) `version` не двигает —
   *   Save идемпотентен;
   * - пустой PATCH отсекается ниже (`BadRequestException`).
   *
   * Текущая строка читается **только** если в DTO есть `nodes`/`edges`: для
   * PATCH одних метаданных лишний SELECT не нужен — инкремента там нет по
   * определению. Сам инкремент выполняется в SQL (`version + 1`), поэтому
   * конкурентные обновления графа не теряют версии (lost update).
   *
   * @param id - uuid workflow
   * @param dto - валидированные поля для обновления (все необязательные)
   * @param access - необязательный контекст доступа (проверка принадлежности и
   *   организации; для правки графа нужен владелец или участник editor)
   * @returns обновлённый workflow или `null`, если запись не найдена
   * @throws BadRequestException если не передано ни одного поля для обновления
   */
  async updateAsync(
    id: string,
    dto: UpdateWorkflowDto,
    access?: WorkflowAccess,
  ): Promise<Workflow | null> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException(
        'Не передано ни одного поля для обновления',
      );
    }

    let isGraphChanged = false;

    if (dto.nodes !== undefined || dto.edges !== undefined) {
      const current = await this.findOneAsync(id, access);

      // KI-017: PATCH может прийти только с одним из массивов. Проверяем
      // итоговый граф (переданное поле + текущее из БД), иначе удаление узла
      // без edges оставило бы висячие связи.
      if (current !== null) {
        this.assertGraphValid(
          dto.nodes ?? current.nodes,
          dto.edges ?? current.edges,
        );
      }

      isGraphChanged =
        current !== null &&
        ((dto.nodes !== undefined &&
          !isDeepStrictEqual(dto.nodes, current.nodes)) ||
          (dto.edges !== undefined &&
            !isDeepStrictEqual(dto.edges, current.edges)));
    }

    // KI-014: колонки типизированы через `$type<NodeDto[]>()` / `$type<EdgeDto[]>()`,
    // а DTO обновления принимает `unknown[]`: узлы сохраняются «как есть»
    // (включая UI-поля React Flow), поэтому приведение сужено до двух полей
    // и не меняет поведение. Форма графа уже проверена выше (KI-017), а
    // глубокая валидация параметров узлов остаётся на входе в engine.
    const [updated] = await this.db
      .update(workflows)
      .set({
        ...dto,
        nodes: dto.nodes as NodeDto[] | undefined,
        edges: dto.edges as EdgeDto[] | undefined,
        ...(isGraphChanged
          ? { version: sql<number>`${workflows.version} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      // R7.6: править граф может владелец или участник с ролью editor;
      // viewer получает пустую выборку → 404, как чужой workflow. S2: плюс
      // обязательное совпадение организации арендатора.
      .where(this.buildAccessFilter(id, access, 'editor'))
      .returning();

    return updated ?? null;
  }

  /**
   * Удаляет workflow.
   *
   * Связанные `workflow_runs` и `node_runs` удаляются каскадом на уровне БД
   * (`ON DELETE CASCADE` в схеме).
   *
   * @param id - uuid workflow
   * @param access - необязательный контекст доступа (владелец + организация)
   * @returns `true`, если запись удалена; `false`, если ничего не найдено
   */
  async removeAsync(id: string, access?: WorkflowAccess): Promise<boolean> {
    const deleted = await this.db
      .delete(workflows)
      // R7.6: удаление остаётся только у владельца — editor его не получает.
      .where(this.buildOwnerFilter(id, access))
      .returning({ id: workflows.id });

    return deleted.length > 0;
  }

  /**
   * Собирает условие WHERE: по id и, при наличии, по доступу пользователя.
   *
   * R7.6: доступ даёт владелец **или** участник с ролью не ниже
   * `minimumRole`. Для `viewer` подходит любая роль участника, для `editor` —
   * только `editor` (DESIGN v0.9 § 3.6). v1.0.0 S2: предикат дополнительно
   * требует совпадения `workflows.organization_id` с организацией из
   * access-токена, поэтому чужой арендатор неотличим от несуществующего графа.
   * Без `access` фильтр остаётся по id: так работают внутренние вызовы движка и
   * тесты.
   *
   * @param id - uuid workflow
   * @param access - необязательный контекст доступа из access-токена
   * @param minimumRole - минимальная роль участника (по умолчанию `viewer`)
   * @returns условие для Drizzle
   */
  private buildAccessFilter(
    id: string,
    access?: WorkflowAccess,
    minimumRole: WorkflowAccessRole = 'viewer',
  ): SQL {
    return access
      ? workflowAccessFilter(this.db, id, access, minimumRole)
      : eq(workflows.id, id);
  }

  /**
   * Собирает WHERE для списочной выборки: все workflow, доступные пользователю
   * в его организации (KI-398, v1.0.0 S2).
   *
   * Это «безымянный» вариант {@link buildAccessFilter}: тот же предикат
   * «владелец **или** участник» плюс `organization_id = access.orgId`, но без
   * ограничения по `workflows.id` — для `GET /workflow`, где запрашивается не
   * один граф, а весь список.
   *
   * @param access - пользователь и его организация из access-токена
   * @returns условие для Drizzle
   */
  private buildListAccessFilter(access: WorkflowAccess): SQL {
    return workflowAccessListFilter(this.db, access);
  }

  /**
   * Собирает WHERE только для владельца workflow (R7.6) и его организации
   * (v1.0.0 S2).
   *
   * Используется операциями, которые участнику недоступны даже с ролью
   * `editor`: удаление workflow, share-ссылка и управление участниками.
   *
   * @param id - uuid workflow
   * @param access - необязательный контекст доступа из access-токена
   * @returns условие для Drizzle
   */
  private buildOwnerFilter(id: string, access?: WorkflowAccess): SQL {
    return access ? workflowOwnerFilter(id, access) : eq(workflows.id, id);
  }

  /**
   * Создаёт или перевыпускает share-токен workflow (R6.2.1).
   *
   * Токен — capability: доступ даёт само его знание, БД генерирует uuid v4
   * (`gen_random_uuid()`). В логи токен не пишется (RULES 5.9). Чужой workflow
   * неотличим от несуществующего: 404, а не 403.
   *
   * @param id - uuid workflow
   * @param access - владелец и его организация из access-токена
   * @returns токен и относительный путь ссылки
   * @throws NotFoundException если workflow не найден или принадлежит другому
   */
  async createShareTokenAsync(
    id: string,
    access: WorkflowAccess,
  ): Promise<ShareTokenDto> {
    const [updated] = await this.db
      .update(workflows)
      .set({ shareToken: sql`gen_random_uuid()`, updatedAt: new Date() })
      // R7.6: share-ссылка — только владелец (editor её не выпускает).
      .where(this.buildOwnerFilter(id, access))
      .returning({ shareToken: workflows.shareToken });

    if (updated?.shareToken == null) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }

    return {
      shareToken: updated.shareToken,
      shareUrl: `${SHARE_URL_PREFIX}${updated.shareToken}`,
    };
  }

  /**
   * Отзывает share-токен: `share_token = NULL` (R6.2.1).
   *
   * @param id - uuid workflow
   * @param access - владелец и его организация из access-токена
   * @returns промис без значения
   * @throws NotFoundException если workflow не найден или принадлежит другому
   */
  async revokeShareTokenAsync(
    id: string,
    access: WorkflowAccess,
  ): Promise<void> {
    const revoked = await this.db
      .update(workflows)
      .set({ shareToken: null, updatedAt: new Date() })
      // R7.6: отзыв ссылки — только владелец.
      .where(this.buildOwnerFilter(id, access))
      .returning({ id: workflows.id });

    if (revoked.length === 0) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }
  }

  /**
   * Возвращает публичное представление workflow по share-токену (R6.2.1).
   *
   * Без проверки владельца и без аутентификации: отозванный токен — это NULL,
   * поэтому `eq(shareToken, token)` не находит такую строку (404). В ответе нет
   * `userId`, `shareToken` и `updatedAt` — только то, что нужно для read-only
   * отрисовки.
   *
   * @param token - share-токен (uuid)
   * @returns публичный граф
   * @throws NotFoundException если токена нет
   */
  async findSharedAsync(token: string): Promise<SharedWorkflow> {
    const [found] = await this.db
      .select({
        id: workflows.id,
        name: workflows.name,
        nodes: workflows.nodes,
        edges: workflows.edges,
        createdAt: workflows.createdAt,
      })
      .from(workflows)
      .where(eq(workflows.shareToken, token))
      .limit(1);

    if (!found) {
      throw new NotFoundException('Workflow по ссылке не найден');
    }

    return {
      id: found.id,
      name: found.name,
      nodes: found.nodes,
      edges: found.edges,
      // В Drizzle-схеме createdAt без `.notNull()` (дефолт задан в БД), поэтому
      // тип nullable — подстраховываемся, не отдавая клиенту `null`.
      createdAt: (found.createdAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Возвращает участников workflow, первым — владельца (R7.6, DESIGN v0.9
   * § 3.6; KI-399).
   *
   * Список видят все, у кого есть доступ к графу: владелец и любой участник
   * (viewer тоже — это чтение). Чужой workflow неотличим от несуществующего:
   * 404, а не 403 (KI-202).
   *
   * Владелец не хранится в `workflow_collaborators` — он определяется по
   * `workflows.user_id`. Тем не менее в ответе он присутствует отдельной
   * первой строкой с ролью `owner`, потому что DESIGN обещает UI полный список
   * «owner + participants», а не «участники плюс отдельное поле владельца».
   * Email владельца читается из `users` отдельным запросом: в строке workflow
   * его нет. Если пользователь-владелец был удалён (FK на `workflows.user_id`
   * нет), строка остаётся — `email` просто не заполняется.
   *
   * Строка участника с тем же id, что и владелец, отфильтровывается: инвайт
   * владельца запрещён, но старые данные могли успеть создать дубль, и два
   * «owner» в списке были бы визуальным багом.
   *
   * Изоляция арендаторов (v1.0.0 S2): участники выбираются только с
   * `users.organization_id = access.orgId`. Строки `workflow_collaborators`,
   * оставшиеся от версии до мультитенантности и указывающие на пользователя
   * другой организации, в ответ не попадают — это скрывает чужой PII (email) и
   * не раскрывает состав чужих организаций. Доступ такие строки всё равно не
   * дают: предикаты доступа дополнительно требуют `workflows.organization_id`.
   *
   * @param id - uuid workflow
   * @param access - пользователь и его организация из access-токена
   * @returns владелец и участники, участники — по дате приглашения
   * @throws NotFoundException если workflow не существует или недоступен
   */
  async getCollaboratorsAsync(
    id: string,
    access: WorkflowAccess,
  ): Promise<CollaboratorResponse[]> {
    const workflow = await this.findOneAsync(id, access);

    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }

    const [owner] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, workflow.userId))
      .limit(1);

    const rows = await this.db
      .select({
        userId: workflowCollaborators.userId,
        email: users.email,
        role: workflowCollaborators.role,
        invitedAt: workflowCollaborators.invitedAt,
        invitedBy: workflowCollaborators.invitedBy,
      })
      .from(workflowCollaborators)
      .innerJoin(users, eq(users.id, workflowCollaborators.userId))
      // S2: участники только из организации арендатора — кросс-организационные
      // строки (legacy) скрыты и PII чужой организации не утекает.
      .where(
        and(
          eq(workflowCollaborators.workflowId, id),
          eq(users.organizationId, access.orgId),
        ),
      )
      .orderBy(workflowCollaborators.invitedAt);

    return [
      {
        userId: workflow.userId,
        email: owner?.email,
        role: 'owner',
        // Владелец участвует с момента создания workflow: отдельной даты
        // «приглашения» у него нет.
        invitedAt: workflow.createdAt.toISOString(),
        invitedBy: workflow.userId,
      },
      ...rows
        .filter((row) => row.userId !== workflow.userId)
        .map((row) => ({
          userId: row.userId,
          email: row.email,
          role: row.role,
          invitedAt: row.invitedAt.toISOString(),
          invitedBy: row.invitedBy,
        })),
    ];
  }

  /**
   * Приглашает пользователя в workflow по uuid (R7.6; изоляция организаций —
   * v1.0.0 S2).
   *
   * Приглашает только владелец. Целевой пользователь обязан существовать **и
   * принадлежать организации арендатора** (`users.organization_id =
   * access.orgId`): инвайт по email вне scope v0.9, а приглашение пользователя
   * другой организации создало бы кросс-тенантную строку. Оба случая («нет
   * такого пользователя» и «пользователь в другой организации») дают один и
   * тот же 404 — факт существования чужого пользователя не раскрывается
   * (KI-202). Повторный инвайт того же пользователя — 409: роль меняется
   * отдельным PATCH.
   *
   * @param id - uuid workflow
   * @param access - пользователь и его организация из access-токена (должен быть владельцем)
   * @param dto - uuid приглашаемого и роль
   * @returns созданное участие
   * @throws NotFoundException если workflow чужой/не существует или пользователь не найден в организации
   * @throws BadRequestException если приглашают владельца workflow
   * @throws ConflictException если пользователь уже участвует
   */
  async inviteCollaboratorAsync(
    id: string,
    access: WorkflowAccess,
    dto: InviteCollaboratorDto,
  ): Promise<CollaboratorResponse> {
    const owner = await this.findOwnerAsync(id, access);

    if (owner === null) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }

    if (dto.userId === owner.ownerId) {
      throw new BadRequestException(
        'Владелец workflow не может быть участником',
      );
    }

    const [target] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      // S2: приглашать можно только «своих» — совпадение организации
      // обязательно, иначе 404 (как для несуществующего пользователя).
      .where(
        and(eq(users.id, dto.userId), eq(users.organizationId, access.orgId)),
      )
      .limit(1);

    if (target === undefined) {
      throw new NotFoundException(`Пользователь ${dto.userId} не найден`);
    }

    const [existing] = await this.db
      .select({ userId: workflowCollaborators.userId })
      .from(workflowCollaborators)
      .where(
        and(
          eq(workflowCollaborators.workflowId, id),
          eq(workflowCollaborators.userId, dto.userId),
        ),
      )
      .limit(1);

    if (existing !== undefined) {
      throw new ConflictException('Пользователь уже участвует в workflow');
    }

    const [created] = await this.db
      .insert(workflowCollaborators)
      .values({
        workflowId: id,
        userId: dto.userId,
        role: dto.role,
        invitedBy: access.userId,
      })
      .returning();

    this.logger.debug(
      `Участник приглашён: workflow=${id}, userId=${dto.userId}, role=${dto.role}`,
    );

    return {
      userId: created.userId,
      email: target.email,
      role: created.role,
      invitedAt: created.invitedAt.toISOString(),
      invitedBy: created.invitedBy,
    };
  }

  /**
   * Меняет роль участника workflow (R7.6).
   *
   * Только владелец. Отсутствующий участник — 404: чужая строка не должна
   * выглядеть как успешная смена роли.
   *
   * @param id - uuid workflow
   * @param access - пользователь и его организация из access-токена (должен быть владельцем)
   * @param participantId - uuid участника из path
   * @param dto - новая роль
   * @returns обновлённое участие
   * @throws NotFoundException если workflow чужой/не существует или участник не найден
   */
  async updateCollaboratorRoleAsync(
    id: string,
    access: WorkflowAccess,
    participantId: string,
    dto: UpdateCollaboratorRoleDto,
  ): Promise<CollaboratorResponse> {
    const owner = await this.findOwnerAsync(id, access);

    if (owner === null) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }

    const [updated] = await this.db
      .update(workflowCollaborators)
      .set({ role: dto.role })
      .where(
        and(
          eq(workflowCollaborators.workflowId, id),
          eq(workflowCollaborators.userId, participantId),
        ),
      )
      .returning();

    if (updated === undefined) {
      throw new NotFoundException(`Участник ${participantId} не найден`);
    }

    return {
      userId: updated.userId,
      role: updated.role,
      invitedAt: updated.invitedAt.toISOString(),
      invitedBy: updated.invitedBy,
    };
  }

  /**
   * Удаляет участника из workflow (R7.6).
   *
   * Только владелец. После удаления пользователь теряет доступ к графу, но
   * его запуски и история остаются: `workflow_runs` привязаны к workflow, а не
   * к участнику.
   *
   * @param id - uuid workflow
   * @param access - пользователь и его организация из access-токена (должен быть владельцем)
   * @param participantId - uuid участника из path
   * @returns промис без значения
   * @throws NotFoundException если workflow чужой/не существует или участник не найден
   */
  async removeCollaboratorAsync(
    id: string,
    access: WorkflowAccess,
    participantId: string,
  ): Promise<void> {
    const owner = await this.findOwnerAsync(id, access);

    if (owner === null) {
      throw new NotFoundException(`Workflow ${id} не найден`);
    }

    const removed = await this.db
      .delete(workflowCollaborators)
      .where(
        and(
          eq(workflowCollaborators.workflowId, id),
          eq(workflowCollaborators.userId, participantId),
        ),
      )
      .returning({ userId: workflowCollaborators.userId });

    if (removed.length === 0) {
      throw new NotFoundException(`Участник ${participantId} не найден`);
    }
  }

  /**
   * Ищет workflow, которым владеет пользователь в его организации (R7.6,
   * v1.0.0 S2).
   *
   * Возвращает именно владельца (`workflows.user_id`), а не факт доступа:
   * приглашать, менять роли и удалять участников может только он. Условие
   * `workflows.organization_id = access.orgId` не даёт владельцу одной
   * организации управлять графом другой даже при совпадении uuid.
   *
   * @param id - uuid workflow
   * @param access - пользователь и его организация из access-токена
   * @returns `{ ownerId }` либо `null`, если workflow чужой/не существует
   */
  private async findOwnerAsync(
    id: string,
    access: WorkflowAccess,
  ): Promise<{ ownerId: string } | null> {
    const [row] = await this.db
      .select({ ownerId: workflows.userId })
      .from(workflows)
      .where(workflowOwnerFilter(id, access))
      .limit(1);

    return row ?? null;
  }
}
