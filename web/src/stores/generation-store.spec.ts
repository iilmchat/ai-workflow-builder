import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMediaModelsAsync, getWorkflowAsync } from '@/lib/api';
import type {
  AudioGenNodeData,
  MusicGenNodeData,
  VideoGenNodeData,
} from '@/types/graph';
import type { MediaModelInfo } from '@/types/media';
import { useWorkflowStore } from './workflow';

/**
 * Тесты стора для узлов media-генерации R7.2 (KI-361): создание узла с моделью
 * по умолчанию, ленивая загрузка каталогов VIDEO/AUDIO/MUSIC и round-trip
 * Save/Load.
 */

/**
 * Заглушка i18n: jsdom настроен (KI-155), но тест проверяет стор, а не
 * переводы. Подмена убирает зависимость от языка и побочных эффектов
 * `@/i18n` (`document.documentElement.lang`, localStorage).
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return { default: { t, language: 'ru' }, setLanguage: () => undefined };
});

/**
 * Заглушка API-слоя: каталоги и Load проверяются без сети.
 */
vi.mock('@/lib/api', () => ({
  createRunAsync: vi.fn(),
  createWorkflowAsync: vi.fn(),
  fetchLlmModelsAsync: vi.fn(() => Promise.resolve([])),
  fetchMediaModelsAsync: vi.fn(() => Promise.resolve([])),
  fetchRunBudgetAsync: vi.fn(),
  getWorkflowAsync: vi.fn(),
  planWorkflowAsync: vi.fn(),
  updateWorkflowAsync: vi.fn(),
}));

/** Заглушка SSE-потока: подписка в этих тестах не нужна. */
vi.mock('@/lib/run-stream', () => ({
  subscribeToRunStream: vi.fn(() => () => undefined),
  RunStreamUnavailableError: class RunStreamUnavailableError extends Error {},
}));

/**
 * Создаёт модель каталога.
 *
 * @param id - id модели
 * @param overrides - поля, которые нужно переопределить
 * @returns описание модели
 */
function model(
  id: string,
  overrides: Partial<MediaModelInfo> = {},
): MediaModelInfo {
  return {
    id,
    code: id,
    type: 'VIDEO',
    price: 55,
    priceUnit: 'per_generation',
    priceInput: null,
    priceInputUnit: null,
    moderation: 'auto',
    prompt: 'required',
    params: [],
    inputs: [],
    ...overrides,
  };
}

/** Короткий доступ к состоянию стора. */
function state() {
  return useWorkflowStore.getState();
}

