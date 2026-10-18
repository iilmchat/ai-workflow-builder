import {
  RetryableNodeException,
  VectorDisabledException,
  isRetryableNodeError,
} from './errors.js';

describe('RetryableNodeException (v0.10 S0)', () => {
  it('несёт маркер retryable и тип узла', () => {
    const error = new RetryableNodeException('web_search', '429 от Tavily');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RetryableNodeException');
    expect(error.retryable).toBe(true);
    expect(error.nodeType).toBe('web_search');
    expect(error.message).toBe('429 от Tavily');
  });

  it('сохраняет причину и дефолтный текст', () => {
    const cause = new Error('socket hang up');
    const error = new RetryableNodeException('document_gen', undefined, { cause });

    expect(error.cause).toBe(cause);
    expect(error.message).toContain('document_gen');
  });

  it('isRetryableNodeError отличает маркер от обычной ошибки', () => {
    expect(isRetryableNodeError(new RetryableNodeException('web_search'))).toBe(true);
    expect(isRetryableNodeError(new Error('boom'))).toBe(false);
    expect(isRetryableNodeError(null)).toBe(false);
    expect(isRetryableNodeError('retryable')).toBe(false);
  });
});

describe('VectorDisabledException (v0.10 S0, KI-455)', () => {
  it('объясняет, что vector-функции выключены администратором', () => {
    const error = new VectorDisabledException('vector_query');

    expect(error.name).toBe('VectorDisabledException');
    expect(error.message).toContain('vector_query');
    expect(error.message).toContain('PGVECTOR_ENABLED=false');
    // Это ошибка конфигурации, а не «временная»: повтор не поможет.
    expect(isRetryableNodeError(error)).toBe(false);
  });
});
