import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import ru from './locales/ru.json'
import uz from './locales/uz.json'

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'uz'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      uz: { translation: uz },
    },
    // Default language is Russian; only an explicit user choice (localStorage) overrides it.
    fallbackLng: 'ru',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'tci-erp-lang',
    },
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
