import { isNative } from './platform';

/**
 * Сообщение об отсутствии `VITE_API_BASE` в нативной сборке (KI-658).
 *
 * Вынесено константой: текст проверяется тестом и повторяется в документации
 * (`docs/development/v1.5/RUSTORE_SETUP.md`, раздел «Backend origin»).
 */
const MISSING_NATIVE_BASE_MESSAGE =
  '[api] VITE_API_BASE не задан в native-сборке — запросы уйдут в https://localhost';

/**
 * Флаг «об ошибке уже сообщили» (KI-658).
 *
 * `getApiBase` вызывается на каждый запрос, поэтому без флага один
 * незаданный `VITE_API_BASE` залил бы Logcat одинаковыми строками. Ошибка
 * остаётся видимой (fail-visible) — просто один раз за жизнь WebView.
 */
let missingNativeBaseReported = false;

/**
 * Нормализует базу API: обрезает пробелы и завершающие слэши.
 *
 * Пользователь может задать `https://api.example.com/` (со слэшем) — тогда
 * конкатенация с путём дала бы `//workflow`, и часть прокси/фреймворков
 * восприняла бы это как другой маршрут.
 *
 * @param value - сырое значение `VITE_API_BASE` (может быть `undefined`)
 * @returns база без завершающих слэшей; пустая строка — «не задана»
 */
export function normalizeApiBase(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Возвращает origin backend для текущей платформы (KI-658, v1.5.0 S5-B).
 *
 * **В браузере** — всегда пустая строка: запросы идут на текущий origin, а в
 * dev их проксирует Vite (`web/vite.config.ts`), поэтому CORS не участвует.
 *
 * **В нативном приложении** — `VITE_API_BASE` из сборки. WebView грузится с
 * `https://localhost` (Capacitor Android), и относительный `/workflow/...`
 * уходил бы в сам WebView, а не в backend: приложение не авторизовалось бы.
 * Значение инлайнится Vite на этапе сборки; это **не секрет** (виден в бандле
 * AAB), поэтому в CI лежит в repository variable `vars.VITE_API_BASE`.
 *
 * Если в native-сборке переменная не задана, функция пишет `console.error` и
 * возвращает пустую строку: приложение не падает на старте (fail-visible, а не
 * crash), но запросы уходят в `https://localhost` и кнопки не работают —
 * причина видна в Logcat.
 *
 * @returns база API без завершающего слэша либо пустая строка
 */
export function getApiBase(): string {
  if (!isNative()) {
    return '';
  }

  const base = normalizeApiBase(import.meta.env.VITE_API_BASE);

  if (base === '') {
    if (!missingNativeBaseReported) {
      missingNativeBaseReported = true;
      console.error(MISSING_NATIVE_BASE_MESSAGE);
    }

    return '';
  }

  return base;
}

/**
 * Склеивает базу API с относительным путём запроса (KI-658).
 *
 * Единая точка для `fetch`/`requestAsync`: все пути в `web/src/lib` начинаются
 * со `/` (`/workflow`, `/runs/...`), поэтому достаточно конкатенации. В
 * браузере база пустая и URL остаётся относительным — Vite-proxy и
 * same-origin продолжают работать без изменений.
 *
 * @param path - путь запроса, начинающийся со `/`
 * @returns абсолютный URL в native-сборке либо исходный путь в браузере
 */
export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

/**
 * Разрешает URL файла/медиа относительно backend (KI-658).
 *
 * В отличие от {@link apiUrl} на вход приходит ссылка, которая может быть уже
 * абсолютной: `storedUrl` из локального хранилища — это `/media/file/...`, а
 * presigned-ссылка S3 — готовый `https://...`. Абсолютные URL (включая
 * `blob:`/`data:`) возвращаются как есть, относительные получают базу API.
 *
 * @param url - абсолютная или относительная ссылка
 * @returns URL, пригодный для `fetch` и атрибутов `src`/`href` в WebView
 */
export function resolveApiUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return url;
  }

  return apiUrl(url);
}
