import { describe, expect, it } from 'vitest';
import { resolveMediaSource, providerMediaUrlOf } from './media-source';

/**
 * Выбор media-источника в узле (R7.8/KI-362, KI-444).
 *
 * Фронтенд получает `storedUrl`/`storedExpiresAt` в метриках узла и обязан:
 * 1) показывать только свою ссылку — срок жизни ссылки провайдера неизвестен;
 * 2) при истёкшем TTL и при отсутствии своей копии показывать плейсхолдер
 *    «ссылка истекла», а не битую картинку.
 */
describe('resolveMediaSource: своя ссылка и TTL (R7.8, KI-444)', () => {
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

  it('KI-444: результат есть, а своей копии нет — тоже «ссылка истекла»', () => {
    // Старый прогон (до сохранения в S3) или сбой загрузки: TTL ссылки
    // провайдера неизвестен, поэтому подставлять её в разметку нельзя.
    expect(
      resolveMediaSource({
        outputs: { mediaUrl: 'https://cdn.creativelab.test/out.png' },
      }),
    ).toEqual({ src: null, expired: true, invalid: false });

    // У image_tool результат — массив resultUrls, правило то же.
    expect(
      resolveMediaSource({ outputs: { resultUrls: ['https://cdn/x.png'] } }),
    ).toEqual({ src: null, expired: true, invalid: false });
  });

  it('без результата вообще — обычный плейсхолдер, а не «истекла»', () => {
    expect(resolveMediaSource({})).toEqual({
      src: null,
      expired: false,
      invalid: false,
    });
  });

  it('небезопасная ссылка — invalid, а не expired', () => {
    expect(
      resolveMediaSource({ outputs: { mediaUrl: 'javascript:alert(1)' } }),
    ).toEqual({ src: null, expired: false, invalid: true });

    expect(
      resolveMediaSource({ storedUrl: 'javascript:alert(1)' }),
    ).toEqual({ src: null, expired: false, invalid: true });
  });

  it('своя ссылка без TTL считается живой', () => {
    expect(
      resolveMediaSource({ storedUrl: '/media/file/run-1/img-1.png' }),
    ).toEqual({ src: '/media/file/run-1/img-1.png', expired: false, invalid: false });
  });

  it('узнаёт ссылку провайдера в обеих формах выходов', () => {
    expect(
      providerMediaUrlOf({ mediaUrl: 'https://cdn.creativelab.test/out.png' }),
    ).toBe('https://cdn.creativelab.test/out.png');

    expect(providerMediaUrlOf({ resultUrls: ['https://cdn/x.png'] })).toBe(
      'https://cdn/x.png',
    );

    expect(providerMediaUrlOf(null)).toBeNull();
  });
});
