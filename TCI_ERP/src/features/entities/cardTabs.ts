/**
 * The company card's tabs, grouped (Prompt 30: «tabs reduced or grouped»).
 *
 * Nine tabs side by side read as nine equal things; they are not. They fall
 * into what we KNOW about the company (financials, rating), what we DO with
 * it (limits, policies, submissions), its claims, its group and — for sales —
 * its portal access. The top row names the sections; a section with more
 * than one tab shows them as a switch under it. The URL keeps naming the TAB
 * (`?tab=rating`), so every deep link (the Agenda's, the palette's) still
 * lands where it did.
 */

export type CardTab =
  | 'overview'
  | 'financials'
  | 'rating'
  | 'sanctions'
  | 'limits'
  | 'policies'
  | 'requests'
  | 'claims'
  | 'group'
  | 'access'

export type CardSection = 'overview' | 'analysis' | 'cover' | 'claims' | 'group' | 'access'

/** Every tab's section, in the order the sections are shown. */
export const SECTION_OF: Readonly<Record<CardTab, CardSection>> = {
  overview: 'overview',
  financials: 'analysis',
  rating: 'analysis',
  // 0091: what we know about the company — screened with its owners
  sanctions: 'analysis',
  limits: 'cover',
  policies: 'cover',
  requests: 'cover',
  claims: 'claims',
  group: 'group',
  access: 'access',
}

const SECTION_ORDER: readonly CardSection[] = ['overview', 'analysis', 'cover', 'claims', 'group', 'access']

/** The sections that have at least one available tab, each with its tabs in
 * the order given. */
export function sectionsFor(available: readonly CardTab[]): { section: CardSection; tabs: CardTab[] }[] {
  return SECTION_ORDER.map((section) => ({
    section,
    tabs: available.filter((tab) => SECTION_OF[tab] === section),
  })).filter((s) => s.tabs.length > 0)
}

/** The tab a section opens on: the first it has. */
export function firstTabOf(section: CardSection, available: readonly CardTab[]): CardTab | null {
  return available.find((tab) => SECTION_OF[tab] === section) ?? null
}
