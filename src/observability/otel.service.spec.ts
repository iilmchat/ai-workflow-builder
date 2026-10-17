import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  NoopTracingAdapter,
  getTracingAdapter,
  resetTracingAdapter,
} from './tracing.js';
import { OtelService } from './otel.service.js';

/**
 * Общие шпионы SDK: `vi.mock` поднимается хойстингом, поэтому обращаться к
 * обычным переменным из фабрики нельзя — только через `vi.hoisted`.
 */
const sdk = vi.hoisted(() => ({
  /** Вызов `NodeSDK.start()`. */
  start: vi.fn(),
  /** Вызов `NodeSDK.shutdown()`. */
  shutdown: vi.fn(() => Promise.resolve()),
  /** Конфиги, с которыми создавался `NodeSDK`. */
  sdkConfigs: [] as Array<Record<string, unknown>>,
  /** Конфиги, с которыми создавался OTLP-экспортёр. */
  exporterConfigs: [] as Array<Record<string, unknown>>,
  /** Бросать ли ошибку в конструкторе SDK (тест «не роняем приложение»). */
  failInit: false,
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    /**
     * @param config - конфигурация SDK
     * @throws Error если тест просит смоделировать сбой инициализации
     */
    constructor(config: Record<string, unknown>) {
      if (sdk.failInit) {
        throw new Error('collector недоступен');
      }

      sdk.sdkConfigs.push(config);
    }

    /** Запуск SDK. */
    start(): void {
      sdk.start();
    }

    /** Остановка SDK. */
    shutdown(): Promise<void> {
      return sdk.shutdown();
    }
  },
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    /**
     * @param config - конфигурация экспортёра
     */
    constructor(config: Record<string, unknown>) {
      sdk.exporterConfigs.push(config);
    }
  },
}));

/** Заглушка `ConfigService` с заданными значениями. */
function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

afterEach(() => {
  resetTracingAdapter();
  sdk.start.mockClear();
  sdk.shutdown.mockClear();
  sdk.sdkConfigs.length = 0;
  sdk.exporterConfigs.length = 0;
  sdk.failInit = false;
});

describe('OtelService: инициализация по OTEL_ENABLED (R7.7, KI-365)', () => {
  it('OTEL_ENABLED=false — SDK не стартует, адаптер остаётся no-op', () => {
    const service = new OtelService(configWith({ OTEL_ENABLED: false }));

    service.onModuleInit();

    expect(service.isEnabled).toBe(false);
    expect(sdk.start).not.toHaveBeenCalled();
    expect(getTracingAdapter()).toBeInstanceOf(NoopTracingAdapter);
  });

  it('OTEL_ENABLED=true — стартует SDK и ставит OTel-адаптер', () => {
    const service = new OtelService(configWith({ OTEL_ENABLED: true }));

    service.onModuleInit();

    expect(service.isEnabled).toBe(true);
    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(getTracingAdapter()).not.toBeInstanceOf(NoopTracingAdapter);
  });

  it('строит URL экспортёра из OTEL_EXPORTER_OTLP_ENDPOINT (с трейлинг-слэшем)', () => {
    const service = new OtelService(
      configWith({
        OTEL_ENABLED: true,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/',
        OTEL_SERVICE_NAME: 'workflow-builder-test',
      }),
    );

    service.onModuleInit();

    expect(sdk.exporterConfigs[0]?.url).toBe('http://collector:4318/v1/traces');
    expect(sdk.sdkConfigs[0]?.serviceName).toBe('workflow-builder-test');
  });

  it('без OTEL_EXPORTER_OTLP_ENDPOINT берёт локальный коллектор по умолчанию', () => {
    const service = new OtelService(configWith({ OTEL_ENABLED: true }));

    service.onModuleInit();

    expect(sdk.exporterConfigs[0]?.url).toBe('http://localhost:4318/v1/traces');
    expect(sdk.sdkConfigs[0]?.serviceName).toBe('workflow-builder');
  });

  it('ошибка инициализации не роняет приложение и выключает трассировку', () => {
    sdk.failInit = true;
    const service = new OtelService(configWith({ OTEL_ENABLED: true }));

    expect(() => service.onModuleInit()).not.toThrow();
    expect(service.isEnabled).toBe(false);
    expect(getTracingAdapter()).toBeInstanceOf(NoopTracingAdapter);
  });

  it('остановка вызывает NodeSDK.shutdown и сбрасывает адаптер', async () => {
    const service = new OtelService(configWith({ OTEL_ENABLED: true }));

    service.onModuleInit();
    await service.onApplicationShutdown();

    expect(sdk.shutdown).toHaveBeenCalledTimes(1);
    expect(service.isEnabled).toBe(false);
    expect(getTracingAdapter()).toBeInstanceOf(NoopTracingAdapter);
  });
});
