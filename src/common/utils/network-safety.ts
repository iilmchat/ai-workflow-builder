/**
 * Сетевая безопасность: общие предикаты SSRF-защиты исходящих HTTP-запросов.
 *
 * Модуль появился в v0.10.2 (hardening), когда проверка «адрес публичный?»
 * была только у инструмента агента `http_request` (KI-409), а узел `http`
 * ходил в сеть без неё (KI-478), редиректы не проверялись ни там, ни там
 * (KI-434).
 *
 * **v0.11 S14 (KI-434/435/478).** Сетевой путь один — `SafeHttpClient`
 * (`src/common/http/safe-http.client.ts`): он резолвит DNS **один раз**,
 * проверяет все адреса, прибивает выбранный IP через `undici` (KI-435) и
 * вручную обходит редиректы (KI-434). Прежние `assertPublicHttpUrlAsync` и
 * `fetchWithSsrfGuardAsync` удалены: они резолвили имя дважды (проверка +
 * `fetch`) и оставляли DNS rebinding открытым.
 *
 * Здесь остались только примитивы, общие для клиента и тестов:
 *
 * - {@link isPrivateIp} — предикат «адрес из приватного/локального диапазона»;
 * - {@link isBlockedIpAddress} — более строгий SSRF-денлист: кроме приватных
 *   блокируются служебные, multicast и документационные диапазоны;
 * - {@link normalizeHostname}/{@link isBlockedHostname} — нормализация имени и
 *   денлист заведомо локальных/metadata-имён (до DNS-резолва);
 * - {@link isMetadataHostname}/{@link isMetadataIpAddress} — алиасы хранилищ
 *   токенов инстанса: они остаются запрещёнными даже при
 *   `allowPrivateNetworks=true` (это не «внутренний сервис», а чужие
 *   credentials).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Резолвер DNS для SSRF-проверки.
 *
 * Возвращает **все** адреса хоста: `dns.lookup` с `all: true` отдаёт IPv4 и
 * IPv6 записи, и проверять нужно каждую — клиент выберет любую из них.
 */
export type DnsLookupAsync = (hostname: string) => Promise<readonly string[]>;

/**
 * Резолвит хост через системный `dns.lookup` (продакшен-реализация).
 *
 * @param hostname - имя хоста из URL
 * @returns IP-адреса всех семейств
 * @throws Error при сбое DNS (`ENOTFOUND`, `EAI_AGAIN`) — клиент решает, что с
 *   этим делать (см. `SafeHttpDnsException`, fail closed)
 */
export async function defaultDnsLookupAsync(
  hostname: string,
): Promise<readonly string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });

  return addresses.map((entry) => entry.address);
}

/**
 * Максимум переходов по редиректам в `SafeHttpClient`.
 *
 * Каждый хоп — отдельный сетевой вызов и отдельная SSRF-проверка; лимит
 * защищает от бесконечной цепочки (`A → B → A → …`).
 */
export const HTTP_MAX_REDIRECTS = 5;

/**
 * Имена хостов, которые запрещены без DNS-резолва (KI-409).
 *
 * `localhost` и его поддомены (RFC 6761) — сам хост; `metadata.google.internal`
 * и `instance-data` — документированные алиасы metadata-сервисов облаков.
 * Список проверяется по нормализованному имени (lowercase, без точки в конце).
 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

/**
 * Алиасы metadata-сервисов: всегда запрещены (даже при `allowPrivateNetworks`).
 *
 * Эти имена указывают на хранилище токенов инстанса (AWS/GCP/Kubernetes), а не
 * на «свой» внутренний сервис. Разрешать их доверенной инсталляции нельзя:
 * утечка instance credentials — ровно тот вектор, от которого защищает SSRF-
 * guard.
 */
const METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/**
 * Адрес AWS/GCP metadata-сервиса (link-local, но не «внутренний сервис»).
 *
 * Заблокирован всегда, в том числе при `allowPrivateNetworks=true`; входит в
 * link-local `169.254/16`, поэтому отдельный предикат нужен, чтобы отличить
 * его от прочих link-local адресов, которые доверенная инсталляция могла бы
 * разрешить.
 */
const METADATA_IPV4: readonly number[] = [169, 254, 169, 254];

