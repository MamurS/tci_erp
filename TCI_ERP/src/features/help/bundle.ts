import { useQuery } from '@tanstack/react-query'
import type { HelpBundle, HelpLang } from './types'

// One chunk per language, fetched when Help opens: the guide never weighs on
// the screens people work in.
const LOADERS: Record<HelpLang, () => Promise<{ default: unknown }>> = {
  ru: () => import('./content/ru.json'),
  en: () => import('./content/en.json'),
  uz: () => import('./content/uz.json'),
}

export function helpLang(lng: string | undefined): HelpLang {
  const l = (lng ?? 'ru').slice(0, 2)
  return l === 'en' || l === 'uz' ? l : 'ru'
}

export function useHelpBundle(lang: HelpLang) {
  return useQuery({
    queryKey: ['help-bundle', lang],
    queryFn: async () => (await LOADERS[lang]()).default as HelpBundle,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/** Quick-start PDFs built by `npm run guide:pdf` (docs/guide/pdf, copied into the site at build). */
export const quickStartPdfUrl = (lang: HelpLang, role: string) => `/guide/pdf/${lang}/quick-start-${role}.pdf`
