/**
 * Unit-тесты `RuStorePushService` (S4-B, миграция FCM → RuStore Push).
 *
 * Сеть не используется: глобальный `fetch` подменяется моком
 * (`vi.stubGlobal`), после каждого теста — `vi.unstubAllGlobals()`. Проверяются
 * контракт запроса к RuStore API (URL/метод/заголовки/тело, `data` только с
 * непустыми ключами), разбор ошибок `{ error: { code, message, status } }`,
 * сетевой сбой, режим «не настроено» и отсутствие секретов в текстах ошибок.
 */
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  RuStorePushException,
  RuStorePushService,
} from './rustore-push.service.js';

/** Project ID из тестовой конфигурации (не секрет, попадает в URL). */
const PROJECT_ID = 'project-42';

/** Сервисный токен из тестовой конфигурации (секрет, в логи не должен). */
const SERVICE_TOKEN = 'service-token-test';

/** Push-токен устройства (в логи не должен попадать целиком). */
const DEVICE_TOKEN = 'rustore-device-token-abc123';

/** Заголовок уведомления. */
const TITLE = 'Новый запуск workflow';

/** Текст уведомления. */
const BODY = 'Запуск завершился успешно';

/** Ожидаемый URL отправки (контракт RuStore Push API). */
const SEND_URL = `https://vkpns.rustore.ru/v1/projects/${PROJECT_ID}/messages:send`;

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * `get` — `vi.fn`, как в остальных spec'ах проекта (RULES 4.14): сервис читает
 * конфигурацию только через него (RULES 4.6).
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return {
    get: vi.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/**
 * Создаёт сервис через Nest DI (`Test.createTestingModule`, RULES 4.13).
 *
 * @param values - значения env для заглушки ConfigService
 * @returns готовый экземпляр RuStorePushService
 */
async function createService(
  values: Record<string, string | undefined>,
): Promise<RuStorePushService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      RuStorePushService,
      { provide: ConfigService, useValue: configStub(values) },
    ],
  }).compile();

  return moduleRef.get(RuStorePushService);
}

/**
 * Подменяет глобальный `fetch` JSON-ответом с заданным статусом и телом.
 *
 * Фабрика создаёт `Response` один раз: сервис читает тело только у не-2xx
 * ответов (успех — HTTP 200 с пустым `{}` ничего не читает), поэтому повторное
 * чтение в тестах не нужно.
 *
 * @param status - HTTP-статус ответа
 * @param body - тело ответа (сериализуется в JSON), `undefined` — пустое тело
 * @returns мок fetch
 */
function stubFetchJson(
  status = 200,
  body?: unknown,
): ReturnType<typeof vi.fn> {
  const response = new Response(
    body === undefined ? '' : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
  const mock = vi.fn(() => Promise.resolve(response));

  vi.stubGlobal('fetch', mock);

  return mock;
}

/**
 * Подменяет глобальный `fetch` ответом с не-JSON телом (например, HTML прокси).
 *
 * @param status - HTTP-статус ответа
 * @returns мок fetch
 */
function stubFetchNonJson(status: number): ReturnType<typeof vi.fn> {
  const response = new Response('<html>Bad Gateway</html>', { status });
  const mock = vi.fn(() => Promise.resolve(response));

  vi.stubGlobal('fetch', mock);

  return mock;
}

/**
 * Подменяет глобальный `fetch` отказом на уровне сети (DNS/ECONNREFUSED).
 *
 * @param error - ошибка, которой отклоняется промис fetch
 * @returns мок fetch
 */
function stubFetchReject(error: Error): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() => Promise.reject(error));

  vi.stubGlobal('fetch', mock);

  return mock;
}

/**
 * Достаёт опции первого вызова мока `fetch`.
 *
 * @param mock - мок fetch
 * @returns URL и опции запроса
 */
function firstCall(mock: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit;
} {
  const call = mock.mock.calls[0] as [string, RequestInit];

  return { url: call[0], init: call[1] };
}

/**
 * Достаёт тело запроса из мока `fetch`.
 *
 * @param init - опции запроса из мока
 * @returns разобранное тело запроса
 */
function bodyOf(init: RequestInit): unknown {
  const body = init.body;

  return typeof body === 'string' ? JSON.parse(body) : null;
}

/**
 * Дожидается отклонения промиса и требует именно {@link RuStorePushException}.
 *
 * @param action - промис вызова сервиса
 * @returns пойманная ошибка RuStorePushException
 */
async function captureRejection(
  action: Promise<unknown>,
): Promise<RuStorePushException> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof RuStorePushException) {
      return error;
    }

    throw error;
  }

  throw new Error('Ожидалась RuStorePushException, но вызов завершился успешно');
}

