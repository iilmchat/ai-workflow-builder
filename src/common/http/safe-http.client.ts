/**
 * Безопасный HTTP-клиент (v0.11 S14, DESIGN § 3.5.1; KI-434/435/478).
 *
 * Единственная точка исходящих HTTP-запросов из узла `http` и инструмента
 * агента `http_request`. Закрывает три класса атак:
 *
 * - **SSRF по адресу** (KI-478): имена `localhost`/metadata и приватные IP
 *   блокируются до сетевого вызова, а домен резолвится один раз и проверяется
 *   по **всем** полученным адресам;
 * - **SSRF по редиректу** (KI-434): `redirect: 'manual'` у `undici`, каждый
 *   `Location` разрешается относительно текущего URL и проходит проверку
 *   заново; лимит — {@link HTTP_MAX_REDIRECTS} хопов;
 * - **DNS rebinding** (KI-435): выбранный IP «прибивается» через
 *   `Agent({ connect: { lookup } })`, поэтому второй резолв (уже внутри
 *   соединения) вернуть приватный адрес не может. TLS SNI и `Host` остаются
 *   исходными: pinning живёт только на уровне DNS.
 *
 * Поверх этого — таймаут + сигнал вызова через
 * `AbortSignal.any([signal, AbortSignal.timeout(...)])` (RULES 4.19) и лимит
 * тела ответа с потоковым чтением (по умолчанию 1 МБ): мегабайтные ответы не
 * должны раздувать `node_runs.outputs` (KI-025).
 *
 * **Почему `undici`, а не глобальный `fetch`.** `fetch` не даёт подменить
 * резолвер на уровне сокета: проверенный адрес и адрес фактического соединения
 * — разные вещи. `undici.request` + `Agent` с `connect.lookup` — минимальный
 * способ прибить IP, не теряя TLS SNI/HTTP-семантику.
 */
import { Injectable, Optional, Inject } from '@nestjs/common';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { Agent, request } from 'undici';
import {
  HTTP_MAX_REDIRECTS,
  SsrfBlockedException,
  TooManyRedirectsException,
  defaultDnsLookupAsync,
  isBlockedHostname,
  isBlockedIpAddress,
  isMetadataHostname,
  isMetadataIpAddress,
  normalizeHostname,
  type DnsLookupAsync,
} from '../utils/network-safety.js';

/** Методы HTTP, поддержанные безопасным клиентом (как у узла `http`, KI-105). */
export type SafeHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Лимит тела ответа по умолчанию — 1 МБ (DESIGN § 3.5.1, KI-025). */
export const SAFE_HTTP_MAX_RESPONSE_BYTES = 1_000_000;

/** Таймаут запроса по умолчанию, мс (RULES 4.19; как у узла `http`). */
export const SAFE_HTTP_DEFAULT_TIMEOUT_MS = 30_000;

/** Токен DI для опций клиента (нужен только тестам/альтернативным сборкам). */
export const SAFE_HTTP_OPTIONS = 'SAFE_HTTP_OPTIONS';

/** Запрос к {@link SafeHttpClient}. */
export interface SafeHttpRequest {
  /** Абсолютный `http(s)`-URL. */
  readonly url: string;
  /** HTTP-метод. */
  readonly method: SafeHttpMethod;
  /** Заголовки запроса (не логируются целиком — RULES 5.9). */
  readonly headers?: Record<string, string>;
  /** Тело запроса (только для не-GET; не логируется — RULES 5.9). */
  readonly body?: string;
  /** Таймаут на всю цепочку редиректов (включая чтение тела), мс. */
  readonly timeoutMs: number;
  /** Максимум переходов по редиректам (по умолчанию {@link HTTP_MAX_REDIRECTS}). */
  readonly maxRedirects?: number;
  /** Максимум байт тела ответа (по умолчанию {@link SAFE_HTTP_MAX_RESPONSE_BYTES}). */
  readonly maxResponseBytes?: number;
  /**
   * Разрешены ли приватные/локальные адреса (только для узла `http` при
   * `HTTP_NODE_ALLOW_PRIVATE_NETWORKS=true`).
   *
   * Metadata-алиасы (`169.254.169.254`, `metadata.google.internal`) остаются
   * запрещёнными и при `true`: это чужие instance-credentials, а не «внутренний
   * сервис» (DESIGN § 3.5.1).
   */
  readonly allowPrivateNetworks?: boolean;
  /** Сигнал отмены вызывающего кода; объединяется с таймаутом. */
  readonly signal?: AbortSignal;
}

