/**
 * Allowlist адресов для `GET /metrics` (v1.6.0 S6-A).
 *
 * Prometheus не умеет JWT, поэтому `/metrics` защищён сетевым правилом, а не
 * авторизацией (`KI-575`). Правило читается из `METRICS_ALLOWED_IPS` и
 * поддерживает два формата:
 * - точный адрес (`127.0.0.1`, `::1`, `62.109.1.230`);
 * - IPv4-CIDR (`172.18.0.0/16`) — Prometheus в Docker ходит из подсети
 *   compose, и перечислять IP контейнера вручную бессмысленно: он меняется
 *   при пересоздании.
 *
 * IPv6-CIDR сознательно не поддерживается (KI-669): в прод-стеке внешний
 * скрейпер ходит по IPv4, а ошибка в маске молча расширила бы доступ.
 *
 * Модуль без Nest-зависимостей: вся логика — чистые функции, поэтому она
 * покрыта unit-тестами без поднятия DI (`metrics-ip-allowlist.spec.ts`).
 */

/**
 * Дефолт, если переменная не задана (совпадает с дефолтом `EnvSchema`).
 *
 * Только loopback: `/metrics` не должен быть доступен из интернета ни в одной
 * среде. Пустой список трактуется как «дефолт», а не «разрешить всем» —
 * fail-closed важнее удобства.
 */
export const DEFAULT_METRICS_ALLOWED_IPS = '127.0.0.1';

/** Скомпилированное правило: точный адрес или IPv4-подсеть. */
export interface IpRule {
  /** Нормализованный адрес (для CIDR — адрес сети). */
  readonly address: string;
  /** Длина маски для CIDR; `null` — точное совпадение. */
  readonly prefixLength: number | null;
}

/**
 * Приводит IP к канонической форме для сравнения.
 *
 * Express отдаёт IPv4-mapped IPv6 (`::ffff:127.0.0.1`) при двойном стеке, а
 * `x-forwarded-for` — иногда с портом. Без нормализации allowlist
 * `127.0.0.1` не совпал бы с реальным `req.ip`, и ручка отвечала бы 403
 * легитимному скрейперу.
 *
 * @param value - сырой IP из `req.ip`, заголовка или allowlist'а
 * @returns нормализованный адрес в lowercase или `null` для пустого значения
 */
export function normalizeClientIp(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  let candidate = value.trim();

  if (candidate.length === 0) {
    return null;
  }

  // `[2001:db8::1]:443` и `[2001:db8::1]` — скобки только у IPv6.
  if (candidate.startsWith('[')) {
    const closing = candidate.indexOf(']');

    if (closing === -1) {
      return null;
    }

    candidate = candidate.slice(1, closing);
  }

  // `1.2.3.4:443`: порт в заголовке прокси (не по RFC, но встречается).
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(candidate);

  if (ipv4WithPort) {
    [, candidate] = ipv4WithPort;
  }

  const normalized = candidate.toLowerCase();

  // IPv4-mapped IPv6: `::ffff:127.0.0.1` → `127.0.0.1`.
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);

    if (ipv4ToInt(mapped) !== null) {
      return mapped;
    }
  }

  return normalized;
}

/**
 * Разбирает env-список в набор правил.
 *
 * @param raw - значение `METRICS_ALLOWED_IPS` (`undefined`/пусто → дефолт)
 * @returns уникальные правила; невалидные записи отбрасываются, а если
 *   невалидны все — пустой список, то есть «закрыто для всех» (fail-closed,
 *   а не «разрешить»)
 */
export function parseIpAllowlist(raw: string | undefined): IpRule[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const source = entries.length > 0 ? entries : [DEFAULT_METRICS_ALLOWED_IPS];
  const rules = source
    .map((entry) => toRule(entry))
    .filter((rule): rule is IpRule => rule !== null);
  const unique = new Map<string, IpRule>();

  for (const rule of rules) {
    const key =
      rule.prefixLength === null
        ? rule.address
        : `${rule.address}/${rule.prefixLength}`;

    unique.set(key, rule);
  }

  return [...unique.values()];
}

/**
 * Проверяет, разрешён ли адрес правилами allowlist'а.
 *
 * @param ip - адрес клиента (нормализуется внутри)
 * @param rules - правила из {@link parseIpAllowlist}
 * @returns `true`, если адрес попадает хотя бы в одно правило
 */
export function isIpAllowed(
  ip: string | null | undefined,
  rules: readonly IpRule[],
): boolean {
  const normalized = normalizeClientIp(ip);

  if (normalized === null) {
    return false;
  }

  return rules.some((rule) => matchesRule(normalized, rule));
}

/**
 * Превращает строку allowlist'а в правило.
 *
 * @param entry - точный адрес или IPv4-CIDR
 * @returns правило или `null`, если запись заведомо невалидна
 */
function toRule(entry: string): IpRule | null {
  const slash = entry.indexOf('/');

  if (slash === -1) {
    const address = normalizeClientIp(entry);

    // Не IP и не IPv6-подобная строка (`not-an-ip`, `app.example.com`): правило
    // отбрасываем. Молча «разрешить» опечатку нельзя, а хранить её бессмысленно.
    if (address === null || (ipv4ToInt(address) === null && !address.includes(':'))) {
      return null;
    }

    return { address, prefixLength: null };
  }

  const address = normalizeClientIp(entry.slice(0, slash));
  const prefixRaw = entry.slice(slash + 1).trim();
  const prefixLength = /^\d{1,2}$/.test(prefixRaw) ? Number(prefixRaw) : null;

  // IPv6-CIDR не поддержан (KI-669): правило не создаём, чтобы оно не
  // совпало случайно с «похожим» адресом.
  if (address === null || prefixLength === null || prefixLength > 32) {
    return null;
  }

  if (ipv4ToInt(address) === null) {
    return null;
  }

  return { address, prefixLength };
}

/**
 * Сравнивает нормализованный адрес с правилом.
 *
 * Помимо прямого совпадения учитывается эквивалентность loopback-адресов:
 * `127.0.0.1` и `::1` — один и тот же хост, но Node/браузер/Docker выбирают
 * разный стек (`localhost` может разрешиться в `::1`). Иначе дефолтный
 * allowlist блокировал бы локальный scrape «через раз».
 *
 * @param ip - нормализованный адрес клиента
 * @param rule - правило allowlist'а
 * @returns `true` при совпадении
 */
function matchesRule(ip: string, rule: IpRule): boolean {
  if (rule.prefixLength === null) {
    return ip === rule.address || isLoopbackAlias(ip, rule.address);
  }

  const client = ipv4ToInt(ip);
  const network = ipv4ToInt(rule.address);

  if (client === null || network === null) {
    return false;
  }

  const mask =
    rule.prefixLength === 0
      ? 0
      : (0xffffffff << (32 - rule.prefixLength)) >>> 0;

  return (client & mask) === (network & mask);
}

/**
 * Проверяет, что два адреса — loopback в разных стеках.
 *
 * @param left - адрес клиента
 * @param right - адрес правила
 * @returns `true` для пары `127.0.0.1` ↔ `::1`
 */
function isLoopbackAlias(left: string, right: string): boolean {
  return (
    (left === '127.0.0.1' && right === '::1') ||
    (left === '::1' && right === '127.0.0.1')
  );
}

/**
 * Переводит IPv4 в 32-битное число.
 *
 * @param ip - адрес в десятично-точечной нотации
 * @returns число или `null`, если это не IPv4
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet > 255) {
      return null;
    }

    value = value * 256 + octet;
  }

  return value >>> 0;
}
