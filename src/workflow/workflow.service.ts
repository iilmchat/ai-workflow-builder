import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflows, type NewWorkflow, type Workflow } from '../db/schema.js';
import type { EdgeDto, NodeDto } from '../engine/dto/index.js';
import type { CreateWorkflowDto, UpdateWorkflowDto } from './dto/index.js';

/** Значение limit по умолчанию для постраничного списка. */
const DEFAULT_LIMIT = 50;
/** Значение offset по умолчанию для постраничного списка. */
const DEFAULT_OFFSET = 0;

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
   * `userId` берётся из DTO (пока это строка), `nodes`/`edges` приходят уже
   * с применёнными значениями по умолчанию `[]`.
   *
   * @param dto - валидированные данные создания workflow
   * @returns созданная запись workflow
   */
  async createAsync(dto: CreateWorkflowDto): Promise<Workflow> {
    const [created] = await this.db
      .insert(workflows)
      .values({
        userId: dto.userId,
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
}
