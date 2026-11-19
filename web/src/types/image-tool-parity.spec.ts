import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_IMAGE_TOOL_OPERATIONS } from './graph';

/**
 * KI-524: UI-список операций `image_tool` не должен расходиться с бэкендом.
 *
 * Backend обязан принимать больше (например, скрытый `chromakey` из KI-418),
 * но каждая операция, показанная в UI, должна существовать в
 * `IMAGE_TOOL_OPERATIONS` — иначе селект мертв.
 */
describe('image_tool: паритет операций UI ↔ backend (KI-524)', () => {
  it('каждая UI-опция есть в бэкенд-контракте', () => {
    const backendSource = readFileSync(
      resolve(import.meta.dirname, '../../../src/media/image-tool.ts'),
      'utf8',
    );
    const block = backendSource.match(
      /IMAGE_TOOL_OPERATIONS\s*=\s*\[([\s\S]*?)\]\s*as const/,
    );

    expect(block).not.toBeNull();

    const backendOps = new Set(
      [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
    );

    expect(backendOps.size).toBeGreaterThan(0);
    for (const op of UI_IMAGE_TOOL_OPERATIONS) {
      expect(backendOps.has(op), `UI-операция ${op} отсутствует в backend`).toBe(true);
    }
  });
});