/** Успешный (в т. ч. 4xx/5xx) ответ {@link SafeHttpClient}. */
export interface SafeHttpResponse {
  /** HTTP-код финального ответа. */
  readonly status: number;
  /** `true` для 2xx (как у `fetch`). */
  readonly ok: boolean;
  /** Заголовки финального ответа. */
  readonly headers: Headers;
  /** Тело ответа (≤ `maxResponseBytes`). */
  readonly body: string;
  /** URL последнего хопа (после редиректов). */
  readonly finalUrl: string;
}

/** Инициализация одного сетевого хопа (то, что уходит в транспорт). */
export interface SafeHttpTransportInit {
  /** Метод хопа. */
  readonly method: SafeHttpMethod;
  /** Заголовки хопа. */
  readonly headers: Record<string, string>;
  /** Тело хопа (только для методов с телом). */
  readonly body?: string;
  /** Объединённый сигнал (отмена + таймаут). */
  readonly signal: AbortSignal;
}

/** Ответ транспорта до чтения тела. */
export interface SafeHttpTransportResponse {
  /** HTTP-код. */
  readonly status: number;
  /** Заголовки ответа. */
  readonly headers: Headers;
  /** Поток тела ответа. */
  readonly body: AsyncIterable<Uint8Array>;
  /**
   * Освобождает соединение, не читая тело (редирект/ошибка).
   *
   * @returns промис без значения
   */
  discardAsync(): Promise<void>;
}

/**
 * Транспорт одного хопа: по умолчанию `undici.request` с прибитым `Agent`.
 *
 * Вынесен в тип, чтобы тесты подменяли сеть, не поднимая локальный сервер.
 */
export type SafeHttpTransportAsync = (
  url: URL,
  init: SafeHttpTransportInit,
  dispatcher: Agent,
) => Promise<SafeHttpTransportResponse>;

/** Опции {@link SafeHttpClient} (в продакшене — дефолты). */
export interface SafeHttpClientOptions {
  /** Резолвер DNS (в тестах — мок, чтобы не ходить в сеть). */
  readonly lookupAsync?: DnsLookupAsync;
  /** Транспорт одного хопа (в тестах — фейк вместо `undici.request`). */
  readonly transportAsync?: SafeHttpTransportAsync;
  /** Таймаут установки соединения (не больше общего таймаута запроса), мс. */
  readonly connectTimeoutMs?: number;
}

/**
 * Ошибка: DNS не смог разрешить имя (fail closed).
 *
 * Отличается от прежнего «DNS fail-open» поведения (KI-435): если адрес
 * неизвестен, прибить IP нельзя, значит запрос небезопасен. Вызывающий код
 * получает понятную причину, а не сетевую ошибку `fetch`.
 */
export class SafeHttpDnsException extends Error {
  /** Имя хоста, которое не разрешилось. */
  readonly hostname: string;

  /**
   * @param hostname - имя хоста из URL
   * @param cause - исходная ошибка резолвера (для логов)
   */
  constructor(hostname: string, cause?: unknown) {
    super(
      cause instanceof Error
        ? `SafeHttp: DNS не разрешил '${hostname}': ${cause.message}`
        : `SafeHttp: DNS не разрешил '${hostname}'`,
    );
    this.name = 'SafeHttpDnsException';
    this.hostname = hostname;
    this.cause = cause;
  }
}

/**
 * Ошибка: тело ответа больше допустимого лимита.
 *
 * Тело не сохраняется: запрос обрывается, соединение закрывается, наружу
 * уходит только лимит — иначе мегабайтный чужой ответ оседал бы в
 * `node_runs.outputs` (KI-025) или в транскрипте агента.
 */
export class SafeHttpResponseTooLargeException extends Error {
  /** Предельный размер тела, байт. */
  readonly maxBytes: number;

  /**
   * @param maxBytes - предельный размер тела
   */
  constructor(maxBytes: number) {
    super(`SafeHttp: тело ответа превышает лимит ${maxBytes} байт`);
    this.name = 'SafeHttpResponseTooLargeException';
    this.maxBytes = maxBytes;
  }
}

