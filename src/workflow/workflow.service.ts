import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflows, type NewWorkflow, type Workflow } from '../db/schema.js';
import type { EdgeDto, NodeDto } from '../engine/dto/index.js';
import type {
  CreateWorkflowDto,
  ShareTokenDto,
  SharedWorkflow,
  UpdateWorkflowDto,
} from './dto/index.js';

/** Значение limit по умолчанию для постраничного списка. */
const DEFAULT_LIMIT = 50;
/** Значение offset по умолчанию для постраничного списка. */
const DEFAULT_OFFSET = 0;
/** Префикс относительной share-ссылки (R6.2.1). */
const SHARE_URL_PREFIX = '/workflow/share/';

/**
 * Сервис CRUD-операций над workflow.
 *
 * Все методы поддерживают необязательный `userId`: пока auth не реализован,
 * параметр не передаётся и выборка идёт без ограничения по владельцу; после
 * подключения auth он станет обязательным фильтром принадлежности.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Создаёт новый workflow.
   *
   * Владелец приходит из access-токена аргументом (KI-204: в DTO его больше
   * нет), `nodes`/`edges` — уже с применёнными значениями по умолчанию `[]`.
   *
   * @param dto - валидированные данные создания workflow
   * @param userId - id владельца (uuid из токена)
   * @returns созданная запись workflow
   */
  async createAsync(dto: CreateWorkflowDto, userId: string): Promise<Workflow> {
    const [created] = await this.db
      .insert(workflows)
      .values({
        userId,
        name: dto.name,
        description: dto.description,
        nodes: dto.nodes,
        edges: dto.edges,
      })
      .returning();

    this.logger.debug(`Workflow создан: id=${created.id}, userId=${created.userId}`);

    return created;
  }

  /**
   * Возвращает список workflow с фильтром по владельцу и пагинацией.
   *
   * Сортировка — по `createdAt` по убыванию (сначала новые).
   *
   * @param userId - необязательный идентификатор владельца
   * @param limit - максимум записей в ответе, по умолчанию 50
   * @param offset - сколько записей пропустить, по умолчанию 0
   * @returns массив найденных workflow
   */
  async findAllAsync(
    userId?: string,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
  ): Promise<Workflow[]> {
    const query = this.db
      .select()
      .from(workflows)
      .where(userId ? eq(workflows.userId, userId) : undefined)
      .orderBy(desc(workflows.createdAt))
      .limit(limit)
      .offset(offset);

    return query;
  }

  /**
   * Возвращает один workflow по идентификатору.
   *
   * @param id - uuid workflow
   * @param userId - необязательный идентификатор владельца; если передан,
   *   запись ищется с учётом принадлежности (заготовка под auth)
   * @returns найденный workflow или `null`
   */
  async findOneAsync(id: string, userId?: string): Promise<Workflow | null> {
    const [found] = await this.db
      .select()
      .from(workflows)
      .where(this.buildAccessFilter(id, userId))
      .limit(1);

    return found ?? null;
  }

  /**
   * Обновляет workflow и помечает его свежим `updatedAt`.
   *
   * @param id - uuid workflow
   * @param dto - валидированные поля для обновления (все необязательные)
   * @param userId - необязательный идентификатор владельца (проверка принадлежности)
   * @returns обновлённый workflow или `null`, если запись не найдена
   * @throws BadRequestException если не передано ни одного поля для обновления
   */
  async updateAsync(
    id: string,
    dto: UpdateWorkflowDto,
    userId?: string,
  ): Promise<Workflow | null> {
    // KI-014: колонки типизированы через `$type<NodeDto[]>()` / `$type<EdgeDto[]>()`,
    // а DTO обновления принимает `unknown[]`: узлы сохраняются «как есть»
    // (включая UI-поля React Flow), поэтому приведение сужено до двух полей
    // и не меняет поведение. Валидация формы графа — на входе в engine.
    const values: Partial<NewWorkflow> = {
      ...dto,
      nodes: dto.nodes as NodeDto[] | undefined,
      edges: dto.edges as EdgeDto[] | undefined,
      updatedAt: new Date(),
    };

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Не передано ни одного поля для обновления');
    }

    const [updated] = await this.db
      .update(workflows)
      .set(values)
      .where(this.buildAccessFilter(id, userId))
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
   * @param userId - необязательный идентификатор владельца (проверка принадлежности)
   * @returns `true`, если запись удалена; `false`, если ничего не найдено
   */
  async removeAsync(id: string, userId?: string): Promise<boolean> {
    const deleted = await this.db
      .delete(workflows)
      .where(this.buildAccessFilter(id, userId))
      .returning({ id: workflows.id });

    return deleted.length > 0;
  }

  /**
   * Собирает условие WHERE: по id и, при наличии, по владельцу.
   *
   * @param id - uuid workflow
   * @param userId - необязательный идентификатор владельца
   * @returns условие для Drizzle (`eq` либо `and(eq, eq)`)
   */
  private buildAccessFilter(
    id: string,
    userId?: string,
  ): ReturnType<typeof and> | ReturnType<typeof eq> {
    return userId
      ? and(eq(workflows.id, id), eq(workflows.userId, userId))
      : eq(workflows.id, id);
  }

  /**
   * Создаёт или перевыпускает share-токен workflow (R6.2.1).
   *
   * Токен — capability: доступ даёт само его знание, БД генерирует uuid v4
   * (`gen_random_uuid()`). В логи токен не пишется (RULES 5.9). Чужой workflow
   * неотличим от несуществующего: 404, а не 403.
   *
   * @param id - uuid workflow
   * @param userId - владелец из access-токена
   * @returns токен и относительный путь ссылки
   * @throws NotFoundException если workflow не найден или принадлежит другому
   */
  async createShareTokenAsync(id: string, userId: string): Promise<ShareTokenDto> {
    const [updated] = await this.db
      .update(workflows)
      .set({ shareToken: sql`gen_random_uuid()`, updatedAt: new Date() })
      .where(this.buildAccessFilter(id, userId))
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
   * @param userId - владелец из access-токена
   * @returns промис без значения
   * @throws NotFoundException если workflow не найден или принадлежит другому
   */
  async revokeShareTokenAsync(id: string, userId: string): Promise<void> {
    const revoked = await this.db
      .update(workflows)
      .set({ shareToken: null, updatedAt: new Date() })
      .where(this.buildAccessFilter(id, userId))
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
}
