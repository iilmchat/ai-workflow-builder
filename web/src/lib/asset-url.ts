/**
 * Абсолютный URL к статике с учётом Vite `base` (web: '/', Capacitor: './').
 *
 * Vite переписывает только ассеты, импортированные из JS/HTML; пути-строки в
 * JSX остаются как есть. При `base: './'` (сборка Capacitor) `src="/logo.svg"`
 * указывает в корень `https://localhost`, а не в каталог `index.html` (KI-647).
 *
 * @param path - путь к файлу из `public/` (со слэшем или без)
 * @returns путь с префиксом `import.meta.env.BASE_URL`
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.startsWith('/') ? path.slice(1) : path;

  return `${base}${clean}`;
}