/**
 * Ошибка: запрос к локальному/внутреннему адресу запрещён (KI-409/434/478).
 *
 * Наследуется от `Error`, а не Nest-исключения: проверка живёт на границе
 * сетевого вызова, и вызывающий код сам решает, как показать сбой (у агента —
 * tool-шаг с текстом ошибки, у узла — `node_runs.error`). Текст намеренно не
 * содержит тела ответа и не делает запрос вовсе.
 */
export class SsrfBlockedException extends Error {
  /** Хост из URL, к которому пытались обратиться. */
  readonly hostname: string;
  /** Приватный IP после резолва; `null`, если запрещено само имя. */
  readonly address: string | null;
  /** Исходный URL, с которого пришёл редирект; `null` — запрос прямой. */
  readonly redirectFrom: string | null;

  /**
   * @param hostname - имя хоста из URL
   * @param address - приватный адрес после DNS-резолва (если был)
   * @param redirectFrom - URL, с которого пришёл небезопасный редирект
   */
  constructor(
    hostname: string,
    address: string | null = null,
    redirectFrom: string | null = null,
  ) {
    const prefix =
      redirectFrom === null
        ? 'SSRF: запрос'
        : `SSRF: редирект с '${redirectFrom}'`;

    super(
      address === null
        ? `${prefix} к '${hostname}' запрещён — локальное или внутреннее имя`
        : `${prefix} к '${hostname}' запрещён — резолвится в приватный адрес ${address}`,
    );
    this.name = 'SsrfBlockedException';
    this.hostname = hostname;
    this.address = address;
    this.redirectFrom = redirectFrom;
  }
}

/**
 * Ошибка: цепочка редиректов превысила `maxRedirects` (`SafeHttpClient`).
 *
 * Отдельный класс, а не `SsrfBlockedException`: это не попытка обойти guard, а
 * сломанная/зацикленная конфигурация удалённого хоста.
 */
export class TooManyRedirectsException extends Error {
  /** Сколько переходов разрешено. */
  readonly maxRedirects: number;

  /**
   * @param maxRedirects - предельное число переходов
   */
  constructor(maxRedirects: number) {
    super(`Превышен лимит редиректов (${maxRedirects})`);
    this.name = 'TooManyRedirectsException';
    this.maxRedirects = maxRedirects;
  }
}

/**
 * Приводит имя хоста из URL к сравнимому виду.
 *
 * URL может отдать IPv6 в скобках (`[::1]`), а DNS/FQDN — с точкой в конце
 * (`localhost.`). Оба варианта должны попадать под запрет.
 *
 * @param hostname - `url.hostname`
 * @returns имя в нижнем регистре без скобок и завершающей точки
 */
export function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  const withoutBrackets =
    lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  return withoutBrackets.endsWith('.')
    ? withoutBrackets.slice(0, -1)
    : withoutBrackets;
}

/**
 * Проверяет, что имя хоста — заведомо локальное (до DNS-резолва).
 *
 * @param hostname - нормализованное имя
 * @returns `true` для `localhost`, его поддоменов и известных metadata-алиасов
 */
export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Проверяет, что имя хоста — алиас metadata-сервиса.
 *
 * Такие имена запрещены **всегда** (в том числе при
 * `allowPrivateNetworks=true`): это чужие instance-credentials, а не
 * внутренний сервис инсталляции.
 *
 * @param hostname - нормализованное имя
 * @returns `true` для `metadata`, `metadata.google.internal`, `instance-data`
 */
export function isMetadataHostname(hostname: string): boolean {
  return METADATA_HOSTNAMES.has(hostname);
}

/**
 * Проверяет, что IP — адрес metadata-сервиса (`169.254.169.254`).
 *
 * Учитывает IPv4-mapped форму (`::ffff:169.254.169.254`): иначе проверка
 * обходилась бы через IPv6-литерал.
 *
 * @param address - IPv4/IPv6-литерал
 * @returns `true` для адреса metadata-сервиса
 */
export function isMetadataIpAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const octets = parseIpv4(normalized);

    return octets !== null && isSameIpv4(octets, METADATA_IPV4);
  }

  if (family === 6) {
    const bytes = parseIpv6(normalized);
    const embedded = bytes === null ? null : embeddedIpv4(bytes);

    return embedded !== null && isSameIpv4(embedded, METADATA_IPV4);
  }

  return false;
}

/**
 * Сравнивает два IPv4-адреса, заданных октетами.
 *
 * @param left - четыре октета
 * @param right - четыре октета
 * @returns `true`, если адреса совпадают
 */
