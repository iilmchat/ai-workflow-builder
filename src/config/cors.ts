import { z } from 'zod';

/**
 * Разбор CORS-allowlist'а из `CORS_ALLOWED_ORIGINS` (v1.6.0 S6-A).
 *
 * До S6-A `main.ts` включал `origin: true` во всех средах: Express отражал
 * `Origin` запроса, и CORS не ограничивал круг сайтов (KI-658 — так лечили
 * Capacitor WebView, но для прода это слишком широко). Теперь:
 * - `NODE_ENV === 'production'` → `origin` — массив из этого файла;
 * - прочие среды → прежнее `origin: true` (Vite-прокси и WebView).
 *
 * Модуль отдельный, а не код в `main.ts`, по двум причинам: `main.ts` с
 * `top-level await` неудобно импортировать в тесты, а правило разбора
 * (trim, срезание хвостового слэша, строгая проверка схемы) должно быть
 * покрыто unit-тестами (`RULES 1.17` — env на границе валидируется Zod).
 *
 * Схемы ограничены `http`/`https`/`capacitor`: `origin` с другой схемой
 * (`file://`, `chrome-extension://`) в allowlist — почти всегда опечатка, и
 * молча пропускать её нельзя.
 */
const CORS_ORIGIN_LIST_SCHEMA = z
  .array(z.url({ protocol: /^(https?|capacitor)$/ }))
  .max(32);

/**
 * Разбирает список origin'ов из env-строки.
 *
 * Пустые элементы (хвостовая запятая, пробелы) отбрасываются: оператор часто
 * копирует список с лишней запятой, и падать из-за этого на старте прода
 * не нужно. Если после фильтрации не осталось ни одного origin'а — возвращается
 * пустой массив; «список пуст в production» — отдельная проверка в
 * {@link resolveCorsOrigin}, потому что пустой allowlist в dev допустим.
 *
 * @param raw - сырое значение `CORS_ALLOWED_ORIGINS` (`undefined` → пустой список)
 * @returns нормализованные origin'ы без хвостового слэша, без дублей
 * @throws Error если элемент не является URL с допустимой схемой
 */
export function parseCorsAllowedOrigins(raw: string | undefined): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    return [];
  }

  const parsed = CORS_ORIGIN_LIST_SCHEMA.safeParse(entries);

  if (!parsed.success) {
    throw new Error(
      `CORS_ALLOWED_ORIGINS: ожидается список origin'ов через запятую ` +
        `(http/https/capacitor):\n${z.prettifyError(parsed.error)}`,
    );
  }

  // Дубль в allowlist'е не ломает CORS, но и смысла не имеет; dedupe делает
  // конфигурацию предсказуемой в логах и тестах.
  return [...new Set(parsed.data)];
}

/**
 * Выбирает значение опции `origin` для `app.enableCors()`.
 *
 * В production пустой/незаданный allowlist — **ошибка**, а не «разрешить всё»:
 * fail-fast при старте лучше, чем тихо открытый CORS на боевом API. В
 * остальных средах (`development`/`test`/`staging`/`preprod`) сохраняется
 * прежнее поведение `origin: true`, чтобы не ломать Vite-прокси, CDP-смоук и
 * Capacitor-сборку локально.
 *
 * @param nodeEnv - значение `NODE_ENV` (после Zod-валидации)
 * @param raw - сырое значение `CORS_ALLOWED_ORIGINS`
 * @returns `true` (отражать Origin) для не-prod или массив origin'ов для prod
 * @throws Error если `NODE_ENV=production`, а allowlist пуст или некорректен
 */
export function resolveCorsOrigin(
  nodeEnv: string | undefined,
  raw: string | undefined,
): true | string[] {
  if (nodeEnv !== 'production') {
    return true;
  }

  const origins = parseCorsAllowedOrigins(raw);

  if (origins.length === 0) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS обязателен при NODE_ENV=production: перечислите ' +
        "origin'ы через запятую (например " +
        'https://app.example.com,https://localhost,capacitor://localhost). ' +
        'Приложение не стартует, чтобы не открыть CORS всему интернету.',
    );
  }

  return origins;
}
