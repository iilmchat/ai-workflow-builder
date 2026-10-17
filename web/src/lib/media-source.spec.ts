import { describe, expect, it } from 'vitest';
import { resolveMediaSource, providerMediaUrlOf } from './media-source';

/**
 * Выбор media-источника в узле (R7.8, KI-362).
 *
 * Фронтенд получает `storedUrl`/`storedExpiresAt` в метриках узла и обязан:
 * 1) предпочесть свою ссылку ссылке провайдера;
 * 2) показать плейсхолдер «ссылка истекла», а не битую картинку.
 */
describe('resolveMediaSource: своя ссылка и TTL (R7.8)', () => {
  it('предпочитает storedUrl ссылке провайдера', () => {
    const source = resolveMediaSource({
      outputs: { mediaUrl: 'https://cdn.creativelab.test/out.png' },
      storedUrl: '/media/file/run-1/img-1.png',
      storedExpiresAt: '2026-12-01T00:00:00.000Z',
      now: Date.parse('2026-10-18T00:00:00.000Z'),
    });

    expect(source).toEqual({
      src: '/media/file/run-1/img-1.png',
      expired: false,
      invalid: false,
    });
  });

  it('истёкший storedUrl — маркер «ссылка истекла», даже если ссылка провайдера ещё в outputs', () => {
    const source = resolveMediaSource({
      outputs: { mediaUrl: 'https://cdn.creativelab.test/out.png' },
      storedUrl: '/media/file/run-1/img-1.png',
      storedExpiresAt: '2026-10-01T00:00:00.000Z',
      now: Date.parse('2026-10-18T00:00:00.000Z'),
    });

    expect(source).toEqual({ src: null, expired: true, invalid: false });
  });

  it('без своей ссылки отдаёт ссылку провайдера, а нерабочую — как invalid', () => {
    expect(
      resolveMediaSource({
        outputs: { mediaUrl: 'https://cdn.creativelab.test/out.png' },
      }).src,
    ).toBe('https://cdn.creativelab.test/out.png');

    expect(
      resolveMediaSource({ outputs: { mediaUrl: 'javascript:alert(1)' } }),
    ).toEqual({ src: null, expired: false, invalid: true });

    // У image_tool результат — массив resultUrls.
    expect(providerMediaUrlOf({ resultUrls: ['https://cdn/x.png'] })).toBe(
      'https://cdn/x.png',
    );
  });
});
