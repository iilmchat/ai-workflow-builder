/**
 * Юнит-тесты примитивов SSRF-защиты (KI-409/434/435/478).
 *
 * Тесты не ходят в сеть: проверяются чистые предикаты IP/имён. Сетевой путь
 * (`SafeHttpClient`: DNS один раз, pinning IP, manual redirects) проверяется в
 * `src/common/http/safe-http.client.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  isBlockedHostname,
  isBlockedIpAddress,
  isMetadataHostname,
  isMetadataIpAddress,
  isPrivateIp,
  normalizeHostname,
} from './network-safety.js';

describe('isPrivateIp (v0.10.2, ТЗ: приватные диапазоны)', () => {
  it('IPv4: 10/8, 172.16/12, 192.168/16, 127/8 и 169.254/16 — приватные', () => {
    const privateAddresses = [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.20.10.10',
      '172.31.255.255',
      '192.168.0.1',
      '192.168.255.254',
      '127.0.0.1',
      '127.1.2.3',
      '169.254.0.1',
      // AWS/GCP metadata — тот самый адрес из KI-409/KI-478.
      '169.254.169.254',
    ];

    for (const address of privateAddresses) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it('IPv4: публичные адреса и границы диапазонов — не приватные', () => {
    const publicAddresses = [
      '8.8.8.8',
      '93.184.216.34',
      '1.1.1.1',
      // Границы 172.16/12: 172.15 и 172.32 уже публичные.
      '172.15.0.1',
      '172.32.0.1',
      '169.253.0.1',
      '11.0.0.1',
    ];

    for (const address of publicAddresses) {
      expect(isPrivateIp(address), address).toBe(false);
    }
  });

  it('IPv6: ::1 и fc00::/7 — приватные, глобальные — нет', () => {
    const privateAddresses = ['::1', 'fc00::1', 'fd12:3456::1', 'FC00::1'];
    const publicAddresses = [
      '2001:4860:4860::8888',
      '2001:4860:4860::ABCD',
      '2001:db8::1',
    ];

    for (const address of privateAddresses) {
      expect(isPrivateIp(address), address).toBe(true);
    }

    for (const address of publicAddresses) {
      expect(isPrivateIp(address), address).toBe(false);
    }
  });

  it('IPv4-mapped: приватный IPv4 внутри IPv6 не обходит проверку', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('isPrivateIp не считает link-local IPv6 «приватным», но денлист это ловит', () => {
    // Разделение контрактов: isPrivateIp — ровно диапазоны из ТЗ, а
    // isBlockedIpAddress — полный SSRF-денлист (включая fe80::/10).
    expect(isPrivateIp('fe80::1')).toBe(false);
    expect(isBlockedIpAddress('fe80::1')).toBe(true);
  });

  it('не-IP строки не считаются ни приватными, ни заблокированными', () => {
    for (const value of ['', 'example.com', '999.1.1.1', '::gg']) {
      expect(isPrivateIp(value), value).toBe(false);
      expect(isBlockedIpAddress(value), value).toBe(false);
    }
  });
});

describe('isBlockedIpAddress (SSRF-денлист строже private)', () => {
  it('блокирует служебные, multicast и документационные диапазоны', () => {
    const blocked = [
      '0.0.0.0',
      '0.1.2.3',
      '100.64.0.1',
      '192.0.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:10.0.0.1',
    ];

    for (const address of blocked) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it('пропускает публичные адреса', () => {
    for (const address of ['8.8.8.8', '93.184.216.34', '2001:4860::8888']) {
      expect(isBlockedIpAddress(address), address).toBe(false);
    }
  });
});

describe('нормализация и денлист имён (v0.11 S14)', () => {
  it('normalizeHostname снимает скобки IPv6, регистр и завершающую точку', () => {
    expect(normalizeHostname('[::1]')).toBe('::1');
    expect(normalizeHostname('LocalHost.')).toBe('localhost');
    expect(normalizeHostname('  Public.Example  ')).toBe('public.example');
  });

  it('isBlockedHostname ловит localhost и его поддомены, metadata-алиасы', () => {
    for (const hostname of [
      'localhost',
      'localhost.localdomain',
      'api.localhost',
      'metadata',
      'metadata.google.internal',
      'instance-data',
      'kubernetes.default',
    ]) {
      expect(isBlockedHostname(hostname), hostname).toBe(true);
    }

    expect(isBlockedHostname('example.com')).toBe(false);
  });

  it('isMetadataHostname — только алиасы хранилища instance-credentials', () => {
    expect(isMetadataHostname('metadata')).toBe(true);
    expect(isMetadataHostname('metadata.google.internal')).toBe(true);
    expect(isMetadataHostname('instance-data')).toBe(true);
    // localhost — «внутренний сервис», а не metadata: при разрешённых
    // приватных сетях он допустим.
    expect(isMetadataHostname('localhost')).toBe(false);
  });

  it('isMetadataIpAddress распознаёт 169.254.169.254 и IPv4-mapped форму', () => {
    expect(isMetadataIpAddress('169.254.169.254')).toBe(true);
    expect(isMetadataIpAddress('::ffff:169.254.169.254')).toBe(true);
    // Другой link-local адрес — не metadata (доверенная инсталляция может его
    // разрешить флагом).
    expect(isMetadataIpAddress('169.254.0.1')).toBe(false);
    expect(isMetadataIpAddress('8.8.8.8')).toBe(false);
  });
});
