import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { EdgeDto, GraphDto } from './dto/index.js';

/** Результат проверки графа: ошибки блокируют запуск, warnings — нет. */
export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Один вход узла: от какого узла и с какого порта приходит значение. */
export interface ExecutionInputRef {
  fromNode: string;
  fromPort: string;
}

/** План выполнения одного узла. */
export interface ExecutionNodePlan {
  inputs: Record<string, ExecutionInputRef>;
  dependents: string[];
}

/** План выполнения всего графа. */
export interface ExecutionPlanDto {
  order: string[];
  levels: string[][];
  executionMap: Record<string, ExecutionNodePlan>;
}

/** Внутреннее представление графа: индексы вместо повторных проходов по массивам. */
interface GraphIndex {
  nodes: GraphDto['nodes'];
  edges: GraphDto['edges'];
  ids: Set<string>;
  /** id узла → исходящие связи (для расчёта in-degree и dependents). */
  outgoing: Map<string, EdgeDto[]>;
  /** id узла → количество входящих связей. */
  indegree: Map<string, number>;
  /** Связи, ссылающиеся на несуществующие узлы, не попадают в обход. */
  orphanEdges: EdgeDto[];
}

/** Накопленные ошибки и warnings проверки графа. */
interface GraphIssues {
  errors: string[];
  warnings: string[];
}

/**
 * Сервис выполнения графа workflow: проверка, топологическая сортировка и
 * построение плана выполнения по уровням параллелизма.
 *
 * Работает только с DTO графа и не обращается к базе данных.
 */
