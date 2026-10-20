import i18n from 'i18next'
import type { BackendModule, ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import ru from './locales/ru.json'

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'uz'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * Russian is the default and the fallback, so it ships with the app; English
 * and Uzbek are fetched the first time they are needed (a switch in the
 * header, or a report printed in that language). Each is ~110 KB that a
 * Russian-speaking user never downloads.
 */
const LAZY: Record<string, () => Promise<{ default: ResourceKey }>> = {
  en: () => import('./locales/en.json'),
  uz: () => import('./locales/uz.json'),
}

const lazyLocales: BackendModule = {
  type: 'backend',
  init: () => {},
  read(language, _namespace, callback) {
    const load = LAZY[language]
    if (!load) {
      callback(null, {})
      return
    }
    load().then(
      (module) => callback(null, module.default),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
    )
  },
}

/** Resolves once the detected language is ready — main.tsx renders after it. */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ru: { translation: ru } },
    // Bundled ru must not stop the backend from loading en / uz.
    partialBundledLanguages: true,
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
    react: {
      // A language switch re-renders when the bundle has arrived instead of
      // suspending the whole page into its loading state.
      useSuspense: false,
    },
  })

export default i18n
