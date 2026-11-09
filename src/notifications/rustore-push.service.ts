import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Базовый URL RuStore Push API (S4-B).
 *
 * Официальный контракт отправки — `POST /v1/projects/{projectId}/messages:send`
 * (https://www.rustore.ru/help/en/sdk/push-notifications/send-push-notifications).
 * Вынесен отдельной константой, чтобы URL не собирался из магических строк в
 * двух местах.
 */
const RUSTORE_PUSH_BASE_URL = 'https://vkpns.rustore.ru/v1';

/**
 * Таймаут HTTP-запроса к RuStore, мс (RULES 4.19).
 *
 * 10 секунд — компромисс между медленным внешним API и временем удержания
 * HTTP-запроса/задания очереди: зависший push не должен блокировать вызывающий
 * код минутами.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Ошибка отправки push через RuStore Push (S4-B).
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: сервис вызывается из
 * фонового кода (будущий воркер/уведомления), и ошибка должна приводить к
 * `warn`/`failed` задания, а не к HTTP-ответу. Детерминирована: повтор с тем же
 * токеном/сервисным токеном даст тот же результат.
 *
 * В сообщение попадает HTTP-статус и код/статус ошибки RuStore, но **не**
 * сервисный токен и не полный токен устройства (RULES 5.3, 5.9).
 */
export class RuStorePushException extends Error {
  /**
   * @param message - понятный текст ошибки (без секретов)
   * @param options.cause - исходная ошибка fetch/тело ответа upstream, если есть
   */
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = 'RuStorePushException';

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Разобранное описание ошибки из тела ответа RuStore.
 *
 * Поля опциональны: upstream не обязан отдавать все три, а сообщение об ошибке
 * должно собираться из того, что реально пришло.
 */
interface RuStoreErrorDetails {
  /** Код ошибки RuStore (по контракту совпадает с HTTP-статусом). */
  readonly code?: number;
  /** Человекочитаемое сообщение об ошибке. */
  readonly message?: string;
  /** Символьный статус ошибки (например, `UNAUTHENTICATED`). */
  readonly status?: string;
}

/** Одно сообщение в теле запроса RuStore (поле `message`). */
interface RuStoreMessagePayload {
  /** Push-токен устройства. */
  readonly token: string;
  /** Заголовок и текст уведомления. */
  readonly notification: {
    readonly title: string;
    readonly body: string;
  };
  /** Произвольные data-поля (передаются только при непустых ключах). */
  readonly data?: Record<string, string>;
}

/** Тело запроса `messages:send`. */
interface RuStoreSendRequestBody {
  /** Сообщение: один токен = один запрос. */
  readonly message: RuStoreMessagePayload;
}

/**
 * Приводит строковую env-переменную к «задана/не задана».
 *
 * `validateEnv` возвращает `{ ...config, ...parsed }`, поэтому пустая строка из
 * `.env` остаётся в исходном `config`, даже если Zod-схема превратила её в
 * `undefined` (см. `emptyToUndefined`). Проверять нужно именно непустую строку
 * после `trim`, иначе `RUSTORE_PROJECT_ID=''` дал бы URL с пустым проектом.
 *
 * @param value - сырое значение из `ConfigService`
 * @returns обрезанное непустое значение либо `null` (значение «не задано»)
 */
function readOptionalString(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Проверяет, что значение — не-null объект (для разбора `unknown` без `any`,
 * RULES 4.15).
 *
 * @param value - произвольное значение из JSON
 * @returns `true`, если это объект/массив и обращение по ключу безопасно
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Разбирает тело ошибки RuStore `{ error: { code, message, status } }`.
 *
 * Не доверяет форме ответа (RULES 1.17): любое отклонение от контракта — это
 * `undefined`, а не брошенное исключение парсера. `code` по контракту число
 * (совпадает с HTTP-статусом), `message`/`status` — строки.
 *
 * @param payload - тело ответа, прочитанное как `unknown`
 * @returns разобранное описание ошибки либо `undefined`, если формы нет
 */
function parseRuStoreError(payload: unknown): RuStoreErrorDetails | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const error = payload['error'];

  if (!isRecord(error)) {
    return undefined;
  }

  const code = error['code'];
  const message = error['message'];
  const status = error['status'];

  if (
    typeof code !== 'number' &&
    typeof message !== 'string' &&
    typeof status !== 'string'
  ) {
    return undefined;
  }

  return {
    ...(typeof code === 'number' ? { code } : {}),
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof status === 'string' ? { status } : {}),
  };
}

/**
 * Собирает человекочитаемое описание ошибки upstream.
 *
 * @param details - разобранные поля ошибки RuStore (может не быть)
 * @returns строка с кодом/статусом/сообщением либо заглушка «без описания»
 */
function describeErrorDetails(details: RuStoreErrorDetails | undefined): string {
  if (details === undefined) {
    return 'тело ответа без описания ошибки';
  }

  const parts: string[] = [];

  if (details.code !== undefined) {
    parts.push(`код ${details.code}`);
  }

  if (details.status !== undefined) {
    parts.push(`статус ${details.status}`);
  }

  if (details.message !== undefined) {
    parts.push(`сообщение «${details.message}»`);
  }

  return parts.length === 0 ? 'тело ответа без описания ошибки' : parts.join(', ');
}

/**
 * Сервис отправки push-уведомлений через RuStore Push API (S4-B).
 *
 * Заменяет отправку через FCM: RuStore принимает один токен на запрос
 * (`POST /v1/projects/{projectId}/messages:send`), ответ об успехе — HTTP 200 с
 * пустым телом `{}`. Ошибка — JSON
 * `{ error: { code, message, status } }`, HTTP-статус равен `code`.
 *
 * **Конфигурация опциональна.** Без `RUSTORE_PROJECT_ID`/`RUSTORE_SERVICE_TOKEN`
 * приложение поднимается, регистрация токенов работает, а
 * {@link isConfigured} возвращает `false`; сам `sendAsync` в этом состоянии
 * бросает {@link RuStorePushException} с перечнем отсутствующих переменных.
 * Секреты читаются через `ConfigService` (RULES 4.6) и в логи не попадают
 * (RULES 5.3): токен уходит только в заголовке `Authorization`.
 */
@Injectable()
export class RuStorePushService {
  /** Project ID RuStore либо `null`, если переменная не задана. */
  private readonly projectId: string | null;

  /** Сервисный токен RuStore либо `null`, если переменная не задана. */
  private readonly serviceToken: string | null;

  /**
   * @param config - валидированная конфигурация окружения (`RUSTORE_*`,
   *   RULES 4.6)
   */
  constructor(config: ConfigService) {
    this.projectId = readOptionalString(
      config.get<string>('RUSTORE_PROJECT_ID'),
    );
    this.serviceToken = readOptionalString(
      config.get<string>('RUSTORE_SERVICE_TOKEN'),
    );
  }

  /**
   * Настроена ли отправка через RuStore.
   *
   * Нужен вызывающему коду, который не хочет даже пытаться отправить push в
   * заведомо ненастроенном окружении (`DeviceTokensService.sendToUserAsync`
   * пишет WARN и возвращает 0), и диагностике.
   *
   * @returns `true`, если заданы и `RUSTORE_PROJECT_ID`, и `RUSTORE_SERVICE_TOKEN`
   */
  isConfigured(): boolean {
    return this.projectId !== null && this.serviceToken !== null;
  }

  /**
   * Отправляет одно push-уведомление на один токен устройства.
   *
   * Один вызов — один HTTP-запрос: RuStore API не принимает массив токенов в
   * одном сообщении. Вызывающий код для группы устройств использует
   * `Promise.allSettled` (RULES 4.16), чтобы отказ одного устройства не
   * отменял остальные.
   *
   * @param token - push-токен RuStore/FCM устройства (в логи не пишется)
   * @param title - заголовок уведомления
   * @param body - текст уведомления
   * @param data - дополнительные data-поля; пустые ключи отбрасываются,
   *   полностью пустой объект в тело запроса не попадает
   * @returns промис без значения: успех — HTTP 200 (тело `{}` игнорируется)
   * @throws RuStorePushException если сервис не настроен, запрос не выполнился
   *   (сеть/таймаут) или RuStore ответил не-2xx; сообщение содержит HTTP-статус
   *   и код/статус ошибки RuStore, но не секреты
   */
  async sendAsync(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    const { projectId, serviceToken } = this;

    if (projectId === null || serviceToken === null) {
      throw new RuStorePushException(
        `RuStore Push не настроен: не заданы ${this.missingEnvNames().join(', ')}`,
      );
    }

    const url = `${RUSTORE_PUSH_BASE_URL}/projects/${projectId}/messages:send`;
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.buildRequestBody(token, title, body, data)),
        signal,
      });
    } catch (error: unknown) {
      // Сеть/таймаут: не гасим ошибку (RULES 4.18), но и не тащим в сообщение
      // токены — только причина отказа.
      throw new RuStorePushException(
        signal.aborted
          ? `RuStore Push: истёк таймаут запроса (${REQUEST_TIMEOUT_MS} мс)`
          : 'RuStore Push: не удалось обратиться к API',
        { cause: error },
      );
    }

    if (response.ok) {
      // Контракт успеха — HTTP 200 и пустое тело `{}`; читать нечего.
      return;
    }

    const details = await this.readErrorDetailsAsync(response);

    throw new RuStorePushException(
      `RuStore API ответил HTTP ${response.status}: ${describeErrorDetails(details)}`,
    );
  }

  /**
   * Собирает тело запроса `messages:send`.
   *
   * Поле `data` добавляется только при непустых ключах: RuStore не принимает
   * пустой объект, а лишнее поле меняло бы контракт запроса.
   *
   * @param token - push-токен устройства
   * @param title - заголовок уведомления
   * @param body - текст уведомления
   * @param data - дополнительные data-поля (необязательны)
   * @returns тело запроса в формате RuStore Push API
   */
  private buildRequestBody(
    token: string,
    title: string,
    body: string,
    data: Record<string, string> | undefined,
  ): RuStoreSendRequestBody {
    const dataEntries = Object.entries(data ?? {}).filter(
      ([key]) => key.trim().length > 0,
    );

    return {
      message: {
        token,
        notification: { title, body },
        ...(dataEntries.length > 0 ? { data: Object.fromEntries(dataEntries) } : {}),
      },
    };
  }

  /**
   * Читает тело ошибки RuStore, не роняя отправку на битом JSON.
   *
   * @param response - ответ с HTTP-статусом не-2xx
   * @returns разобранное описание ошибки либо `undefined`, если тела нет/оно
   *   не соответствует контракту
   */
  private async readErrorDetailsAsync(
    response: Response,
  ): Promise<RuStoreErrorDetails | undefined> {
    try {
      const payload: unknown = await response.json();

      return parseRuStoreError(payload);
    } catch {
      // Не-JSON тело (HTML от прокси и т.п.) — не повод терять HTTP-статус:
      // он всё равно попадёт в сообщение об ошибке.
      return undefined;
    }
  }

  /**
   * Перечисляет отсутствующие env-переменные для сообщения об ошибке.
   *
   * @returns имена незаданных переменных (`RUSTORE_PROJECT_ID` /
   *   `RUSTORE_SERVICE_TOKEN`)
   */
  private missingEnvNames(): string[] {
    return [
      ...(this.projectId === null ? ['RUSTORE_PROJECT_ID'] : []),
      ...(this.serviceToken === null ? ['RUSTORE_SERVICE_TOKEN'] : []),
    ];
  }
}
