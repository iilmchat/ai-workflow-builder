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
    it('регистрирует ровно четыре контрактные метрики', async () => {
      const text = await service.getMetrics();

      expect(text).toContain('# HELP http_request_duration_seconds');
      expect(text).toContain('# TYPE http_request_duration_seconds histogram');
      expect(text).toContain('# HELP run_execution_duration_seconds');
      expect(text).toContain('# TYPE run_execution_duration_seconds histogram');
      expect(text).toContain('# HELP run_cost_total');
      expect(text).toContain('# TYPE run_cost_total counter');
      expect(text).toContain('# HELP agent_step_duration_seconds');
      expect(text).toContain('# TYPE agent_step_duration_seconds histogram');
      // Только четыре `HELP`-блока: реестр изолирован от глобального
      // `prom-client` и фоновых коллекторов.
      expect(
        text.split('\n').filter((line) => line.startsWith('# HELP ')),
      ).toHaveLength(4);
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
    it('пишет гистограмму с подписью model', async () => {
      service.observeAgentStep('gpt-4o-mini', 0.25);

      const text = await service.getMetrics();
      const countLine = findLine(text, 'agent_step_duration_seconds_count{');

      expect(labelKeys(countLine ?? '')).toEqual(['model']);
      expect(countLine).toContain('model="gpt-4o-mini"');
      expect(countLine).toContain('} 1');
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