@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  /**
   * Проверяет граф и собирает все найденные проблемы.
   *
   * Проверки не прерываются на первой ошибке: возвращаются сразу все, чтобы
   * пользователь увидел полную картину. `errors` делают граф невалидным,
   * `warnings` — нет.
   *
   * Проверяются: непустой список узлов, непустые и уникальные `id`,
   * существование узлов для каждого конца связи, отсутствие self-loops и
   * циклов. Как warnings отмечаются изолированные узлы и пустой `type`.
   *
   * @param graph - валидированный DTO графа
   * @param options.requireNodes - требовать хотя бы один узел (для проверки
   *   валидности); `false` допускает пустой граф, что нужно для сортировки
   * @returns результат проверки с массивами ошибок и предупреждений
   */
  validateGraphAsync(
    graph: GraphDto,
    options: { requireNodes?: boolean } = {},
  ): GraphValidationResult {
    const { requireNodes = true } = options;
    const index = this.buildIndex(graph);
    const issues: GraphIssues = { errors: [], warnings: [] };

    if (requireNodes && graph.nodes.length === 0) {
      issues.errors.push('Граф не содержит узлов');
    }

    this.collectNodeIssues(index, issues);
    this.collectEdgeIssues(index, issues);
    this.collectCycleIssues(index, issues);

    this.logger.debug(
      `Проверка графа: узлов=${graph.nodes.length}, связей=${graph.edges.length}, ` +
        `ошибок=${issues.errors.length}, warnings=${issues.warnings.length}`,
    );

    return {
      valid: issues.errors.length === 0,
      errors: issues.errors,
      warnings: issues.warnings,
    };
  }

  /**
   * Топологическая сортировка графа алгоритмом Кана.
   *
   * Алгоритм: считаем входящие степени (in-degree) каждого узла, ставим в
   * очередь все узлы с нулевой степенью (точки входа), затем последовательно
   * «вынимаем» узел из очереди, добавляем его в результат и уменьшаем
   * in-degree всех его потомков. Как только у потомка счётчик становится
   * нулевым, все его предшественники уже выполнены, поэтому он тоже попадает
   * в очередь.
   *
   * Если обработано меньше узлов, чем есть в графе, — оставшиеся узлы взаимно
   * достижимы, то есть образуют цикл.
   *
   * @param graph - валидированный DTO графа
   * @returns массив `id` узлов в порядке выполнения
   * @throws BadRequestException если в графе есть цикл или связи ссылаются на
   *   несуществующие узлы (порядок выполнения построить нельзя)
   */
  async topologicalSortAsync(graph: GraphDto): Promise<string[]> {
    this.assertExecutable(graph);

    const index = this.buildIndex(graph);
    const order = this.kahnOrder(index);

    if (order.length !== graph.nodes.length) {
      throw new BadRequestException(this.cycleError(graph, index));
    }

    return order;
  }

  /**
   * Строит план выполнения графа: плоский порядок, уровни параллелизма и
   * карту узлов с их входами и зависимыми узлами.
   *
   * Уровни — это «волны» алгоритма Кана: в уровень попадают узлы, все
   * предшественники которых входят в предыдущие уровни. Такие узлы не зависят
   * друг от друга, поэтому внутри уровня их можно запускать параллельно.
   *
   * Для каждого узла строится `executionMap`:
   * - `inputs` — что подать на вход: ключ → откуда приходит значение
   *   (`fromNode`, `fromPort` = `sourceHandle`, по умолчанию `output`).
   *   Ключ выбирается по приоритету `targetHandle` → `sourceHandle` → `edge.id`:
   *   несколько входов без заданных портов больше не перезаписывают друг
   *   друга (KI-003);
   * - `dependents` — `id` узлов, которые ждут завершения этого узла.
   *
   * @param graph - валидированный DTO графа
   * @returns план выполнения графа
   * @throws BadRequestException если в графе есть цикл или битые связи
   */
  async buildExecutionPlanAsync(graph: GraphDto): Promise<ExecutionPlanDto> {
    this.assertExecutable(graph);

    const index = this.buildIndex(graph);
    const levels = this.kahnLevels(index);

    if (!levels) {
      throw new BadRequestException(this.cycleError(graph, index));
    }

    const executionMap: Record<string, ExecutionNodePlan> = {};
    for (const node of graph.nodes) {
      executionMap[node.id] = { inputs: {}, dependents: [] };
    }

    for (const edge of index.edges) {
      const plan = executionMap[edge.target];

      if (plan) {
        plan.inputs[edge.targetHandle ?? edge.sourceHandle ?? edge.id] = {
          fromNode: edge.source,
          fromPort: edge.sourceHandle ?? 'output',
        };
      }

      const sourcePlan = executionMap[edge.source];
      if (sourcePlan) {
        sourcePlan.dependents.push(edge.target);
      }
    }

    return {
      order: levels.flat(),
      levels,
      executionMap,
    };
  }

  /**
   * Ищет цикл в графе обходом в глубину с раскраской вершин.
   *
   * Цвета: white — узел ещё не посещён, gray — находится в текущем стеке
   * обхода (путь от корня до текущей вершины), black — полностью обработан.
   * Ребро в серую вершину означает возврат к предку, то есть цикл.
   *
   * @param graph - валидированный DTO графа
   * @returns массив `id` узлов, образующих цикл (первый узел повторён в конце),
   *   либо `null`, если циклов нет
   */
  private detectCycle(graph: GraphDto): string[] | null {
    const index = this.buildIndex(graph);
    const adjacency = this.adjacency(index);

    // 0 — white, 1 — gray, 2 — black.
    const colors = new Map<string, number>();
    const parent = new Map<string, string>();

    for (const node of index.nodes) {
      colors.set(node.id, 0);
    }

    const visit = (nodeId: string): string[] | null => {
      colors.set(nodeId, 1);

      for (const next of adjacency.get(nodeId) ?? []) {
        if (colors.get(next) === 1) {
          return this.reconstructCycle(nodeId, next, parent);
        }

        if (colors.get(next) === 0) {
          parent.set(next, nodeId);

          const cycle = visit(next);
          if (cycle) {
            return cycle;
          }
        }
      }

      colors.set(nodeId, 2);

      return null;
    };

    for (const node of index.nodes) {
      if (colors.get(node.id) === 0) {
        const cycle = visit(node.id);
        if (cycle) {
          return cycle;
        }
      }
    }

    return null;
  }

  /**
   * Восстанавливает путь цикла по ссылкам на родителей.
   *
   * @param from - узел, из которого пришли в уже серую вершину
   * @param repeat - серая вершина, к которой вернулись (начало цикла)
   * @param parent - карта «узел → предок» в дереве обхода
   * @returns узлы цикла в порядке обхода, с повторённым первым элементом
   */
  private reconstructCycle(
    from: string,
    repeat: string,
    parent: Map<string, string>,
  ): string[] {
    const path: string[] = [repeat];
    let current = from;

    while (current !== repeat) {
      path.push(current);
      const next = parent.get(current);

      // Страховка от несогласованного состояния: без предка цикл не собрать.
      if (next === undefined) {
        break;
      }

      current = next;
    }

    path.push(repeat);

    return path.reverse();
  }

  /**
   * Порядок Кана: очередь узлов с нулевым in-degree, потомки уменьшают счётчики.
   *
   * @param index - проиндексированный граф
   * @returns плоский порядок обхода (короче числа узлов, если есть цикл)
   */
  private kahnOrder(index: GraphIndex): string[] {
    const indegree = new Map(index.indegree);
    const adjacency = this.adjacency(index);
    const queue: string[] = [];

    for (const node of index.nodes) {
      if ((indegree.get(node.id) ?? 0) === 0) {
        queue.push(node.id);
      }
    }

    const order: string[] = [];

    // Указатель вместо shift(): не перекладываем массив на каждом шаге.
    for (let head = 0; head < queue.length; head += 1) {
      const nodeId = queue[head];
      order.push(nodeId);

      for (const next of adjacency.get(nodeId) ?? []) {
        const left = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, left);

        if (left === 0) {
          queue.push(next);
        }
      }
    }

    return order;
  }

  /**
   * Уровни параллелизма: «волны» Кана, где каждый уровень ждёт предыдущий.
   *
   * @param index - проиндексированный граф
   * @returns массив уровней или `null`, если в графе есть цикл
   */
  private kahnLevels(index: GraphIndex): string[][] | null {
    const indegree = new Map(index.indegree);
    const adjacency = this.adjacency(index);

    let currentLevel = index.nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .map((node) => node.id);

    const levels: string[][] = [];
    let processed = 0;

    while (currentLevel.length > 0) {
      levels.push(currentLevel);
      processed += currentLevel.length;

      const nextLevel: string[] = [];

      for (const nodeId of currentLevel) {
        for (const next of adjacency.get(nodeId) ?? []) {
          const left = (indegree.get(next) ?? 0) - 1;
          indegree.set(next, left);

          if (left === 0) {
            nextLevel.push(next);
          }
        }
      }

      currentLevel = nextLevel;
    }

    // Не все узлы попали в уровни — оставшиеся образуют цикл.
    return processed === index.nodes.length ? levels : null;
  }

  /**
   * Список смежности: `id` узла → `id` узлов-потомков.
   *
   * @param index - проиндексированный граф
   */
  private adjacency(index: GraphIndex): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();

    for (const node of index.nodes) {
      adjacency.set(node.id, []);
    }

    for (const edge of index.edges) {
      adjacency.get(edge.source)?.push(edge.target);
    }

    return adjacency;
  }

  /**
   * Индексирует граф: набор id, исходящие связи и входящие степени.
   *
   * Связи с несуществующими концами собираются в `orphanEdges` и не участвуют
   * в обходе, чтобы топологическая сортировка не теряла узлы.
   *
   * @param graph - валидированный DTO графа
   */
  private buildIndex(graph: GraphDto): GraphIndex {
    const ids = new Set(graph.nodes.map((node) => node.id));
    const outgoing = new Map<string, EdgeDto[]>();
    const indegree = new Map<string, number>();

    for (const node of graph.nodes) {
      outgoing.set(node.id, []);
      indegree.set(node.id, 0);
    }

    const orphanEdges: EdgeDto[] = [];
    const edges: EdgeDto[] = [];

    for (const edge of graph.edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        orphanEdges.push(edge);
        continue;
      }

      edges.push(edge);
      outgoing.get(edge.source)?.push(edge);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }

    return { nodes: graph.nodes, edges, ids, outgoing, indegree, orphanEdges };
  }

  /**
   * Ошибки уровня узлов: пустые и дублирующиеся id.
   *
   * @param index - проиндексированный граф
   * @param issues - накопитель ошибок и warnings
   */
  private collectNodeIssues(index: GraphIndex, issues: GraphIssues): void {
    const seen = new Set<string>();

    for (const node of index.nodes) {
      if (typeof node.id !== 'string' || node.id.trim().length === 0) {
        issues.errors.push('Найден узел с пустым id');
      } else if (seen.has(node.id)) {
        issues.errors.push(`Дублирующийся id узла: ${node.id}`);
      } else {
        seen.add(node.id);
      }

      if (!node.type || node.type.trim().length === 0) {
        issues.warnings.push(`Узел ${node.id || '<без id>'} не имеет типа`);
      }
    }
  }

  /**
   * Ошибки и warnings уровня связей: битые ссылки, self-loops, изолированные узлы.
   *
   * @param index - проиндексированный граф
   * @param issues - накопитель ошибок и warnings
   */
  private collectEdgeIssues(index: GraphIndex, issues: GraphIssues): void {
    for (const edge of index.orphanEdges) {
      if (!index.ids.has(edge.source)) {
        issues.errors.push(
          `Связь ${edge.id} ссылается на несуществующий source: ${edge.source}`,
        );
      }

      if (!index.ids.has(edge.target)) {
        issues.errors.push(
          `Связь ${edge.id} ссылается на несуществующий target: ${edge.target}`,
        );
      }
    }

    for (const edge of index.edges) {
      if (edge.source === edge.target) {
        issues.errors.push(`Связь ${edge.id} является self-loop: ${edge.source}`);
      }
    }

    for (const node of index.nodes) {
      const hasIncoming = index.edges.some((edge) => edge.target === node.id);
      const hasOutgoing = (index.outgoing.get(node.id) ?? []).length > 0;

      if (!hasIncoming && !hasOutgoing) {
        issues.warnings.push(
          `Узел ${node.id} изолирован: нет входящих и исходящих связей`,
        );
      }
    }
  }

  /**
   * Ошибка цикла: ищет узлы цикла и добавляет описание в список ошибок.
   *
   * @param index - проиндексированный граф
   * @param issues - накопитель ошибок и warnings
   */
  private collectCycleIssues(index: GraphIndex, issues: GraphIssues): void {
    const cycle = this.detectCycle({ nodes: index.nodes, edges: index.edges });

    if (cycle) {
      issues.errors.push(`Граф содержит цикл: ${cycle.join(' → ')}`);
    }
  }

  /**
   * Сообщение об ошибке для графа, который нельзя выполнить.
   *
   * @param graph - исходный DTO графа
   * @param index - проиндексированный граф
   */
  private cycleError(graph: GraphDto, index: GraphIndex): string {
    const cycle = this.detectCycle({ nodes: graph.nodes, edges: index.edges });

    return cycle
      ? `Граф содержит цикл, порядок выполнения не определён: ${cycle.join(' → ')}`
      : 'Граф содержит цикл, порядок выполнения не определён';
  }

  /**
   * Не даёт строить порядок/план для заведомо неисполнимого графа.
   *
   * @param graph - валидированный DTO графа
   * @throws BadRequestException если граф пуст, содержит цикл или битые связи
   */
  private assertExecutable(graph: GraphDto): void {
    const result = this.validateGraphAsync(graph, { requireNodes: false });

    if (!result.valid) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Граф не может быть выполнен',
        errors: result.errors,
        warnings: result.warnings,
      });
    }
  }
}
