import { Test } from '@nestjs/testing';
import { MetricsService } from './metrics.service.js';

/** Ожидаемый `Content-Type` экспозиции Prometheus 0.0.4. */
const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * Возвращает первую строку экспозиции, которая начинается с `prefix`.
 *
 * @param text - текст экспозиции Prometheus
 * @param prefix - начало строки (`run_cost_total{`)
 * @returns найденная строка либо `undefined`
 */
function findLine(text: string, prefix: string): string | undefined {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

/**
 * Извлекает имена подписей из строки метрики вида `name{k="v",...} value`.
 *
 * @param line - строка экспозиции
 * @returns имена подписей в порядке вывода (`[]`, если подписей нет)
 */
function labelKeys(line: string): string[] {
  const match = line.match(/\{([^}]*)\}/);

  if (match === null) {
    return [];
  }

  return match[1]
    .split(',')
    .map((pair) => pair.split('=')[0])
    .filter((key) => key.length > 0);
}

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = moduleRef.get(MetricsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('реестр и contentType', () => {
    it('регистрирует доменные метрики и process-метрики по умолчанию', async () => {
      const text = await service.getMetrics();

      // Доменные метрики — контракт с дашбордом (v1.1.0 S4 добавил llm_call).
      for (const [name, type] of [
        ['http_request_duration_seconds', 'histogram'],
        ['run_execution_duration_seconds', 'histogram'],
        ['run_cost_total', 'counter'],
        ['agent_step_duration_seconds', 'histogram'],
        ['llm_call_duration_seconds', 'histogram'],
      ] as const) {
        expect(text).toContain(`# HELP ${name}`);
        expect(text).toContain(`# TYPE ${name} ${type}`);
      }

      // KI-581: process/runtime-метрики (CPU, RSS, heap, event loop) — с
      // префиксами process_/nodejs_, не конфликтующими с доменными.
      expect(text).toContain('# HELP process_cpu_user_seconds_total');
      expect(text).toContain('# HELP process_resident_memory_bytes');
      expect(text).toContain('# HELP nodejs_eventloop_lag_seconds');
      expect(text).toContain('# HELP nodejs_heap_size_used_bytes');

      // Ни один HELP не зарегистрирован дважды: конфликт имён дал бы ошибку
      // регистрации, но проверяем и вывод (защита от дублей семейств).
      const families = text
        .split('\n')
        .filter((line) => line.startsWith('# HELP '))
        .map((line) => line.slice('# HELP '.length).split(' ')[0]);

      expect(new Set(families).size).toBe(families.length);
    });

    it('contentType — прометеевский text/plain 0.0.4', () => {
      expect(service.contentType).toBe(CONTENT_TYPE);
    });

    it('каждый инстанс сервиса имеет независимый реестр', async () => {
      const other = new MetricsService();

      service.observeHttpRequest('GET', '/only-in-first', 200, 0.01);

      expect(await service.getMetrics()).toContain('route="/only-in-first"');
      // Второй инстанс не видит серию первого: реестры не общие.
      expect(await other.getMetrics()).not.toContain('route="/only-in-first"');
    });
  });

  describe('observeHttpRequest', () => {
    it('пишет гистограмму с подписями method/route/status', async () => {
      service.observeHttpRequest('GET', '/workflow/:id', 200, 0.042);

      const text = await service.getMetrics();
      const countLine = findLine(
        text,
        'http_request_duration_seconds_count{',
      );

      expect(countLine).toBeDefined();
      expect(labelKeys(countLine ?? '')).toEqual(['method', 'route', 'status']);
      expect(countLine).toContain('method="GET"');
      expect(countLine).toContain('route="/workflow/:id"');
      expect(countLine).toContain('status="200"');
      expect(countLine).toContain('} 1');
      expect(
        findLine(text, 'http_request_duration_seconds_sum{'),
      ).toContain('} 0.042');
      // Ведра настраиваемые: быстрый запрос попадает в первые, а не в +Inf.
      expect(text).toContain('le="0.005"');
      expect(text).toContain('le="+Inf"');
    });

    it('различает статусы/методы/маршруты как отдельные серии', async () => {
      service.observeHttpRequest('GET', '/runs', 200, 0.01);
      service.observeHttpRequest('POST', '/runs', 500, 0.5);

      const text = await service.getMetrics();

      expect(text).toContain(
        'http_request_duration_seconds_count{method="GET",route="/runs",status="200"} 1',
      );
      expect(text).toContain(
        'http_request_duration_seconds_count{method="POST",route="/runs",status="500"} 1',
      );
    });
  });

  describe('observeNodeExecution', () => {
    it('пишет гистограмму с подписями node_type/status', async () => {
      service.observeNodeExecution('llm', 'completed', 1.5);
      service.observeNodeExecution('llm', 'failed', 0.05);

      const text = await service.getMetrics();

      expect(text).toContain(
        'run_execution_duration_seconds_count{node_type="llm",status="completed"} 1',
      );
      expect(text).toContain(
        'run_execution_duration_seconds_count{node_type="llm",status="failed"} 1',
      );
      expect(
        findLine(text, 'run_execution_duration_seconds_sum{node_type="llm",status="completed"}'),
      ).toContain('} 1.5');
      expect(
        labelKeys(
          findLine(text, 'run_execution_duration_seconds_count{') ?? '',
        ),
      ).toEqual(['node_type', 'status']);
    });
  });

  describe('observeAgentStep', () => {
    it('пишет гистограмму с подписями model/status (KI-576)', async () => {
      service.observeAgentStep('gpt-4o-mini', 'success', 0.25);
      service.observeAgentStep('gpt-4o-mini', 'error', 0.5);

      const text = await service.getMetrics();

      expect(text).toContain(
        'agent_step_duration_seconds_count{model="gpt-4o-mini",status="success"} 1',
      );
      expect(text).toContain(
        'agent_step_duration_seconds_count{model="gpt-4o-mini",status="error"} 1',
      );
      expect(
        labelKeys(findLine(text, 'agent_step_duration_seconds_count{') ?? ''),
      ).toEqual(['model', 'status']);
      // Ошибка и успех — разные серии: длительность падений не смешивается
      // с нормальными шагами.
      expect(
        findLine(
          text,
          'agent_step_duration_seconds_sum{model="gpt-4o-mini",status="error"}',
        ),
      ).toContain('} 0.5');
    });
  });

  describe('observeLlmCall', () => {
    it('пишет отдельную гистограмму llm_call с model/status (KI-577)', async () => {
      service.observeLlmCall('claude-test', 'success', 1.25);
      service.observeLlmCall('claude-test', 'error', 0.1);

      const text = await service.getMetrics();

      expect(text).toContain(
        'llm_call_duration_seconds_count{model="claude-test",status="success"} 1',
      );
      expect(text).toContain(
        'llm_call_duration_seconds_count{model="claude-test",status="error"} 1',
      );
      expect(
        labelKeys(findLine(text, 'llm_call_duration_seconds_count{') ?? ''),
      ).toEqual(['model', 'status']);
      expect(
        findLine(
          text,
          'llm_call_duration_seconds_sum{model="claude-test",status="success"}',
        ),
      ).toContain('} 1.25');
      // Это отдельная метрика, а не серия agent_step_*.
      expect(
        findLine(
          text,
          'agent_step_duration_seconds_count{model="claude-test"',
        ),
      ).toBeUndefined();
    });
  });

  describe('observeCost', () => {
    it('инкрементит счётчик по валютам (USD и RUB не смешиваются)', async () => {
      service.observeCost(1.5, 2.5);
      service.observeCost(0.5, 0.25);

      const text = await service.getMetrics();

      expect(text).toContain('run_cost_total{currency="USD"} 2');
      expect(text).toContain('run_cost_total{currency="RUB"} 2.75');
      expect(labelKeys(findLine(text, 'run_cost_total{') ?? '')).toEqual([
        'currency',
      ]);
    });

    it('игнорирует null/undefined/0/отрицательные/NaN/Infinity', async () => {
      service.observeCost(null, undefined);
      service.observeCost(0, 0);
      service.observeCost(-1, -2);
      service.observeCost(Number.NaN, Number.POSITIVE_INFINITY);

      const text = await service.getMetrics();

      // Счётчик монотонно растёт: мусорные значения не создают серию вовсе.
      expect(text).not.toContain('run_cost_total{currency=');
    });
  });
});
