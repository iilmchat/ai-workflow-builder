import { describe, expect, it } from 'vitest';
import { parseQrPayload } from './qr-payload';

/** Валидный uuid v4 для тестов. */
const WORKFLOW_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('parseQrPayload (v1.5.0 S1)', () => {
  it('распознаёт uuid — id сохранённого workflow', () => {
    expect(parseQrPayload(WORKFLOW_ID)).toEqual({
      kind: 'workflow',
      id: WORKFLOW_ID,
    });
  });

  it('распознаёт uuid в верхнем регистре и с пробелами по краям', () => {
    expect(parseQrPayload(`  ${WORKFLOW_ID.toUpperCase()}\n`)).toEqual({
      kind: 'workflow',
      id: WORKFLOW_ID.toUpperCase(),
    });
  });

  it('распознаёт абсолютную share-ссылку и оставляет только путь', () => {
    expect(
      parseQrPayload(`https://app.example/workflow/share/${WORKFLOW_ID}`),
    ).toEqual({ kind: 'share', path: `/workflow/share/${WORKFLOW_ID}` });
  });

  it('отбрасывает query-строку и хвостовой слэш share-ссылки', () => {
    expect(
      parseQrPayload(
        `https://app.example/workflow/share/${WORKFLOW_ID}/?utm=qr`,
      ),
    ).toEqual({ kind: 'share', path: `/workflow/share/${WORKFLOW_ID}` });
  });

  it('распознаёт относительную share-ссылку', () => {
    expect(parseQrPayload(`/workflow/share/${WORKFLOW_ID}`)).toEqual({
      kind: 'share',
      path: `/workflow/share/${WORKFLOW_ID}`,
    });
  });

  it('возвращает null для чужого URL, текста и share-ссылки с не-uuid', () => {
    expect(
      parseQrPayload('https://evil.example/workflow/share/abc'),
    ).toBeNull();
    expect(parseQrPayload('https://evil.example/login')).toBeNull();
    expect(parseQrPayload('просто текст')).toBeNull();
    expect(parseQrPayload(`/workflow/share/${WORKFLOW_ID}-extra`)).toBeNull();
  });

  it('возвращает null для пустой строки', () => {
    expect(parseQrPayload('')).toBeNull();
    expect(parseQrPayload('   ')).toBeNull();
  });
});
