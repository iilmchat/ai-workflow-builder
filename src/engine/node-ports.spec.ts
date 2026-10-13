import {
  DEFAULT_OUTPUT_PORT_BY_NODE_TYPE,
  NODE_PORT_CONTRACT,
  handleIdToOutputPort,
  inferDefaultOutputPort,
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
});
