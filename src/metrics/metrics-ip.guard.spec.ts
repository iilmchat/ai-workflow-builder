import {
  ForbiddenException,
  Logger,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsIpGuard, resolveRequestIp } from './metrics-ip.guard.js';

/**
 * Создаёт минимальный HTTP-контекст Nest с заданным адресом.
 *
 * @param ip - `req.ip` (как его вычислил Express); `undefined` — «нет адреса»
 * @param forwarded - значение `x-forwarded-for`
 * @returns контекст для `canActivate`
 */
function createContext(
  ip: string | undefined,
  forwarded?: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
        socket: { remoteAddress: undefined },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsIpGuard (S6-A)', () => {
  let allowedIps: string | undefined;
  let guard: MetricsIpGuard;

  beforeEach(() => {
    allowedIps = '127.0.0.1';
    // WARN об отклонённом запросе — ожидаемое поведение, в тестах это шум.
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const config = {
      get: vi.fn((key: string) =>
        key === 'METRICS_ALLOWED_IPS' ? allowedIps : undefined,
      ),
    } as unknown as ConfigService;

    guard = new MetricsIpGuard(config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('пропускает loopback из allowlist', () => {
    expect(guard.canActivate(createContext('127.0.0.1'))).toBe(true);
    expect(guard.canActivate(createContext('::ffff:127.0.0.1'))).toBe(true);
    expect(guard.canActivate(createContext('::1'))).toBe(true);
  });

  it('отклоняет адрес вне allowlist — 403 до построения метрик', () => {
    expect(() => guard.canActivate(createContext('62.109.1.230'))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(createContext('10.1.2.3'))).toThrow(
      'METRICS_ALLOWED_IPS',
    );
  });

  it('отклоняет запрос без определимого IP', () => {
    expect(() => guard.canActivate(createContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('пропускает адрес из IPv4-подсети (Prometheus в Docker)', () => {
    allowedIps = '127.0.0.1,172.18.0.0/16';

    expect(guard.canActivate(createContext('172.18.0.5'))).toBe(true);
    expect(() => guard.canActivate(createContext('172.19.0.5'))).toThrow(
      ForbiddenException,
    );
  });

  it('не верит X-Forwarded-For, если Express уже вычислил req.ip', () => {
    // Клиент подставляет разрешённый адрес в заголовок, но реальный req.ip —
    // чужой. Брать заголовок первым было бы обходом allowlist.
    expect(() =>
      guard.canActivate(createContext('10.66.0.1', '127.0.0.1')),
    ).toThrow(ForbiddenException);
  });

  it('использует X-Forwarded-For, только если req.ip отсутствует', () => {
    allowedIps = '203.0.113.9';

    expect(guard.canActivate(createContext(undefined, '203.0.113.9'))).toBe(
      true,
    );
  });
});

describe('resolveRequestIp (S6-A)', () => {
  /**
   * Собирает минимальный Express-запрос для `resolveRequestIp`.
   *
   * @param ip - `req.ip`
   * @param forwarded - значение `x-forwarded-for`
   * @param remoteAddress - `socket.remoteAddress`
   * @returns запрос, суженный до полей, которые читает функция
   */
  function request(
    ip: string | undefined,
    forwarded: string | undefined,
    remoteAddress: string | undefined,
  ): Request {
    return {
      ip,
      headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
      socket: { remoteAddress },
    } as unknown as Request;
  }

  it('предпочитает req.ip заголовку', () => {
    expect(
      resolveRequestIp(request('10.0.0.1', '127.0.0.1', '10.0.0.1')),
    ).toBe('10.0.0.1');
  });

  it('берёт первый адрес из списка X-Forwarded-For', () => {
    expect(
      resolveRequestIp(request(undefined, '203.0.113.9, 10.0.0.1', undefined)),
    ).toBe('203.0.113.9');
  });

  it('падает на socket.remoteAddress, если больше ничего нет', () => {
    expect(
      resolveRequestIp(request(undefined, undefined, '::ffff:172.18.0.7')),
    ).toBe('172.18.0.7');
  });
});
