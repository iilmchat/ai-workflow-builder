/**
 * Преобразование уровней выполнения из `/engine/plan` в карту «узел → уровень».
 */

/**
 * Разворачивает уровни плана в карту номеров уровней.
 *
 * `[['a', 'b'], ['c']]` → `{ a: 0, b: 0, c: 1 }`. Уровни в бейджах показываем
 * с единицы, поэтому к индексу уровня прибавляем один.
 *
 * @param levels - уровни параллелизма из ответа `/engine/plan`
 * @returns карта «id узла → номер уровня» (нумерация с 1)
 */
export function levelsToMap(levels: string[][]): Record<string, number> {
  const map: Record<string, number> = {};

  levels.forEach((level, index) => {
    for (const nodeId of level) {
      map[nodeId] = index + 1;
    }
  });

  return map;
}