function isSameIpv4(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === 4 &&
    right.length === 4 &&
    left.every((octet, index) => octet === right[index])
  );
}

/**
 * Разбирает IPv4-адрес в октеты.
 *
 * @param address - строка, которую `isIP` уже признал IPv4
 * @returns четыре октета либо `null`, если формат неверный
 */
function parseIpv4(address: string): readonly number[] | null {
  const parts = address.split('.');

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) =>
    /^\d{1,3}$/.test(part) ? Number(part) : Number.NaN,
  );

  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? octets
    : null;
}

/**
 * Разбирает группу IPv6 (в т. ч. встроенный IPv4 в последней группе) в байты.
 *
 * @param groups - группы через `:` (после разбора `::`)
 * @returns байты либо `null`, если группа невалидна
 */
function ipv6GroupsToBytes(groups: readonly string[]): number[] | null {
  const bytes: number[] = [];

  for (const group of groups) {
    if (group.includes('.')) {
      const octets = parseIpv4(group);

      if (octets === null) {
        return null;
      }

      bytes.push(...octets);

      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }

    const value = Number.parseInt(group, 16);

    bytes.push((value >> 8) & 0xff, value & 0xff);
  }

  return bytes;
}

/**
 * Разбирает IPv6-адрес в 16 байт.
 *
 * Поддерживает сжатие `::`, встроенный IPv4 (`::ffff:127.0.0.1`) и zone id
 * (`fe80::1%eth0`) — зона отбрасывается: адрес всё равно link-local.
 *
 * @param address - строка, которую `isIP` уже признал IPv6
 * @returns 16 байт либо `null` при неверном формате
 */
function parseIpv6(address: string): readonly number[] | null {
  const withoutZone = address.split('%')[0] ?? '';
  const halves = withoutZone.split('::');

  if (halves.length > 2) {
    return null;
  }

  const splitGroups = (part: string): string[] =>
    part.length === 0 ? [] : part.split(':');
  const head = ipv6GroupsToBytes(splitGroups(halves[0] ?? ''));

  if (head === null) {
    return null;
  }

  if (halves.length === 1) {
    return head.length === 16 ? head : null;
  }

  const tail = ipv6GroupsToBytes(splitGroups(halves[1] ?? ''));

  if (tail === null) {
    return null;
  }

  const zeros = 16 - head.length - tail.length;

  return zeros < 0
    ? null
    : [...head, ...Array.from({ length: zeros }, () => 0), ...tail];
}

/**
 * Проверяет, что IPv4-адрес из приватного/локального диапазона.
 *
 * Диапазоны — ровно те, что перечислены в ТЗ v0.10.2: `10/8`, `172.16/12`,
 * `192.168/16`, `127/8` (loopback), `169.254/16` (link-local, включая
 * metadata-адрес `169.254.169.254`).
 *
 * @param octets - четыре октета адреса
 * @returns `true`, если адрес приватный
 */
function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;

  if (a === undefined || b === undefined) {
    return true;
  }

  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Проверяет, что IPv4-адрес — служебный/немаршрутизируемый (сверх приватных).
 *
 * SSRF-денлист строже определения «private»: `0.0.0.0/8`, CGNAT `100.64/10`,
 * `192.0.0/24`, бенчмарк `198.18/15`, multicast `224/4` и зарезервированный
 * `240/4` тоже не должны быть целью запроса.
 *
 * @param octets - четыре октета адреса
 * @returns `true`, если адрес нельзя запрашивать
 */
function isUnsafeIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;

  if (a === undefined || b === undefined || c === undefined) {
    return true;
  }

  return (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/**
 * Возвращает встроенный IPv4 из IPv6-адреса, если он там есть.
 *
 * Разбираются две формы: IPv4-mapped (`::ffff:a.b.c.d`) и устаревшая
 * IPv4-compatible (`::a.b.c.d`). Иначе `null`.
 *
 * @param bytes - 16 байт адреса
 * @returns четыре октета встроенного IPv4 либо `null`
 */
function embeddedIpv4(bytes: readonly number[]): readonly number[] | null {
  const zeroPrefix = (length: number): boolean =>
    bytes.slice(0, length).every((byte) => byte === 0);

  if (zeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return bytes.slice(12);
  }

  if (zeroPrefix(12) && !bytes.slice(12).every((byte) => byte === 0)) {
    return bytes.slice(12);
  }

  return null;
}

/**
 * Проверяет, что IPv6-адрес из приватного/локального диапазона.
 *
 * Диапазоны из ТЗ: `::1` (loopback) и `fc00::/7` (unique local). Встроенный
 * IPv4 проверяется по IPv4-правилам, иначе `::ffff:127.0.0.1` обходил бы guard.
 *
 * @param bytes - 16 байт адреса
 * @returns `true`, если адрес приватный
 */
function isPrivateIpv6(bytes: readonly number[]): boolean {
  if (bytes.length !== 16) {
    return true;
  }

  const zeroPrefix = (length: number): boolean =>
    bytes.slice(0, length).every((byte) => byte === 0);

  // `::1` — loopback.
  if (zeroPrefix(15) && bytes[15] === 1) {
    return true;
  }

  const embedded = embeddedIpv4(bytes);

  if (embedded !== null) {
    return isPrivateIpv4(embedded);
  }

  // `fc00::/7` — unique local (аналог приватных IPv4).
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) {
    return true;
  }

  return false;
}

/**
 * Проверяет, что IPv6-адрес — служебный/немаршрутизируемый (сверх приватных).
 *
 * Блокируются: `::` (unspecified), `fe80::/10` (link-local), multicast
 * `ff00::/8`, `2001:db8::/32` (документация) и встроенный IPv4 из служебных
 * диапазонов.
 *
 * @param bytes - 16 байт адреса
 * @returns `true`, если адрес нельзя запрашивать
 */
function isUnsafeIpv6(bytes: readonly number[]): boolean {
  if (bytes.length !== 16) {
    return true;
  }

  if (bytes.every((byte) => byte === 0)) {
    return true;
  }

  const embedded = embeddedIpv4(bytes);

  if (embedded !== null) {
    return isPrivateIpv4(embedded) || isUnsafeIpv4(embedded);
  }

  const first = bytes[0] ?? 0;
  const second = bytes[1] ?? 0;

  // `fe80::/10` — link-local.
  if (first === 0xfe && (second & 0xc0) === 0x80) {
    return true;
  }

  // `ff00::/8` — multicast.
  if (first === 0xff) {
    return true;
  }

  // `2001:db8::/32` — документация (не маршрутизируется).
  return (
    first === 0x20 &&
    second === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  );
}

/**
 * Проверяет, что IP-адрес (любого семейства) приватный или локальный.
 *
 * Публичная функция с контрактом из ТЗ v0.10.2: `10.0.0.0/8`, `172.16.0.0/12`,
 * `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`.
 * Встроенный IPv4 (`::ffff:a.b.c.d`) проверяется по IPv4-правилам.
 *
 * Для проверки «можно ли делать запрос» используйте более строгий
 * {@link isBlockedIpAddress}: он дополнительно закрывает служебные диапазоны.
 *
 * @param address - IPv4/IPv6-литерал
 * @returns `true` для приватного адреса; `false` для публичного **и** для
 *   строки, которая не является IP
 */
export function isPrivateIp(address: string): boolean {
  // IPv6-литералы могут прийти в верхнем регистре (`FC00::1`): `isIP` принимает
  // оба варианта, а разбор групп — только нижний.
  const normalized = address.toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const octets = parseIpv4(normalized);

    return octets === null || isPrivateIpv4(octets);
  }

  if (family === 6) {
    const bytes = parseIpv6(normalized);

    return bytes === null || isPrivateIpv6(bytes);
  }

  return false;
}

/**
 * Проверяет, что IP-адрес нельзя использовать как цель исходящего запроса.
 *
 * Более строгий предикат, чем {@link isPrivateIp}: SSRF-денлист включает ещё
 * служебные/multicast/документационные диапазоны (историческое поведение
 * `isBlockedIpAddress` из KI-409 — регрессию допускать нельзя).
 *
 * @param address - IPv4/IPv6-литерал
 * @returns `true`, если адрес нельзя запрашивать; `false` для публичного
 *   адреса **и** для строки, которая не является IP
 */
export function isBlockedIpAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    const octets = parseIpv4(normalized);

    return octets === null || isPrivateIpv4(octets) || isUnsafeIpv4(octets);
  }

  if (family === 6) {
    const bytes = parseIpv6(normalized);

    return bytes === null || isPrivateIpv6(bytes) || isUnsafeIpv6(bytes);
  }

  return false;
}
