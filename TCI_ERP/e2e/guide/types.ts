/**
 * The format of a user-guide screenshot (docs/guide/README.md).
 * Each shot is defined once, language-independent, in e2e/guide/shots/<section>.ts
 * and taken by e2e/guide/shots.spec.ts in every language — against the stubbed
 * backend with the network sealed (e2e/support), never against a real project.
 */
import type { Locator, Page } from '@playwright/test'

import type { DemoRole } from '../layout/screens'

export type Lang = 'ru' | 'en' | 'uz'
export const LANGS: readonly Lang[] = ['ru', 'en', 'uz']

/** What `setup` and mark `target`s receive. */
export interface ShotContext {
  page: Page
  /** Label of a locale key in the current language (src/i18n/locales/<lang>.json). Throws on a missing key. */
  t: (key: string, vars?: Record<string, string | number>) => string
  lang: Lang
}

/**
 * Annotation drawn on the screenshot; `n` = the step number in the text.
 * - circle: a numbered circle beside the target
 * - box: a frame around the target plus its number
 * - arrow: an arrow pointing at the target, its number at the tail
 */
export type MarkKind = 'circle' | 'box' | 'arrow'
export interface ShotMark {
  n: number
  target: (ctx: ShotContext) => Locator | Promise<Locator>
  kind?: MarkKind // default 'box'
  /** Arrow direction (where the arrow comes from); default 'left'. */
  from?: 'left' | 'right' | 'top' | 'bottom'
}

export type ShotRect = { x: number; y: number; width: number; height: number }

export interface ShotSpec {
  /** Unique kebab-case id, referenced as {{shot:<id>}} in the Markdown. */
  id: string
  /** The department role to act in (src/lib/roles.ts); null = signed out (the sign-in page). */
  role: string | null
  /** The recorded demo book to replay (e2e/layout/fixtures/<fixture>.json), every
   * company name replaced by a «DEMO …» one (e2e/guide/demo.ts). None: empty lists. */
  fixture?: DemoRole
  /** Route to open. */
  path: string
  /** Clicks / typing to reach the state to show. */
  setup?: (ctx: ShotContext) => Promise<void>
  /** CSS selector (first match), a page rectangle, or 'page' (the viewport). Default 'page'. */
  crop?: string | ShotRect | 'page'
  /** Extra space around a selector crop, in CSS px (default 12). */
  padding?: number
  marks?: ShotMark[]
  /** Alternative text per language. */
  alt: Record<Lang, string>
  /** Viewport override (default 1440×900). */
  viewport?: { width: number; height: number }
}
