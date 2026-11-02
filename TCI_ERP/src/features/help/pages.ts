/**
 * Which guide topics help with the page that is open (the «?» in the top bar,
 * F1, the «?» beside a page title), and who may read a topic. Pure: the map
 * is compiled from the topics' `pages` front matter (scripts/guide).
 */
import { matchPath } from 'react-router-dom'
import pageMap from './content/pages.json'
import type { HelpPageMap } from './types'

const PAGES = pageMap as HelpPageMap

/** Patterns with more fixed segments first: /policies/new wins over /policies/:id. */
function score(p: string) {
  return p.split('/').reduce((s, seg) => s + (seg.startsWith(':') ? 1 : seg ? 3 : 0), 0)
}

/** Where the Help centre lives for this reader: the portal has its own. */
export function helpBase(portal: boolean): string {
  return portal ? '/portal/help' : '/help'
}

/** True when the reader acting in `role` may read a topic with these roles:
 * staff read the whole guide (their own role's topics come first), a client
 * only what names `client` — the portal shows nothing of the staff side.
 * Mirrors visibleTo in scripts/guide/content.ts. */
export function helpVisibleTo(topicRoles: readonly string[], role: string | null): boolean {
  return role === 'client' ? topicRoles.includes('client') : true
}

/** The route pattern of a path that has guide topics, if any. */
export function helpPatternFor(pathname: string, pages: HelpPageMap = PAGES): string | null {
  const patterns = Object.keys(pages).sort((a, b) => score(b) - score(a))
  return patterns.find((p) => matchPath({ path: p, end: true }, pathname)) ?? null
}

/**
 * Topics for a path that the reader may read: those written for the reader's
 * own (acting) role first, then the ones for every staff role, then the rest.
 */
export function helpTopicsFor(pathname: string, role: string | null, pages: HelpPageMap = PAGES): string[] {
  const p = helpPatternFor(pathname, pages)
  if (!p) return []
  const list = pages[p].filter((t) => helpVisibleTo(t.roles, role))
  const mine = list.filter((t) => role !== null && t.roles.includes(role))
  const shared = list.filter((t) => !mine.includes(t) && t.roles.includes('all'))
  const rest = list.filter((t) => !mine.includes(t) && !shared.includes(t))
  return [...mine, ...shared, ...rest].map((t) => t.id)
}

/** A link inside the guide: /help/… is rewritten into the reader's Help centre. */
export function helpHref(href: string, base: string): string {
  return href.startsWith('/help/') || href === '/help' ? `${base}${href.slice(5)}` : href
}

/** The Help link for the page at `pathname`: its best topic (the page in
 * ?from=), else the Help home. */
export function helpHrefFor(pathname: string, role: string | null, pages: HelpPageMap = PAGES): string {
  const portal = role === 'client'
  const [first] = helpTopicsFor(pathname, role, pages)
  return first ? `${helpBase(portal)}/${first}?from=${encodeURIComponent(pathname)}` : helpBase(portal)
}
