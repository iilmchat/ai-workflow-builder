import {
  DEFAULT_IMAGE_TOOL_MODELS,
  IMAGE_TOOL_OPERATIONS,
  isImageToolOperation,
  type ImageToolOperation,
} from './image-tool.js';

/**
 * Операции, которые не показываются в UI (KI-418).
 *
 * `chromakey` остаётся в backend-контракте ради старых workflow, но ни один
 * провайдер не объявляет для неё модель, поэтому новая кнопка не нужна.
 */
const HIDDEN_OPERATIONS: readonly ImageToolOperation[] = ['chromakey'];

describe('image_tool: дефолтные модели операций (KI-418)', () => {
  it('каждая доступная в UI операция имеет хотя бы одного кандидата', () => {
    const visible = IMAGE_TOOL_OPERATIONS.filter(
      (operation) => !HIDDEN_OPERATIONS.includes(operation),
    );

    // Страховка от «операция есть, а модели нет»: именно это и было KI-418.
    expect(visible.length).toBeGreaterThan(0);

    for (const operation of visible) {
      const candidates = DEFAULT_IMAGE_TOOL_MODELS[operation];

      expect(
        candidates,
        `у операции ${operation} нет списка дефолтных моделей`,
      ).toBeDefined();
      expect(
        candidates?.length,
        `у операции ${operation} пустой список дефолтных моделей`,
      ).toBeGreaterThan(0);
    }
  });

  it('upscale имеет fallback на прямых провайдеров (R7.1)', () => {
    // Апскейл не объявлен в CreativeLab — работают FAL и Replicate (KI-367).
    expect(DEFAULT_IMAGE_TOOL_MODELS.upscale).toEqual([
      'fal:fal-ai/clarity-upscaler',
      'replicate:nightmareai/real-esrgan',
    ]);
  });

  it('chromakey не имеет модели и скрыта из UI (KI-418)', () => {
    // Пустой список — сигнал «молчаливую подмену не делаем» (KI-069).
    expect(DEFAULT_IMAGE_TOOL_MODELS.chromakey).toEqual([]);
    expect(HIDDEN_OPERATIONS).toContain('chromakey');
    // Значение остаётся валидным для старых workflow: Zod-схема узла и
    // backend-исполнитель продолжают его принимать.
    expect(isImageToolOperation('chromakey')).toBe(true);
  });

  it('неизвестная операция не проходит type guard', () => {
    expect(isImageToolOperation('teleport')).toBe(false);
  });
});
