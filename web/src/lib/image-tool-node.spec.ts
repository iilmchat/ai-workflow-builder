import { describe, expect, it } from 'vitest';
// Относительный путь (не `@/`): alias `@` в тестах настроен, но модуль лежит
// рядом — короткий путь читается проще.
import {
  inputUrlFromOutputs,
  isAudioUrlInvalid,
  pickInputPreviewUrl,
  readToolAudioUrl,
  withToolAudioUrl,
} from './image-tool-node';

/**
 * Юнит-тесты чистой логики узла `image_tool` (R7.1, KI-196).
 *
 * Проверяется логика превью и валидации без DOM; отображение компонента
 * (jsdom, KI-155) покрыто `components/nodes/ImageToolNode.spec.tsx`.
 */
describe('image_tool: превью входа (R7.1)', () => {
  it('берёт ссылку из порта url (выход image_generation)', () => {
    expect(inputUrlFromOutputs({ url: 'https://cdn/img.png' })).toBe(
      'https://cdn/img.png',
    );
  });

  it('понимает mediaUrl и resultUrls предыдущего инструмента', () => {
    expect(inputUrlFromOutputs({ mediaUrl: 'https://cdn/a.png' })).toBe(
      'https://cdn/a.png',
    );
    // Ссылка от другого `image_tool`: выход — массив (DESIGN § 3.1).
    expect(
      inputUrlFromOutputs({ resultUrls: ['https://cdn/b.png', 'https://cdn/c.png'] }),
    ).toBe('https://cdn/b.png');
  });

  it('принимает ссылку, пришедшую текстом от Text/LLM-узла', () => {
    expect(inputUrlFromOutputs({ text: 'https://cdn/text.png' })).toBe(
      'https://cdn/text.png',
    );
  });

  it('отбрасывает небезопасные и нестроковые значения (KI-006)', () => {
    // `javascript:` и SVG-`data:` в <img src> недопустимы, объект — не ссылка.
    expect(inputUrlFromOutputs({ url: 'javascript:alert(1)' })).toBeNull();
    expect(inputUrlFromOutputs({ text: 'просто текст' })).toBeNull();
    expect(inputUrlFromOutputs({ url: { href: 'https://cdn/img.png' } })).toBeNull();
    expect(inputUrlFromOutputs(undefined)).toBeNull();
  });

  it('выбирает первый непустой вход, а при его отсутствии — data.inputUrl', () => {
    expect(
      pickInputPreviewUrl([null, 'https://cdn/in.png'], undefined),
    ).toBe('https://cdn/in.png');
    expect(
      pickInputPreviewUrl([null], 'https://cdn/declared.png'),
    ).toBe('https://cdn/declared.png');
    // Небезопасный `data.inputUrl` не подставляется.
    expect(pickInputPreviewUrl([], 'javascript:alert(1)')).toBeNull();
    expect(pickInputPreviewUrl([], undefined)).toBeNull();
  });
});

describe('image_tool: audioUrl для lipsync (KI-369)', () => {
  it('читает строку и игнорирует нестроковые значения', () => {
    expect(readToolAudioUrl({ audioUrl: 'https://cdn/voice.mp3' })).toBe(
      'https://cdn/voice.mp3',
    );
    expect(readToolAudioUrl({ audioUrl: 42 })).toBe('');
    expect(readToolAudioUrl(undefined)).toBe('');
    expect(readToolAudioUrl(null)).toBe('');
    expect(readToolAudioUrl(['https://cdn/voice.mp3'])).toBe('');
  });

  it('добавляет audioUrl, сохраняя остальные параметры операции', () => {
    expect(
      withToolAudioUrl(
        { prompt: 'говори как диктор', duration: 5 },
        '  https://cdn/voice.mp3  ',
      ),
    ).toMatchObject({
      prompt: 'говори как диктор',
      duration: 5,
      audioUrl: 'https://cdn/voice.mp3',
    });
  });

  it('удаляет ключ при пустом значении (KI-129)', () => {
    const next = withToolAudioUrl(
      { audioUrl: 'https://cdn/old.mp3', prompt: 'x' },
      '   ',
    );

    expect(next).toMatchObject({ prompt: 'x' });
    expect(next).not.toHaveProperty('audioUrl');
  });

  it('создаёт params, если у узла их ещё нет', () => {
    expect(withToolAudioUrl(undefined, 'https://cdn/voice.mp3')).toMatchObject({
      audioUrl: 'https://cdn/voice.mp3',
    });
    expect(
      withToolAudioUrl('не объект', 'https://cdn/voice.mp3'),
    ).toMatchObject({
      audioUrl: 'https://cdn/voice.mp3',
    });
  });
});

describe('image_tool: валидация audioUrl (KI-424)', () => {
  it('принимает http(s)-ссылки, в том числе в верхнем регистре схемы', () => {
    expect(isAudioUrlInvalid('https://cdn/voice.mp3')).toBe(false);
    expect(isAudioUrlInvalid('http://cdn/voice.mp3')).toBe(false);
    // Схема по RFC 3986 регистронезависима (ср. KI-430).
    expect(isAudioUrlInvalid('HTTPS://CDN/VOICE.MP3')).toBe(false);
    expect(isAudioUrlInvalid('  https://cdn/voice.mp3  ')).toBe(false);
  });

  it('отвергает чужую схему и строку без схемы', () => {
    expect(isAudioUrlInvalid('ftp://cdn/voice.mp3')).toBe(true);
    expect(isAudioUrlInvalid('javascript:alert(1)')).toBe(true);
    expect(isAudioUrlInvalid('cdn/voice.mp3')).toBe(true);
    // `http:foo` формально URL, но не начинается с `http://`.
    expect(isAudioUrlInvalid('http:cdn/voice.mp3')).toBe(true);
  });

  it('считает пустое поле нейтральным, а `https://` без хоста — ошибкой', () => {
    expect(isAudioUrlInvalid('')).toBe(false);
    expect(isAudioUrlInvalid('   ')).toBe(false);
    expect(isAudioUrlInvalid('https://')).toBe(true);
  });
});