/** HTTP-коды, которые клиент обязан обработать как редирект. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/** Результат проверки одного URL: адрес, к которому разрешено подключаться. */
interface SafeDestination {
  /** Разобранный URL (для `Host`/SNI). */
  readonly url: URL;
  /** Нормализованное имя хоста (для сверки в pinned lookup). */
  readonly hostname: string;
  /** Прибитый IP-адрес. */
  readonly address: string;
  /** Семейство прибитого адреса (4/6). */
  readonly family: number;
}

/**
 * Создаёт `lookup`, который для ожидаемого хоста возвращает только прибитый IP.
 *
 * Это сердце защиты от DNS rebinding (KI-435): `undici` вызывает `lookup` уже
 * внутри соединения, и подменить ответ злоумышленник не может — второго
 * DNS-запроса нет. Любой другой hostname (аномалия/подмена) — ошибка
 * соединения, а не резолв.
 *
 * @param expectedHostname - нормализованное имя хоста из URL
 * @param address - IP, полученный единственным DNS-резолвом
 * @param family - семейство адреса (4 или 6)
 * @returns функция `lookup` для `connect.lookup` в `undici.Agent`
 */
export function createPinnedLookup(
  expectedHostname: string,
  address: string,
  family: number,
): LookupFunction {
  return (hostname, options, callback): void => {
    if (normalizeHostname(hostname) !== expectedHostname) {
      callback(
        new Error(
          `SafeHttp: неожиданный hostname при connect '${hostname}', ожидался '${expectedHostname}'`,
        ),
        '',
        4,
      );

      return;
    }

    if (options.all === true) {
      callback(null, [{ address, family }], family);

      return;
    }

    callback(null, address, family);
  };
}

/**
 * Транспорт по умолчанию: `undici.request` с переданным диспетчером.
 *
 * Редиректы не обрабатываются намеренно: `undici.request` их и не переходит,
 * а решение «идти или блокировать» принимает {@link SafeHttpClient}.
 *
 * @param url - URL хопа
 * @param init - метод/заголовки/тело/сигнал
 * @param dispatcher - `Agent` с pinned lookup
 * @returns ответ транспорта
 */
async function undiciTransportAsync(
  url: URL,
  init: SafeHttpTransportInit,
  dispatcher: Agent,
): Promise<SafeHttpTransportResponse> {
  const response = await request(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    dispatcher,
  });

  return {
    status: response.statusCode,
    headers: toHeaders(response.headers),
    body: response.body,
    async discardAsync(): Promise<void> {
      // `destroy()` освобождает сокет, не дочитывая тело редиректа.
      response.body.destroy();
      await Promise.resolve();
    },
  };
}

/**
 * Приводит `IncomingHttpHeaders` (`undici`) к стандартному `Headers`.
 *
 * @param raw - заголовки ответа `undici`
 * @returns объект `Headers` (без `undefined`-значений)
 */
function toHeaders(
  raw: Record<string, string | string[] | undefined>,
): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

/**
 * Освобождает соединение одного хопа, не пробрасывая ошибки закрытия.
 *
 * @param agent - диспетчер хопа
 * @returns промис без значения
 */
async function closeAgentAsync(agent: Agent): Promise<void> {
  try {
    await agent.close();
  } catch {
    // Сокет мог быть уже закрыт отменой/таймаутом — это не повод ронять запрос.
  }
}

/**
 * Читает тело потоком с лимитом байт.
 *
 * @param body - поток тела
 * @param maxBytes - предельный размер
 * @returns текст тела
 * @throws SafeHttpResponseTooLargeException если тело превысило лимит
 */
