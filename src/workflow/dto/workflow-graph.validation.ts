import { z } from 'zod';

/**
 * Одно нарушение формы графа (KI-017).
 *
 * Путь повторяет структуру тела запроса (`nodes[2].id`, `edges[0].source`),
 * поэтому `ZodValidationPipe` складывает его в `validation.fieldErrors`, а
 * сообщение попадает в общий `message` ответа 400.
 */
export interface GraphValidationIssue {
  /** Путь до поля в теле запроса. */
  path: (string | number)[];
  /** Человекочитаемое описание нарушения. */
  message: string;
}

/**
 * Проверяет, что значение — обычный объект (не массив и не `null`).
 *
 * @param value - значение из `unknown[]`
 * @returns `true`, если это объект с доступом по ключу
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверяет, что значение — непустая строка.
 *
 * @param value - значение из `unknown`
 * @returns `true` для непустой строки
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Собирает нарушения в списке узлов: форма элемента, наличие `id`, дубликаты.
 *
 * Глубокая валидация `data`/`position` намеренно не делается: форму параметров
 * задаёт тип узла (engine), а UI-поля React Flow (`selected`, `measured`,
 * `dragging`) обязаны переживать round-trip (KI-014/KI-017). Здесь только
 * инварианты, без которых граф нельзя сохранить: у каждого узла есть
 * уникальный `id`.
 *
 * @param nodes - массив узлов из тела запроса
 * @returns список нарушений (пустой, если граф корректен)
 */
export function collectNodeIssues(
  nodes: readonly unknown[],
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const seenIds = new Set<string>();

  nodes.forEach((node, index) => {
    if (!isRecord(node)) {
      issues.push({
        path: ['nodes', index],
        message: `Узел #${index} должен быть объектом`,
      });

      return;
    }

    if (!isNonEmptyString(node.id)) {
      issues.push({
        path: ['nodes', index, 'id'],
        message: `Узел #${index}: id обязателен`,
      });

      return;
    }

    if (seenIds.has(node.id)) {
      issues.push({
        path: ['nodes', index, 'id'],
        message: `Дубликат id узла: ${node.id}`,
      });

      return;
    }

    seenIds.add(node.id);
  });

  return issues;
}

/**
 * Собирает нарушения формы связей: объект, непустые `source`/`target`.
 *
 * Ссылки на узлы здесь не проверяются — для этого нужен список узлов, см.
 * {@link collectEdgeReferenceIssues}. Разделение позволяет валидировать
 * `edges` в PATCH, где `nodes` может отсутствовать.
 *
 * @param edges - массив связей из тела запроса
 * @returns список нарушений (пустой, если форма связей корректна)
 */
export function collectEdgeShapeIssues(
  edges: readonly unknown[],
): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];

  edges.forEach((edge, index) => {
    if (!isRecord(edge)) {
      issues.push({
        path: ['edges', index],
        message: `Связь #${index} должна быть объектом`,
      });

      return;
    }

    if (!isNonEmptyString(edge.source)) {
      issues.push({
        path: ['edges', index, 'source'],
        message: `Связь #${index}: source обязателен`,
      });
    }

    if (!isNonEmptyString(edge.target)) {
      issues.push({
        path: ['edges', index, 'target'],
        message: `Связь #${index}: target обязателен`,
      });
    }
  });

  return issues;
}

/**
 * Проверяет, что `source`/`target` каждой связи ссылаются на существующий узел.
 *
 * Связи с невалидной формой пропускаются: про них уже сообщил
 * {@link collectEdgeShapeIssues}, и вторая ошибка про «несуществующий узел»
 * только запутала бы пользователя.
 *
 * @param nodes - массив узлов (уже проверенный или проверяемый вместе)
 * @param edges - массив связей
 * @returns список нарушений (пустой, если все ссылки валидны)
 */
export function collectEdgeReferenceIssues(
  nodes: readonly unknown[],
  edges: readonly unknown[],
): GraphValidationIssue[] {
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (isRecord(node) && isNonEmptyString(node.id)) {
      nodeIds.add(node.id);
    }
  }

  const issues: GraphValidationIssue[] = [];

  edges.forEach((edge, index) => {
    if (!isRecord(edge)) {
      return;
    }

    if (isNonEmptyString(edge.source) && !nodeIds.has(edge.source)) {
      issues.push({
        path: ['edges', index, 'source'],
        message: `Связь #${index} ссылается на несуществующий узел: ${edge.source}`,
      });
    }

    if (isNonEmptyString(edge.target) && !nodeIds.has(edge.target)) {
      issues.push({
        path: ['edges', index, 'target'],
        message: `Связь #${index} ссылается на несуществующий узел: ${edge.target}`,
      });
    }
  });

  return issues;
}

/**
 * Полная проверка графа: узлы + форма связей + ссылки.
 *
 * Используется сервисом как вторая граница (RULES § 1.17): Zod валидирует
 * HTTP-вход, но `WorkflowService` можно вызвать напрямую (импорт, внутренние
 * сценарии), и битый граф не должен попасть в БД в обход DTO.
 *
 * @param nodes - массив узлов
 * @param edges - массив связей
 * @returns список нарушений (пустой, если граф корректен)
 */
export function collectGraphIssues(
  nodes: readonly unknown[],
  edges: readonly unknown[],
): GraphValidationIssue[] {
  return [
    ...collectNodeIssues(nodes),
    ...collectEdgeShapeIssues(edges),
    ...collectEdgeReferenceIssues(nodes, edges),
  ];
}

/**
 * Переносит нарушения в контекст Zod-схемы.
 *
 * @param ctx - контекст `superRefine`
 * @param issues - нарушения из функций этого модуля
 * @returns ничего
 */
export function applyGraphIssues(
  ctx: z.RefinementCtx,
  issues: readonly GraphValidationIssue[],
): void {
  for (const issue of issues) {
    ctx.addIssue({
      code: 'custom',
      message: issue.message,
      path: issue.path,
    });
  }
}
