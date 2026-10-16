import { describe, expect, it } from 'vitest';
import {
  hasNewerWorkflowVersion,
  isValidWorkflowId,
  validateInputsMap,
  validateWorkflowVersion,
  workflowEditorUrl,
} from './sub-workflow-fields';

/** Валидный uuid v4 (как их генерирует Postgres `gen_random_uuid()`). */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

describe('sub-workflow-fields (R6.7, KI-200)', () => {
  describe('isValidWorkflowId', () => {
    it('принимает uuid, который примет backend-схема z.uuid()', () => {
      expect(isValidWorkflowId(WORKFLOW_ID)).toBe(true);
      // Пробелы по краям — обычный результат вставки из буфера.
      expect(isValidWorkflowId(` ${WORKFLOW_ID} `)).toBe(true);
      // nil-uuid допускает и z.uuid() — системный пользователь/заглушки.
      expect(isValidWorkflowId('00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('отвергает пустую строку, мусор и почти-uuid', () => {
      expect(isValidWorkflowId('')).toBe(false);
      expect(isValidWorkflowId('   ')).toBe(false);
      expect(isValidWorkflowId('wf-1')).toBe(false);
      // Нет версии (9-я цифра не 1..8) — Zod такой uuid тоже не примет.
      expect(isValidWorkflowId('11111111-1111-0111-8111-111111111111')).toBe(false);
      // Нет варианта (13-я цифра не 8/9/a/b).
      expect(isValidWorkflowId('11111111-1111-4111-1111-111111111111')).toBe(false);
      expect(isValidWorkflowId('11111111-1111-4111-8111-11111111111')).toBe(false);
    });
  });

  describe('validateWorkflowVersion', () => {
    it('принимает положительные целые и отбрасывает мусор', () => {
      expect(validateWorkflowVersion(3)).toBe(3);
      expect(validateWorkflowVersion(0)).toBeUndefined();
      expect(validateWorkflowVersion(-1)).toBeUndefined();
      expect(validateWorkflowVersion(1.5)).toBeUndefined();
      expect(validateWorkflowVersion('3')).toBeUndefined();
      expect(validateWorkflowVersion(undefined)).toBeUndefined();
      expect(validateWorkflowVersion(null)).toBeUndefined();
    });
  });

  describe('validateInputsMap', () => {
    it('переносит только строковые пары', () => {
      expect(validateInputsMap({ prompt: 'text', text: 'prompt' })).toEqual({
        prompt: 'text',
        text: 'prompt',
      });
      expect(validateInputsMap({ prompt: 1, '': 'text', ok: 'value' })).toEqual({
        ok: 'value',
      });
    });

    it('отбрасывает не-объекты и пустые карты', () => {
      expect(validateInputsMap(null)).toBeUndefined();
      expect(validateInputsMap([])).toBeUndefined();
      expect(validateInputsMap('prompt')).toBeUndefined();
      expect(validateInputsMap({})).toBeUndefined();
      expect(validateInputsMap({ prompt: 5 })).toBeUndefined();
    });
  });

  describe('hasNewerWorkflowVersion', () => {
    it('срабатывает только когда в БД версия больше снимка', () => {
      expect(hasNewerWorkflowVersion(1, 2)).toBe(true);
      expect(hasNewerWorkflowVersion(2, 2)).toBe(false);
      expect(hasNewerWorkflowVersion(3, 2)).toBe(false);
      // Без снимка (граф сохранён до R6.7) сравнение бессмысленно.
      expect(hasNewerWorkflowVersion(undefined, 5)).toBe(false);
    });
  });

  describe('workflowEditorUrl', () => {
    it('собирает ссылку `?workflowId=`, которую читает App (A3)', () => {
      expect(workflowEditorUrl(WORKFLOW_ID)).toBe(`/?workflowId=${WORKFLOW_ID}`);
    });

    it('не собирает ссылку из невалидного id', () => {
      expect(workflowEditorUrl('')).toBeNull();
      expect(workflowEditorUrl('не-uuid')).toBeNull();
    });
  });
});
