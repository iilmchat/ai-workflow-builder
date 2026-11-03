import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

/**
 * Ведра гистограммы HTTP-запросов (секунды).
 *
 * Набор покрывает быстрые API-вызовы (5 мс) и тяжёлые (10 с): экспорт графа,
 * загрузка шаблонов. Последнее ведро — потолок «нормальных» запросов;
 * всё медленнее попадает в `+Inf` автоматически.
 */
const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * Ведра гистограммы выполнения узла workflow (секунды).
 *
 * Узлы бывают быстрые (`text`, `transform`) и долгие (`llm`, `media` до
 * нескольких минут), поэтому верхняя граница — 300 с.
 */
const NODE_DURATION_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];

/**
 * Ведра гистограммы шага agent-цикла (секунды).
 *
 * Шаг — один вызов LLM/инструмента в цикле агента: от десятков миллисекунд до
 * десятков секунд.
 */
const AGENT_STEP_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

/**
 * Сервис метрик Prometheus (v1.0.0 S4, DESIGN V100 § 3.3).
 *
 * Держит **собственный** `Registry` вместо глобального `register`
 * `prom-client`: тесты создают несколько инстансов сервиса, и общий реестр
 * приводил бы к «Already registered metric» между ними. Изоляция реестра
 * также не даёт фоновым коллекторам библиотеки (если их включат позже)
 * появиться в ответе `GET /metrics` неожиданно.
 *
 * Метрики и их подписи — контракт с Prometheus и дашбордами, поэтому имена и
 * label'ы зафиксированы:
 * - `http_request_duration_seconds{method,route,status}` — гистограмма
 *   длительности HTTP-запросов (пишет глобальный `MetricsInterceptor`);
 * - `run_execution_duration_seconds{node_type,status}` — длительность
 *   выполнения узла workflow;
 * - `run_cost_total{currency}` — суммарная стоимость запусков в валюте
 *   (`USD`/`RUB`; RULES 4.23 — валюты не смешиваются);
 * - `agent_step_duration_seconds{model}` — длительность шага agent-цикла.
 *
 * Сервис — единственная точка записи: потребители (интерсептор, executor'ы
 * engine/agent) не знают про `prom-client` и не могут создать метрику с
 * другим набором подписей.
 */
@Injectable()
export class MetricsService {
  /** Изолированный реестр сервиса (не глобальный `prom-client`). */
  private readonly registry = new Registry();

  /** Гистограмма длительности HTTP-запросов. */
  private readonly httpRequestDuration: Histogram<
    'method' | 'route' | 'status'
  >;

  /** Гистограмма длительности выполнения узлов workflow. */
  private readonly runExecutionDuration: Histogram<'node_type' | 'status'>;

  /** Счётчик стоимости запусков по валютам. */
  private readonly runCostTotal: Counter<'currency'>;

  /** Гистограмма длительности шагов agent-цикла. */
  private readonly agentStepDuration: Histogram<'model'>;

  constructor() {
    this.httpRequestDuration = new Histogram<'method' | 'route' | 'status'>({
      name: 'http_request_duration_seconds',
      help: 'Длительность HTTP-запросов API в секундах',
      labelNames: ['method', 'route', 'status'],
      buckets: HTTP_DURATION_BUCKETS,
      registers: [this.registry],
    });

    this.runExecutionDuration = new Histogram<'node_type' | 'status'>({
      name: 'run_execution_duration_seconds',
      help: 'Длительность выполнения узла workflow в секундах',
      labelNames: ['node_type', 'status'],
      buckets: NODE_DURATION_BUCKETS,
      registers: [this.registry],
    });

    this.runCostTotal = new Counter<'currency'>({
      name: 'run_cost_total',
      help: 'Суммарная стоимость выполненных запусков по валютам',
      labelNames: ['currency'],
      registers: [this.registry],
    });

    this.agentStepDuration = new Histogram<'model'>({
      name: 'agent_step_duration_seconds',
      help: 'Длительность шага agent-цикла в секундах',
      labelNames: ['model'],
      buckets: AGENT_STEP_BUCKETS,
      registers: [this.registry],
    });
  }

  /**
   * Записывает длительность HTTP-запроса.
   *
   * `route` — ограниченный шаблон маршрута (`/workflow/:id`), а не фактический
   * URL: иначе значение uuid в подписи порождало бы новую серию на каждый
   * запрос (кардинальность). `status` — числовой код как строка: так его
   * группируют дашборды и алерты Prometheus.
   *
   * @param method - HTTP-метод (`GET`, `POST`, …) — уже в верхнем регистре
   * @param route - шаблон маршрута с ограниченной кардинальностью
   * @param statusCode - HTTP-статус ответа (включая ошибки)
   * @param durationSeconds - длительность обработки запроса в секундах
   */
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.httpRequestDuration.observe(
      { method, route, status: String(statusCode) },
      durationSeconds,
    );
  }

  /**
   * Записывает длительность выполнения узла workflow.
   *
   * @param nodeType - тип узла (`llm`, `media`, `text`, …)
   * @param status - итоговый статус узла: завершён или упал
   * @param durationSeconds - длительность выполнения узла в секундах
   */
  observeNodeExecution(
    nodeType: string,
    status: 'completed' | 'failed',
    durationSeconds: number,
  ): void {
    this.runExecutionDuration.observe(
      { node_type: nodeType, status },
      durationSeconds,
    );
  }

  /**
   * Увеличивает счётчик стоимости запуска по валютам.
   *
   * Стоимость приходит из `node_runs` (`cost_usd`/`cost_rub`) и может быть
   * `null`/`undefined` (провайдер не отдал тарификацию) или нулевой. Нули,
   * отрицательные значения и `NaN` игнорируются: счётчик монотонно растёт и не
   * должен получать мусор. USD и RUB — разные подписи одной метрики: валюты
   * не смешиваются (RULES 4.23).
   *
   * @param costUsd - стоимость в USD (может отсутствовать)
   * @param costRub - стоимость в RUB (может отсутствовать)
   */
  observeCost(
    costUsd: number | null | undefined,
    costRub: number | null | undefined,
  ): void {
    if (
      costUsd !== null &&
      costUsd !== undefined &&
      Number.isFinite(costUsd) &&
      costUsd > 0
    ) {
      this.runCostTotal.inc({ currency: 'USD' }, costUsd);
    }

    if (
      costRub !== null &&
      costRub !== undefined &&
      Number.isFinite(costRub) &&
      costRub > 0
    ) {
      this.runCostTotal.inc({ currency: 'RUB' }, costRub);
    }
  }

  /**
   * Записывает длительность шага agent-цикла.
   *
   * @param model - идентификатор модели, которой выполнялся шаг
   * @param durationSeconds - длительность шага в секундах
   */
  observeAgentStep(model: string, durationSeconds: number): void {
    this.agentStepDuration.observe({ model }, durationSeconds);
  }

  /**
   * Отдаёт все метрики реестра в текстовом формате Prometheus.
   *
   * @returns экспозиция метрик (`# HELP`/`# TYPE` + серии) для `GET /metrics`
   */
  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * `Content-Type` экспозиции (формат Prometheus 0.0.4 для этого реестра).
   *
   * @returns MIME-тип с версией формата и кодировкой для заголовка ответа
   */
  get contentType(): string {
    return this.registry.contentType;
  }
}