async function readBodyLimitedAsync(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    total += buffer.length;

    if (total > maxBytes) {
      throw new SafeHttpResponseTooLargeException(maxBytes);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Разрешает `Location` редиректа относительно текущего URL.
 *
 * @param location - заголовок `Location`
 * @param currentUrl - URL, вернувший редирект
 * @returns абсолютный URL следующего хопа
 * @throws Error если `Location` не удаётся разобрать
 */
function resolveLocation(location: string, currentUrl: URL): URL {
  try {
    return new URL(location, currentUrl);
  } catch {
    throw new Error('SafeHttp: некорректный Location в ответе-редиректе');
  }
}

/**
 * Пересчитывает метод/тело при переходе по редиректу (как браузер/`fetch`).
 *
 * `303` всегда становится `GET`; `301`/`302` с `POST` — тоже; `307`/`308`
 * сохраняют метод и тело.
 *
 * @param method - текущий метод
 * @param status - код редиректа
 * @returns метод и признак «тело отброшено»
 */
function redirectedMethod(
  method: SafeHttpMethod,
  status: number,
): { method: SafeHttpMethod; keepBody: boolean } {
  const becomesGet =
    status === 303 || ((status === 301 || status === 302) && method === 'POST');

  return becomesGet
    ? { method: 'GET', keepBody: false }
    : { method, keepBody: true };
}

/**
 * Безопасный HTTP-клиент (DESIGN § 3.5.1).
 *
 * Создаётся один раз через DI (`@Injectable`) либо напрямую в тестах с
 * подменённым транспортом/резолвером. Состояния не хранит: каждый запрос
 * независим.
 */
@Injectable()
export class SafeHttpClient {
  /** Резолвер DNS (продакшен — системный `dns.lookup`). */
  private readonly lookupAsync: DnsLookupAsync;

  /** Транспорт одного хопа (продакшен — `undici.request`). */
  private readonly transportAsync: SafeHttpTransportAsync;

  /** Таймаут установки соединения, мс. */
  private readonly connectTimeoutMs: number;

  /**
   * @param options - переопределения для тестов; в продакшене не передаются
   */
  constructor(
    @Optional()
    @Inject(SAFE_HTTP_OPTIONS)
    options?: SafeHttpClientOptions,
  ) {
    this.lookupAsync = options?.lookupAsync ?? defaultDnsLookupAsync;
    this.transportAsync = options?.transportAsync ?? undiciTransportAsync;
    this.connectTimeoutMs = options?.connectTimeoutMs ?? 10_000;
  }

  /**
   * Выполняет HTTP-запрос с SSRF-защитой и ручным обходом редиректов.
   *
   * @param requestOptions - URL, метод, тело, таймаут и лимиты
   * @returns финальный ответ (тело ≤ `maxResponseBytes`)
   * @throws SsrfBlockedException если любой хоп ведёт на запрещённый адрес
   * @throws SafeHttpDnsException если имя не разрешилось (fail closed)
   * @throws TooManyRedirectsException если цепочка длиннее лимита
   * @throws SafeHttpResponseTooLargeException если тело больше лимита
   * @throws Error если URL/Location невалиден, схема не http(s) или в URL есть
   *   учётные данные
   */
  async fetchAsync(requestOptions: SafeHttpRequest): Promise<SafeHttpResponse> {
    const timeoutMs = Math.max(1, requestOptions.timeoutMs);
    const maxRedirects = requestOptions.maxRedirects ?? HTTP_MAX_REDIRECTS;
    const maxBytes =
      requestOptions.maxResponseBytes ?? SAFE_HTTP_MAX_RESPONSE_BYTES;
    const allowPrivateNetworks = requestOptions.allowPrivateNetworks === true;
    // Один таймер на всю цепочку: пять хопов по 30 с — это 150 с удержания
    // узла, а не «таймаут запроса».
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal =
      requestOptions.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([requestOptions.signal, timeoutSignal]);

    let currentUrl = requestOptions.url;
    let method = requestOptions.method;
    let headers: Record<string, string> = requestOptions.headers ?? {};
    let body: string | undefined = requestOptions.body;
    /** URL, с которого пришёл текущий редирект; `null` — прямой запрос. */
    let redirectFrom: string | null = null;

    for (let hop = 0; ; hop += 1) {
      const destination = await this.resolveDestinationAsync(
        currentUrl,
        allowPrivateNetworks,
        redirectFrom,
      );
      const agent = new Agent({
        connect: {
          timeout: Math.min(timeoutMs, this.connectTimeoutMs),
          lookup: createPinnedLookup(
            destination.hostname,
            destination.address,
            destination.family,
          ),
        },
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      let response: SafeHttpTransportResponse;

      try {
        response = await this.transportAsync(
          destination.url,
          { method, headers, body, signal },
          agent,
        );
      } catch (error: unknown) {
        await closeAgentAsync(agent);

        throw error;
      }

      const location = response.headers.get('location');

      // 3xx без Location — не цепочка: отдаём как есть (как браузер).
      if (
        !REDIRECT_STATUSES.has(response.status) ||
        location === null ||
        location.trim().length === 0
      ) {
        try {
          const responseBody = await readBodyLimitedAsync(
            response.body,
            maxBytes,
          );

          return {
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
            headers: response.headers,
            body: responseBody,
            finalUrl: destination.url.href,
          };
        } catch (error: unknown) {
          // Тело не дочитано — соединение нужно освободить, иначе сокет
          // останется висеть до сборки мусора.
          try {
            await response.discardAsync();
          } catch {
            // Поток мог быть уже разрушен лимитом — ошибка закрытия не важна.
          }

          throw error;
        } finally {
          await closeAgentAsync(agent);
        }
      }

      // Редирект: тело не нужно, освобождаем соединение до следующего хопа.
      try {
        await response.discardAsync();
      } finally {
        await closeAgentAsync(agent);
      }

      if (hop >= maxRedirects) {
        throw new TooManyRedirectsException(maxRedirects);
      }

      redirectFrom = currentUrl;
      currentUrl = resolveLocation(location.trim(), destination.url).href;
      const next = redirectedMethod(method, response.status);

      method = next.method;

      if (!next.keepBody) {
        body = undefined;
      }
    }
  }

  /**
   * Проверяет один хоп и выбирает IP для подключения.
   *
   * **Порядок:** схема и учётные данные → денлист имён (metadata — всегда,
   * локальные — если приватные сети запрещены) → IP-литерал либо **один**
   * DNS-резолв `all: true` → проверка **каждого** адреса → первый адрес
   * прибивается.
   *
   * @param rawUrl - URL хопа
   * @param allowPrivateNetworks - разрешены ли приватные сети (узел `http`)
   * @param redirectFrom - URL, с которого пришёл редирект (для текста ошибки)
   * @returns разобранный URL и прибитый адрес
   * @throws SsrfBlockedException если адрес/имя запрещены
   * @throws SafeHttpDnsException если имя не разрешилось
   * @throws Error если URL/Location невалиден или схема не http(s)
   */
  private async resolveDestinationAsync(
    rawUrl: string,
    allowPrivateNetworks: boolean,
    redirectFrom: string | null,
  ): Promise<SafeDestination> {
    let url: URL;

    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(
        'SafeHttp: некорректный URL — ожидался абсолютный http(s)-адрес',
      );
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('SafeHttp: URL должен использовать протокол http или https');
    }

    // `user:pass@host` в URL — способ спрятать реальный хост и подсунуть
    // credentials в лог/заголовки; такие адреса не поддерживаем.
    if (url.username.length > 0 || url.password.length > 0) {
      throw new Error('SafeHttp: URL с учётными данными (user:pass@) запрещён');
    }

    const hostname = normalizeHostname(url.hostname);

    if (hostname.length === 0) {
      throw new SsrfBlockedException(hostname, null, redirectFrom);
    }

    // Metadata-алиасы — всегда; остальные локальные имена — только когда
    // приватные сети запрещены (DESIGN § 3.5.1).
    if (
      isMetadataHostname(hostname) ||
      (!allowPrivateNetworks && isBlockedHostname(hostname))
    ) {
      throw new SsrfBlockedException(hostname, null, redirectFrom);
    }

    const literalFamily = isIP(hostname);

    if (literalFamily !== 0) {
      if (
        isMetadataIpAddress(hostname) ||
        (!allowPrivateNetworks && isBlockedIpAddress(hostname))
      ) {
        throw new SsrfBlockedException(hostname, hostname, redirectFrom);
      }

      return {
        url,
        hostname,
        address: hostname,
        family: literalFamily,
      };
    }

    let addresses: readonly string[];

    try {
      addresses = await this.lookupAsync(hostname);
    } catch (error: unknown) {
      throw new SafeHttpDnsException(hostname, error);
    }

    if (addresses.length === 0) {
      throw new SafeHttpDnsException(
        hostname,
        new Error('резолвер не вернул ни одного адреса'),
      );
    }

    for (const address of addresses) {
      if (
        isMetadataIpAddress(address) ||
        (!allowPrivateNetworks && isBlockedIpAddress(address))
      ) {
        throw new SsrfBlockedException(hostname, address, redirectFrom);
      }
    }

    const [pinned] = addresses;
    const family = pinned === undefined ? 0 : isIP(pinned);

    if (pinned === undefined || family === 0) {
      throw new SafeHttpDnsException(
        hostname,
        new Error('резолвер вернул не IP-адрес'),
      );
    }

    return { url, hostname, address: pinned, family };
  }
}
