/// <reference types="vite/client" />

/**
 * Типизация переменных окружения web-сборки (v1.5.0 S4-B).
 *
 * `vite/client` объявляет `ImportMetaEnv` с индексной сигнатурой `any`, из-за
 * чего обращение к `import.meta.env.VITE_RUSTORE_PROJECT_ID` не проверялось бы
 * (RULES 1.16 — `any` запрещён). Здесь перечислены только те `VITE_*`,
 * которые реально читает приложение; остальные остаются нетипизированными и
 * в коде не используются.
 */
interface ImportMetaEnv {
  /**
   * Project ID приложения из RuStore Console (v1.5.0 S4-B).
   *
   * Не секрет: `VITE_*` инлайнятся в JS-бандл при сборке. Не задано/пусто =
   * push в нативном приложении выключены (см. `@/lib/rustore-push`).
   */
  readonly VITE_RUSTORE_PROJECT_ID?: string;
}
