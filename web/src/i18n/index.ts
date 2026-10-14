import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './ru.json';
import en from './en.json';

/** Языки приложения (расширяемо: de, es — при необходимости). */
export const SUPPORTED_LANGUAGES = ['ru', 'en'] as const;
/** Язык интерфейса. */
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Ключ localStorage, в котором живёт выбор языка. */
const STORAGE_KEY = 'lang';

/**
 * Определяет стартовый язык:
 * 1) localStorage.lang (если валиден);
 * 2) navigator.language (языки на `ru` или `en`);
 * 3) 'ru' — дефолт.
 *
 * @returns код языка из {@link SUPPORTED_LANGUAGES}
 */
function detectInitialLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'ru';
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (stored === 'ru' || stored === 'en') {
    return stored;
  }

  const nav = window.navigator.language.toLowerCase();

  if (nav.startsWith('en')) {
    return 'en';
  }

  return 'ru';
}

// Ресурсы лежат в бандле, поэтому i18next инициализируется синхронно и
// i18n.t() доступен уже на этапе импорта других модулей (см. stores/workflow).
void i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: detectInitialLanguage(),
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = i18n.language;

/**
 * Меняет язык + сохраняет в localStorage + обновляет `<html lang>`.
 *
 * @param lang - целевой язык
 */
export function setLanguage(lang: Language): void {
  void i18n.changeLanguage(lang);
  window.localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
}

export default i18n;
