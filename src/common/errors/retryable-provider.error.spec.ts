import { describe, expect, it } from 'vitest';
import { RetryableNodeException } from '../../engine/errors.js';
import { LlmProviderException } from '../../llm/llm-provider.interface.js';
import { MediaProviderException } from '../../media/media-provider.interface.js';
import {
  isRetryableProviderError,
  type RetryableProviderError,
} from './retryable-provider.error.js';

/**
 * Проверки структурного guard'а `isRetryableProviderError` (v0.11 S10).
 *
 * Guard — единственный контракт между движком и ошибками провайдеров разных
 * модулей (KI-104), поэтому тесты фиксируют: (1) он не полагается на
 * `instanceof`, (2) он требует оба поля — `retryable === true` и строковый
 * `provider`, (3) реальные исключения LLM/media ему удовлетворяют.
 */
describe('isRetryableProviderError (v0.11 S10)', () => {
  it('не считает повтором обычную ошибку и не-объекты', () => {
    expect(isRetryableProviderError(new Error('boom'))).toBe(false);
    expect(isRetryableProviderError(null)).toBe(false);
    expect(isRetryableProviderError(undefined)).toBe(false);
    expect(isRetryableProviderError('429')).toBe(false);
    expect(isRetryableProviderError({ retryable: true, provider: 'x' })).toBe(
      false,
    );
  });

  it('требует оба поля: retryable === true и строковый provider', () => {
    const withoutProvider = Object.assign(new Error('rate limit'), {
      retryable: true,
    });
    const withoutRetryable = Object.assign(new Error('boom'), {
      provider: 'media',
    });
    const retryableFalse = Object.assign(new Error('boom'), {
      provider: 'media',
      retryable: false,
    });

    expect(isRetryableProviderError(withoutProvider)).toBe(false);
    expect(isRetryableProviderError(withoutRetryable)).toBe(false);
    expect(isRetryableProviderError(retryableFalse)).toBe(false);
  });

  it('принимает структурную реализацию интерфейса (без instanceof)', () => {
    const structural = Object.assign(new Error('rate limit'), {
      provider: 'third-party',
      retryable: true,
      retryAfterMs: 1_500,
    }) satisfies RetryableProviderError;

    expect(isRetryableProviderError(structural)).toBe(true);
  });

  it('LlmProviderException с retryable=true проходит guard, provider и hint сохранены', () => {
    const error = new LlmProviderException('anthropic', 'rate limit', {
      retryable: true,
      retryAfterMs: 2_000,
    });

    expect(isRetryableProviderError(error)).toBe(true);
    expect(error.provider).toBe('anthropic');
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2_000);
  });

  it('LlmProviderException с retryable=false guard не проходит', () => {
    const error = new LlmProviderException('anthropic', 'invalid api key', {
      retryable: false,
    });

    expect(isRetryableProviderError(error)).toBe(false);
  });

  it('MediaProviderException с retryable=true проходит guard — KI-104', () => {
    const error = new MediaProviderException('creativelab', 'rate limited', {
      retryable: true,
      retryAfterMs: 5_000,
    });

    // До S10 движок проверял только `LlmProviderException`, поэтому эта
    // ошибка не повторялась, хотя `retryable` был выставлен.
    expect(isRetryableProviderError(error)).toBe(true);
    expect(error.provider).toBe('creativelab');
    expect(error.retryAfterMs).toBe(5_000);
  });

  it('RetryableNodeException guard не проходит (нет provider), но остаётся node-маркером', () => {
    const error = new RetryableNodeException('web_search', '429');

    // У узлов без провайдера нет `provider`, поэтому движок проверяет их
    // отдельным guard'ом `isRetryableNodeError` (DESIGN § 3.3.2).
    expect(isRetryableProviderError(error)).toBe(false);
    expect(error.retryable).toBe(true);
  });
});
