import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KI-310: спекам разрешены `node:*` модули через отдельный
 * `web/tsconfig.spec.json`, при этом приложение остаётся на `vite/client`.
 */
describe('node:* в web-спеках (KI-310)', () => {
  it('импорт node:path типизирован и работает', () => {
    expect(posix.join('a', 'b')).toBe('a/b');
  });
});
