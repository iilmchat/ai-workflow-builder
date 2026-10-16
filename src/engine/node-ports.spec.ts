import {
  DEFAULT_OUTPUT_PORT_BY_NODE_TYPE,
  NODE_PORT_CONTRACT,
  handleIdToOutputPort,
  inferDefaultOutputPort,
  inferInputPortName,
} from './node-ports.js';

describe('node-ports', () => {
  describe('handleIdToOutputPort', () => {
    it('переводит id хендлов React Flow в имена портов (KI-030)', () => {
      expect(handleIdToOutputPort('text-output')).toBe('text');
      // R7.1: `image_generation` пишет `mediaUrl` — порт исправлен.
      expect(handleIdToOutputPort('image-output')).toBe('mediaUrl');
    });

    it('возвращает null для пустого или неизвестного хендла (KI-030)', () => {
      expect(handleIdToOutputPort(null)).toBeNull();
      expect(handleIdToOutputPort(undefined)).toBeNull();
      expect(handleIdToOutputPort('')).toBeNull();
      expect(handleIdToOutputPort('unknown-handle')).toBeNull();
    });

    it('не подставляет порт чужого типа: image_generation + text-output → null (KI-301)', () => {
      // До KI-301 поиск по всем контрактам отдавал 'text', хотя у узла
      // `image_generation` в outputs только `url` — зависимый узел читал null.
      expect(handleIdToOutputPort('text-output', 'image_generation')).toBeNull();
      // Свой хендл того же типа по-прежнему разрешается.
      expect(handleIdToOutputPort('image-output', 'image_generation')).toBe('mediaUrl');
      // Симметричный случай: text-узел с чужим image-output.
      expect(handleIdToOutputPort('image-output', 'text')).toBeNull();
    });

    it('разрешает хендл по контракту типа-источника (KI-301)', () => {
      expect(handleIdToOutputPort('text-output', 'text')).toBe('text');
      expect(handleIdToOutputPort('text-output', 'llm')).toBe('text');
      expect(handleIdToOutputPort('result-output', 'sub_workflow')).toBe('result');
      expect(handleIdToOutputPort('http-output', 'http')).toBe('result');
    });

    it('падает на нетипизированный поиск, если у типа нет контракта (KI-301)', () => {
      // У `compare`/`merge` контракта в реестре нет — прежнее поведение KI-030
      // сохраняется, чтобы не потерять данные у узлов без контракта.
      expect(handleIdToOutputPort('text-output', 'compare')).toBe('text');
      expect(handleIdToOutputPort('text-output', 'merge')).toBe('text');
      expect(handleIdToOutputPort('text-output', '')).toBe('text');
    });

    it('возвращает null для null sourceHandle даже с известным типом (KI-301)', () => {
      expect(handleIdToOutputPort(null, 'text')).toBeNull();
      expect(handleIdToOutputPort(undefined, 'image_generation')).toBeNull();
      expect(handleIdToOutputPort('', 'llm')).toBeNull();
    });
  });

  describe('inferDefaultOutputPort', () => {
    it('выводит порт из типа узла и падает на output для неизвестного типа (KI-022)', () => {
      expect(inferDefaultOutputPort('text')).toBe('text');
      expect(inferDefaultOutputPort('llm')).toBe('text');
      expect(inferDefaultOutputPort('image_generation')).toBe('mediaUrl');
      expect(inferDefaultOutputPort('merge')).toBe('output');
    });

    it('держит карту дефолтов согласованной с реестром контрактов', () => {
      for (const [nodeType, contract] of Object.entries(NODE_PORT_CONTRACT)) {
        expect(DEFAULT_OUTPUT_PORT_BY_NODE_TYPE[nodeType]).toBe(
          contract.outputPortName,
        );
      }
    });
  });

  describe('inferInputPortName', () => {
    it('возвращает нормализованное имя входа по типу узла (KI-034)', () => {
      expect(inferInputPortName('llm')).toBe('prompt');
      expect(inferInputPortName('image_generation')).toBe('prompt');
      expect(inferInputPortName('text')).toBe('text');
    });

    it('возвращает input для типа без контракта (KI-034)', () => {
      expect(inferInputPortName('merge')).toBe('input');
      expect(inferInputPortName('')).toBe('input');
    });
  });

  describe('media-генерация R7.2 (KI-361)', () => {
    it('выход — `mediaUrl`, как в outputs исполнителя (урок KI-368)', () => {
      // Исполнитель пишет `outputs.mediaUrl`; контракт обязан называть тот же
      // ключ, иначе зависимый узел прочитал бы `null`.
      for (const type of ['video_generation', 'audio_generation', 'music_generation']) {
        expect(NODE_PORT_CONTRACT[type].outputPortName, type).toBe('mediaUrl');
        expect(inferDefaultOutputPort(type), type).toBe('mediaUrl');
      }
    });

    it('вход — текстовый (`prompt`): промпт/текст приходит по связи', () => {
      for (const type of ['video_generation', 'audio_generation', 'music_generation']) {
        expect(NODE_PORT_CONTRACT[type].targetHandleId, type).toBe('text-input');
        expect(inferInputPortName(type), type).toBe('prompt');
      }
    });

    it('выходные хендлы названы по типу узла и разрешаются type-aware (KI-301)', () => {
      expect(handleIdToOutputPort('video-output', 'video_generation')).toBe('mediaUrl');
      expect(handleIdToOutputPort('audio-output', 'audio_generation')).toBe('mediaUrl');
      expect(handleIdToOutputPort('music-output', 'music_generation')).toBe('mediaUrl');
      // Чужой хендл не подставляет порт другого типа.
      expect(handleIdToOutputPort('video-output', 'audio_generation')).toBeNull();
      expect(handleIdToOutputPort('image-output', 'video_generation')).toBeNull();
    });
  });

  describe('sub_workflow (R6.7, KI-200)', () => {    it('выход — отдельный хендл result-output, а не общий text-output (KI-301)', () => {
      // `text-output` переводится в порт `text`: с ним результат подграфа
      // (`outputs.result`) не доехал бы до зависимого узла.
      expect(handleIdToOutputPort('result-output')).toBe('result');
      expect(NODE_PORT_CONTRACT.sub_workflow.sourceHandleId).toBe('result-output');
      expect(NODE_PORT_CONTRACT.sub_workflow.outputPortName).toBe('result');
    });

    it('вход — контракт text-input → prompt, как у llm/http', () => {
      expect(NODE_PORT_CONTRACT.sub_workflow.targetHandleId).toBe('text-input');
      expect(inferInputPortName('sub_workflow')).toBe('prompt');
      expect(inferDefaultOutputPort('sub_workflow')).toBe('result');
    });
  });
});
