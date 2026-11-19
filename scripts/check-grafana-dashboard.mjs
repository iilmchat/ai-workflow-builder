/**
 * Гейт дашборда Grafana (KI-610).
 *
 * Проверяет, что каждый PromQL-выражение панели ссылается на метрику, которая
 * реально регистрируется в `MetricsService`. Переименование метрики без
 * правки дашборда иначе даёт тихую панель «No data».
 */
import fs from 'node:fs';

const dashboardPath = 'infra/grafana/dashboard.json';
const metricsPath = 'src/metrics/metrics.service.ts';

const dashboard = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));
const metricsSource = fs.readFileSync(metricsPath, 'utf8');

/** Имена зарегистрированных метрик. */
const metricNames = new Set(
  [...metricsSource.matchAll(/name:\s*'([a-z][a-z0-9_]+)'/g)].map((m) => m[1]),
);

/** Выражения всех панелей. */
const expressions = [];
for (const panel of dashboard.panels ?? []) {
  for (const target of panel.targets ?? []) {
    if (typeof target.expr === 'string' && target.expr.trim().length > 0) {
      expressions.push({ panel: panel.title ?? '(без названия)', expr: target.expr });
    }
  }
}

const problems = [];

if (metricNames.size === 0) {
  problems.push('не найдено ни одной зарегистрированной метрики в MetricsService');
}

for (const { panel, expr } of expressions) {
  const used = [...metricNames].filter((name) => expr.includes(name));
  if (used.length === 0) {
    problems.push(`панель «${panel}»: выражение ссылается на неизвестную метрику — ${expr}`);
  }
}

if (problems.length > 0) {
  console.error(`Grafana dashboard: расхождения (KI-610):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

console.log(`Grafana OK: ${expressions.length} выражений, ${metricNames.size} метрик`);
