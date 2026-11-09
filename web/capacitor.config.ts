import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Конфиг нативной обёртки Capacitor 7 (v1.5.0 S1, DESIGN V150 § 3.2).
 *
 * `webDir: 'dist'` — путь относительно `web/`: `cap sync` копирует туда
 * результат `vite build` с `base: './'` (см. `vite.config.ts`), потому что
 * WebView грузит файлы через `file://`/`https://localhost`, а не с корня
 * веб-сервера.
 *
 * `androidScheme: 'https'` — WebView отдаёт приложение с
 * `https://localhost`, а не с `file://`: иначе не работают Secure Context
 * (cookie, `crypto.subtle`, service worker). `cleartext: false` и
 * `allowMixedContent: false` запрещают http-контент — backend обязан быть по
 * HTTPS (в dev — через `cap run android --livereload`).
 */
const config: CapacitorConfig = {
  appId: 'com.iilmchat.workflowbuilder',
  appName: 'AI Workflow Builder',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