describe('RuStorePushService (S4-B)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('true только когда заданы и Project ID, и сервисный токен', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });

      expect(service.isConfigured()).toBe(true);
    });

    it('false, если не задана хотя бы одна переменная', async () => {
      const empty = await createService({});
      const onlyProject = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
      });
      const onlyToken = await createService({
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });

      expect(empty.isConfigured()).toBe(false);
      expect(onlyProject.isConfigured()).toBe(false);
      expect(onlyToken.isConfigured()).toBe(false);
    });

    it('пустые строки и пробелы — «не задано» (KI-084)', async () => {
      // `validateEnv` сохраняет исходный ключ: `get()` может вернуть '',
      // поэтому сервис дополнительно тримит значение.
      const service = await createService({
        RUSTORE_PROJECT_ID: '   ',
        RUSTORE_SERVICE_TOKEN: '',
      });

      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('sendAsync', () => {
    it('отправляет POST в RuStore с токеном, notification и без data', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });
      const fetchMock = stubFetchJson(200, {});

      await expect(
        service.sendAsync(DEVICE_TOKEN, TITLE, BODY),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const { url, init } = firstCall(fetchMock);

      expect(url).toBe(SEND_URL);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        Authorization: `Bearer ${SERVICE_TOKEN}`,
        'Content-Type': 'application/json',
      });
      // RULES 4.19: запрос ограничен таймаутом через AbortSignal.
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(bodyOf(init)).toEqual({
        message: {
          token: DEVICE_TOKEN,
          notification: { title: TITLE, body: BODY },
        },
      });
    });

    it('передаёт data и отбрасывает пустые ключи', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });
      const fetchMock = stubFetchJson(200, {});

      await service.sendAsync(DEVICE_TOKEN, TITLE, BODY, {
        orderId: '42',
        '': 'пустой ключ',
        '   ': 'пробельный ключ',
      });

      const { init } = firstCall(fetchMock);

      expect(bodyOf(init)).toEqual({
        message: {
          token: DEVICE_TOKEN,
          notification: { title: TITLE, body: BODY },
          data: { orderId: '42' },
        },
      });
    });

    it('не добавляет пустой data в тело запроса', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });
      const fetchMock = stubFetchJson(200, {});

      await service.sendAsync(DEVICE_TOKEN, TITLE, BODY, {});

      const { init } = firstCall(fetchMock);

      expect(bodyOf(init)).toEqual({
        message: {
          token: DEVICE_TOKEN,
          notification: { title: TITLE, body: BODY },
        },
      });
      // Пустой объект data в тело не попадает (проверка — строгим равенством
      // выше: лишнего ключа `data` в нём нет).
      expect(bodyOf(init)).not.toHaveProperty('message.data');
    });

    it('не-2xx: RuStorePushException с HTTP-статусом и кодом/статусом RuStore', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });
      stubFetchJson(401, {
        error: {
          code: 401,
          message: 'Invalid service token',
          status: 'UNAUTHENTICATED',
        },
      });

      const error = await captureRejection(
        service.sendAsync(DEVICE_TOKEN, TITLE, BODY),
      );

      expect(error.name).toBe('RuStorePushException');
      expect(error.message).toContain('HTTP 401');
      expect(error.message).toContain('UNAUTHENTICATED');
      expect(error.message).toContain('Invalid service token');
      // Секреты в текст ошибки не попадают (RULES 5.3, 5.9).
      expect(error.message).not.toContain(SERVICE_TOKEN);
      expect(error.message).not.toContain(DEVICE_TOKEN);
    });

    it('не-2xx с не-JSON телом: ошибка всё равно содержит HTTP-статус', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });
      stubFetchNonJson(502);

      const error = await captureRejection(
        service.sendAsync(DEVICE_TOKEN, TITLE, BODY),
      );

      expect(error.message).toContain('HTTP 502');
      expect(error.message).toContain('без описания ошибки');
    });

    it('сетевой сбой: RuStorePushException с cause и без секретов', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
        RUSTORE_SERVICE_TOKEN: SERVICE_TOKEN,
      });
      const networkError = new Error('ECONNREFUSED 127.0.0.1:443');
      const fetchMock = stubFetchReject(networkError);

      const error = await captureRejection(
        service.sendAsync(DEVICE_TOKEN, TITLE, BODY),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(RuStorePushException);
      expect(error.cause).toBe(networkError);
      expect(error.message).not.toContain(SERVICE_TOKEN);
      expect(error.message).not.toContain(DEVICE_TOKEN);
    });

    it('не настроен: RuStorePushException с перечнем отсутствующих env, fetch не вызывается', async () => {
      const service = await createService({});
      const fetchMock = stubFetchJson(200, {});

      const error = await captureRejection(
        service.sendAsync(DEVICE_TOKEN, TITLE, BODY),
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(error.message).toContain('не настроен');
      expect(error.message).toContain('RUSTORE_PROJECT_ID');
      expect(error.message).toContain('RUSTORE_SERVICE_TOKEN');
    });

    it('не настроен частично: перечислена только отсутствующая переменная', async () => {
      const service = await createService({
        RUSTORE_PROJECT_ID: PROJECT_ID,
      });

      const error = await captureRejection(
        service.sendAsync(DEVICE_TOKEN, TITLE, BODY),
      );

      expect(error.message).toContain('RUSTORE_SERVICE_TOKEN');
      expect(error.message).not.toContain('RUSTORE_PROJECT_ID');
    });
  });
});