describe('useWorkflowStore — узлы media-генерации (R7.2, KI-361)', () => {
  beforeEach(() => {
    // `loadWorkflowAsync` читает `?runId=` из адресной строки. jsdom-`window`
    // есть (KI-155), но подменяем location/history: тест не должен зависеть
    // от адреса тестового документа и трогать реальную историю.
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/?workflowId=w1' },
      history: { replaceState: () => undefined },
    });
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      selectedNodeId: null,
      executionLevels: {},
      generationModels: { VIDEO: [], AUDIO: [], MUSIC: [] },
      generationModelsLoaded: { VIDEO: false, AUDIO: false, MUSIC: false },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('addNode создаёт узлы без модели, если каталог не загружен (KI-129)', () => {
    for (const type of [
      'video_generation',
      'audio_generation',
      'music_generation',
    ] as const) {
      state().addNode(type, { x: 0, y: 0 });

      const node = state().nodes.at(-1);
      const data = node?.data as VideoGenNodeData;

      expect(node?.type).toBe(type);
      expect(data.kind).toBe(type);
      // Пустых ключей не создаём: модель подставит backend.
      expect(Object.keys(data)).toEqual(['kind']);
    }
  });

  it('addNode подставляет модель по умолчанию, если каталог загружен', () => {
    useWorkflowStore.setState({
      generationModels: {
        VIDEO: [model('kling-v3-motion'), model('wan-2.5')],
        AUDIO: [model('tts2', { type: 'MUSIC', params: [{ key: 'voice', type: 'string', label: 'voice' }] })],
        MUSIC: [model('suno', { type: 'MUSIC', price: 24 })],
      },
    });

    state().addNode('video_generation', { x: 0, y: 0 });
    state().addNode('audio_generation', { x: 0, y: 0 });
    state().addNode('music_generation', { x: 0, y: 0 });

    const [video, audio, music] = state().nodes;

    // Предпочтительный id, а не первая модель каталога.
    expect((video?.data as VideoGenNodeData).model).toBe('wan-2.5');
    expect((audio?.data as AudioGenNodeData).model).toBe('tts2');
    expect((music?.data as MusicGenNodeData).model).toBe('suno');
  });

  it('loadGenerationModelsAsync(AUDIO) объединяет AUDIO и TTS-модели из MUSIC', async () => {
    vi.mocked(fetchMediaModelsAsync).mockImplementation((type) => {
      if (type === 'AUDIO') {
        // Реальность CreativeLab: AUDIO-моделей нет вовсе.
        return Promise.resolve([]);
      }

      return Promise.resolve([
        model('suno', { type: 'MUSIC', price: 24 }),
        model('tts2', {
          type: 'MUSIC',
          price: 0,
          priceUnit: null,
          params: [{ key: 'voice', type: 'string', label: 'voice' }],
        }),
      ]);
    });

    await state().loadGenerationModelsAsync('AUDIO');

    expect(fetchMediaModelsAsync).toHaveBeenCalledWith('AUDIO');
    expect(fetchMediaModelsAsync).toHaveBeenCalledWith('MUSIC');
    // Генератор музыки в селект озвучки не попадает.
    expect(state().generationModels.AUDIO.map((item) => item.id)).toEqual(['tts2']);
    expect(state().generationModelsLoaded.AUDIO).toBe(true);
  });

  it('loadGenerationModelsAsync кэширует каталог и не повторяет запрос', async () => {
    vi.mocked(fetchMediaModelsAsync).mockResolvedValue([model('wan-2.5')]);

    await state().loadGenerationModelsAsync('VIDEO');
    await state().loadGenerationModelsAsync('VIDEO');

    expect(fetchMediaModelsAsync).toHaveBeenCalledTimes(1);
    expect(state().generationModels.VIDEO).toHaveLength(1);
  });

  it('сбой загрузки каталога не роняет стор (флаг остаётся снятым)', async () => {
    vi.mocked(fetchMediaModelsAsync).mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(state().loadGenerationModelsAsync('VIDEO')).resolves.toBeUndefined();

    expect(state().generationModelsLoaded.VIDEO).toBe(false);
    expect(state().generationModels.VIDEO).toEqual([]);
  });

  it('Load переносит поля узлов video/audio/music (round-trip)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      name: 'wf',
      version: 1,
      nodes: [
        {
          id: 'video-1',
          type: 'video_generation',
          position: { x: 0, y: 0 },
          data: {
            model: 'wan-2.5',
            prompt: 'кот идёт по крыше',
            imageUrl: 'https://cdn/frame.png',
            durationSec: 10,
            aspectRatio: '16:9',
          },
        },
        {
          id: 'audio-1',
          type: 'audio_generation',
          position: { x: 0, y: 0 },
          data: { model: 'tts2', text: 'привет', voiceId: 'ru-1', speed: 1.5 },
        },
        {
          id: 'music-1',
          type: 'music_generation',
          position: { x: 0, y: 0 },
          data: { model: 'grom-zvuk', prompt: 'трек', durationSec: 30, genre: 'rock' },
        },
      ],
      edges: [],
    });

    await state().loadWorkflowAsync('w1');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'video_generation',
      model: 'wan-2.5',
      prompt: 'кот идёт по крыше',
      imageUrl: 'https://cdn/frame.png',
      durationSec: 10,
      aspectRatio: '16:9',
    });
    expect(state().nodes[1]?.data).toEqual({
      kind: 'audio_generation',
      model: 'tts2',
      text: 'привет',
      voiceId: 'ru-1',
      speed: 1.5,
    });
    expect(state().nodes[2]?.data).toEqual({
      kind: 'music_generation',
      model: 'grom-zvuk',
      prompt: 'трек',
      durationSec: 30,
      genre: 'rock',
    });
  });

  it('Load отбрасывает мусорные значения, не роняя узел (RULES 1.17)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      name: 'wf',
      version: 1,
      nodes: [
        {
          id: 'video-1',
          type: 'video_generation',
          position: { x: 0, y: 0 },
          // `durationSec` строкой и вне диапазона, мусор в `params`.
          data: { durationSec: '999', params: 'не объект' },
        },
        {
          id: 'audio-1',
          type: 'audio_generation',
          position: { x: 0, y: 0 },
          // `speed` вне диапазона DESIGN § 3.2 (0.5–2).
          data: { speed: 9 },
        },
      ],
      edges: [],
    });

    await state().loadWorkflowAsync('w1');

    const video = state().nodes[0]?.data as VideoGenNodeData;
    const audio = state().nodes[1]?.data as AudioGenNodeData;

    expect(Object.keys(video).sort()).toEqual(['kind']);
    expect(Object.keys(audio).sort()).toEqual(['kind']);
  });
});
