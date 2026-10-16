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
      expect(handleIdToOutputPort('image-output')).toBe('url');
    });

    it('возвращает null для пустого или неизвестного хендла (KI-030)', () => {
      expect(handleIdToOutputPort(null)).toBeNull();
      expect(handleIdToOutputPort(undefined)).toBeNull();
      expect(handleIdToOutputPort('')).toBeNull();
      expect(handleIdToOutputPort('unknown-handle')).toBeNull();
    });
  });

  describe('inferDefaultOutputPort', () => {
    it('выводит порт из типа узла и падает на output для неизвестного типа (KI-022)', () => {
      expect(inferDefaultOutputPort('text')).toBe('text');
      expect(inferDefaultOutputPort('llm')).toBe('text');
      expect(inferDefaultOutputPort('image_generation')).toBe('url');
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

  describe('sub_workflow (R6.7, KI-200)', () => {
    it('выход — отдельный хендл result-output, а не общий text-output (KI-301)', () => {
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
