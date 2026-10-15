/**
 * Единицы длительности, поддерживаемые в env: `<N><s|m|h|d>`.
 *
 * Пакет `ms` не тянем: нужен один формат и предсказуемая ошибка.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Переводит длительность из окружения в миллисекунды.
 *
 * Используется для `maxAge` refresh-cookie и для `expires_at` в БД
 * (R6.1b): cookie и строка `refresh_tokens` должны истекать одновременно.
 *
 * @param value - строка вида `30s`, `15m`, `24h`, `7d`
 * @returns длительность в миллисекундах
 * @throws Error если формат не `<N><s|m|h|d>`
 */
export function parseDurationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());

  if (match === null) {
    throw new Error(
      `Неверный формат длительности: «${value}» (ожидается <N><s|m|h|d>)`,
    );
  }

  return Number(match[1]) * (UNIT_MS[match[2]] ?? 0);
}
