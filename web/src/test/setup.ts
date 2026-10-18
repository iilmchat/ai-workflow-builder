import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Общая настройка jsdom-тестов (KI-155).
 *
 * 1. `@testing-library/jest-dom/vitest` добавляет матчеры (`toBeInTheDocument`,
 *    `toHaveClass`, …) к `expect` Vitest.
 * 2. `cleanup` размонтирует деревья между тестами: без него второй `render`
 *    видел бы разметку первого (у `@testing-library/react` автоочистка
 *    включается только при `globals: true`, а он в конфиге не включён).
 * 3. Язык фиксируется до импорта `@/i18n`: jsdom отдаёт
 *    `navigator.language === 'en-US'`, и `detectInitialLanguage()` выбрал бы
 *    английский — тесты, проверяющие русские подписи, стали бы хрупкими.
 */
window.localStorage.setItem('lang', 'ru');

afterEach(() => {
  cleanup();
});
