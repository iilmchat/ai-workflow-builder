import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METRICS_ALLOWED_IPS,
  isIpAllowed,
  normalizeClientIp,
  parseIpAllowlist,
} from './metrics-ip-allowlist.js';

describe('normalizeClientIp (S6-A)', () => {
  it('снимает IPv4-mapped IPv6 — так Express отдаёт адрес при двойном стеке', () => {
    expect(normalizeClientIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeClientIp('::FFFF:10.0.0.5')).toBe('10.0.0.5');
  });

  it('снимает порт и скобки, которые иногда приходят в X-Forwarded-For', () => {
    expect(normalizeClientIp('1.2.3.4:5678')).toBe('1.2.3.4');
    expect(normalizeClientIp('[::1]:443')).toBe('::1');
    expect(normalizeClientIp('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('обрезает пробелы и приводит к lowercase', () => {
    expect(normalizeClientIp('  10.0.0.1  ')).toBe('10.0.0.1');
    expect(normalizeClientIp('FE80::1')).toBe('fe80::1');
  });

  it('пустые значения дают null, а не пустую строку', () => {
    expect(normalizeClientIp(undefined)).toBeNull();
    expect(normalizeClientIp(null)).toBeNull();
    expect(normalizeClientIp('')).toBeNull();
    expect(normalizeClientIp('   ')).toBeNull();
    expect(normalizeClientIp('[broken')).toBeNull();
  });
});

describe('parseIpAllowlist (S6-A)', () => {
  it('без значения применяет дефолт — только loopback', () => {
    expect(parseIpAllowlist(undefined)).toMatchObject([
      { address: DEFAULT_METRICS_ALLOWED_IPS, prefixLength: null },
    ]);
    expect(parseIpAllowlist('  ')).toMatchObject([
      { address: '127.0.0.1', prefixLength: null },
    ]);
  });

  it('разбирает точные адреса, CIDR и убирает дубли', () => {
    const rules = parseIpAllowlist(
      ' 127.0.0.1 , 172.18.0.0/16 , 172.18.0.0/16, ::1 ',
    );

    expect(rules).toMatchObject([
      { address: '127.0.0.1', prefixLength: null },
      { address: '172.18.0.0', prefixLength: 16 },
      { address: '::1', prefixLength: null },
    ]);
  });

  it('некорректные записи отбрасываются (fail-closed)', () => {
    // Все записи невалидны → allowlist пуст → закрыто для всех. Это осознанный
    // fail-closed: опечатка в env не должна открывать ручку «всем».
    expect(parseIpAllowlist('not-an-ip,app.example.com')).toMatchObject([]);
    // IPv6-CIDR не поддержан (KI-669) — правило не создаётся.
    expect(parseIpAllowlist('fe80::/10')).toMatchObject([]);
    // Маска вне 0..32 невалидна.
    expect(parseIpAllowlist('10.0.0.0/64')).toMatchObject([]);
    // Валидная запись рядом с невалидной сохраняется.
    expect(parseIpAllowlist('not-an-ip,127.0.0.1')).toMatchObject([
      { address: '127.0.0.1', prefixLength: null },
    ]);
  });
});

describe('isIpAllowed (S6-A)', () => {
  it('точный адрес совпадает, чужой — нет', () => {
    const rules = parseIpAllowlist('127.0.0.1,62.109.1.230');

    expect(isIpAllowed('127.0.0.1', rules)).toBe(true);
    expect(isIpAllowed('::ffff:127.0.0.1', rules)).toBe(true);
    expect(isIpAllowed('62.109.1.230', rules)).toBe(true);
    expect(isIpAllowed('10.1.2.3', rules)).toBe(false);
    expect(isIpAllowed(null, rules)).toBe(false);
  });

  it('IPv4-CIDR покрывает подсеть compose — Prometheus ходит из контейнера', () => {
    const rules = parseIpAllowlist('172.18.0.0/16,10.0.0.0/8');

    expect(isIpAllowed('172.18.0.5', rules)).toBe(true);
    expect(isIpAllowed('172.18.255.254', rules)).toBe(true);
    expect(isIpAllowed('10.20.30.40', rules)).toBe(true);
    expect(isIpAllowed('172.19.0.5', rules)).toBe(false);
  });

  it('loopback в разных стеках взаимозаменяем — `localhost` может стать ::1', () => {
    expect(isIpAllowed('::1', parseIpAllowlist('127.0.0.1'))).toBe(true);
    expect(isIpAllowed('127.0.0.1', parseIpAllowlist('::1'))).toBe(true);
    // Это ровно loopback-пара, а не любое совпадение произвольных адресов.
    expect(isIpAllowed('127.0.0.2', parseIpAllowlist('::1'))).toBe(false);
  });

  it('нулевая маска /0 разрешает всю IPv4-сеть — операторский выбор', () => {
    const rules = parseIpAllowlist('0.0.0.0/0');

    expect(isIpAllowed('8.8.8.8', rules)).toBe(true);
    expect(isIpAllowed('::1', rules)).toBe(false);
  });
});
