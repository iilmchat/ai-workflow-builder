import { Injectable, Logger, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  NoopTracingAdapter,
  setTracingAdapter,
  type TraceAttributeValue,
  type TraceAttributes,
  type TraceSpan,
  type TraceSpanOptions,
  type TracingAdapter,
} from './tracing.js';

/**
 * Имя сервиса в телеметрии (атрибут `service.name`), если не задано
 * `OTEL_SERVICE_NAME` (R7.7).
 */
const DEFAULT_SERVICE_NAME = 'workflow-builder';

/**
 * Базовый URL коллектора OTLP/HTTP по умолчанию: локальный Jaeger/OTel Collector
 * (`docker-compose.otel.yml`, DESIGN § 3.7.1).
 */
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

/**
 * Приводит внутренние атрибуты к виду OTel, отбрасывая `null`/`undefined`.
 *
 * @param attributes - атрибуты span'а
 * @returns объект атрибутов OTel (пустой, если передавать нечего)
 */
function toOtelAttributes(
  attributes: TraceAttributes | undefined,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Приводит ошибку к тексту для `span.recordException`/status.
 *
 * @param error - значение из `catch`
 * @returns текст ошибки
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Адаптер трассировки на реальном OpenTelemetry.
 *
 * Использует `startActiveSpan`, поэтому вложенные вызовы (`node.execute`
 * внутри `run.execute`) автоматически получают правильного родителя.
 * Ошибка операции помечается статусом `ERROR` и записывается в span, но
 * пробрасывается дальше — трассировка не влияет на поведение.
 */
class OtelTracingAdapter implements TracingAdapter {
  /** Трейсер сервиса: имя задаётся при инициализации SDK. */
  private readonly tracer = trace.getTracer('workflow-builder');

  /**
   * Выполняет операцию внутри активного span'а.
   *
   * @param name - имя span'а
   * @param options - атрибуты
   * @param fn - тело операции
   * @returns результат `fn`
   * @throws ошибку `fn` без изменений
   */
  async runAsync<T>(
    name: string,
    options: TraceSpanOptions,
    fn: (span: TraceSpan) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(
      name,
      { attributes: toOtelAttributes(options.attributes) },
      async (span: Span): Promise<T> => {
        try {
          return await fn(this.facade(span));
        } catch (error: unknown) {
          span.recordException(error instanceof Error ? error : errorMessage(error));
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage(error) });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  /**
   * Оборачивает OTel-span в упрощённый интерфейс.
   *
   * @param span - span OTel
   * @returns фасад для бизнес-кода
   */
  private facade(span: Span): TraceSpan {
    return {
      setAttribute: (key: string, value: TraceAttributeValue): void => {
        if (value !== null && value !== undefined) {
          span.setAttribute(key, value);
        }
      },
      recordException: (error: unknown): void => {
        span.recordException(error instanceof Error ? error : errorMessage(error));
      },
    };
  }
}

/**
 * Инициализация OpenTelemetry (R7.7, KI-365).
 *
 * SDK стартует **только** при `OTEL_ENABLED=true`: без коллектора экспорт
 * трейсов бессмысленен, а `NodeSDK.start()` подменяет глобальный провайдер
 * трассировки во всём процессе. Пока SDK не стартовал, бизнес-код пишет в
 * no-op адаптер и не платит за телеметрию.
 *
 * Экспорт — OTLP/HTTP на `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
 * (дефолт `http://localhost:4318`; локальный Jaeger — `docker-compose.otel.yml`).
 */
@Injectable()
export class OtelService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OtelService.name);

  /** SDK либо `null`, если трассировка выключена. */
  private sdk: NodeSDK | null = null;

  /**
   * @param config - доступ к env (RULES 4.6). `@Optional()` — сервис собирают
   *   и в тестах без `ConfigModule`; без конфига трассировка выключена
   */
  constructor(@Optional() private readonly config?: ConfigService) {}

  /**
   * Включена ли трассировка (для диагностики и тестов).
   *
   * @returns `true`, если SDK стартовал
   */
  get isEnabled(): boolean {
    return this.sdk !== null;
  }

  /**
   * Стартует SDK, если `OTEL_ENABLED=true`.
   *
   * Ошибка инициализации не роняет приложение: телеметрия — вспомогательная
   * подсистема, и без неё workflow-движок обязан работать (RULES 1.7 —
   * логируем, не гасим).
   */
  onModuleInit(): void {
    if (this.config?.get<boolean>('OTEL_ENABLED') !== true) {
      this.logger.log('OTEL_ENABLED=false — трассировка выключена');
      this.sdk = null;

      return;
    }

    const endpoint =
      this.config.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT') ??
      DEFAULT_OTLP_ENDPOINT;
    const serviceName =
      this.config.get<string>('OTEL_SERVICE_NAME') ?? DEFAULT_SERVICE_NAME;
    // OTLP/HTTP принимает трейсы по `/v1/traces`; трейлинг-слэш в env —
    // частая опечатка, из-за которой получался бы `//v1/traces`.
    const baseUrl = endpoint.replace(/\/+$/, '');

    try {
      const exporter = new OTLPTraceExporter({ url: `${baseUrl}/v1/traces` });

      this.sdk = new NodeSDK({ serviceName, traceExporter: exporter });
      this.sdk.start();
      setTracingAdapter(new OtelTracingAdapter());

      this.logger.log(
        `Трассировка включена: service=${serviceName}, endpoint=${baseUrl}/v1/traces`,
      );
    } catch (error: unknown) {
      this.sdk = null;
      setTracingAdapter(new NoopTracingAdapter());
      this.logger.error(
        `Не удалось запустить OpenTelemetry: ${errorMessage(error)} — трассировка выключена`,
      );
    }
  }

  /**
   * Останавливает SDK и возвращает no-op адаптер (RULES 4.12).
   *
   * Без `shutdown` процесс не завершается: экспортёр держит таймер отправки.
   */
  async onApplicationShutdown(): Promise<void> {
    setTracingAdapter(new NoopTracingAdapter());

    if (this.sdk === null) {
      return;
    }

    try {
      await this.sdk.shutdown();
    } catch (error: unknown) {
      this.logger.warn(
        `Остановка OpenTelemetry завершилась ошибкой: ${errorMessage(error)}`,
      );
    } finally {
      this.sdk = null;
    }
  }
}
