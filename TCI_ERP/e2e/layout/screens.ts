/**
 * Which screens the layout guard covers, enumerated from the router.
 *
 * Every route in src/App.tsx is listed here, either with the demo user who
 * records and replays it (tools/layout-fixtures/record.mjs / layout.spec.ts), or with the reason
 * it has no table or list to guard. `screens.spec.ts`… no: the guard itself
 * fails when App.tsx gains a route this file does not mention, so a new
 * screen cannot slip past it.
 */

import { readFileSync } from 'node:fs'

/** The demo users on the canonical project (demo.<role>@demo.invalid). */
export type DemoRole = 'commercial' | 'credit' | 'claims' | 'sales' | 'info' | 'client'

export const DEMO_ROLES: readonly DemoRole[] = ['commercial', 'credit', 'claims', 'sales', 'info', 'client']

export interface RouteEntry {
  /** Who opens it: the fixtures are recorded with this user's rights. */
  role?: DemoRole
  /** Why there is nothing to guard on it (no role then). */
  skip?: string
}

const FORM = 'a form: no table or list, nothing in rows to interact with'
const REDIRECT = 'a redirect to another route, which is covered under its own path'
const CONCURRENT =
  'contract drafts, added in the same round by another workstream: record them (tools/layout-fixtures/record.mjs) and give them a role once they land'

const OFFERS_PENDING =
  'PENDING (Prompt 26): the demo book holds no published commercial offer to record — record it with the client demo user (tools/layout-fixtures/record.mjs) once one is published, and give it role client. Its table uses declared columns (labelCol offerStatus)'

export const ROUTES: Record<string, RouteEntry> = {
  '/login': { skip: 'sign-in page: no session, no table' },
  '/entities/:id/report': { skip: 'the printable risk report: a document without row actions (its online face is the company Overview tab, covered)' },
  '/buyers/:id/report': { skip: REDIRECT },
  '/mfa/verify': { skip: FORM },
  '/portal': { role: 'client' },
  '/portal/limits': { role: 'client' },
  '/portal/declarations': { role: 'client' },
  '/portal/premium': { role: 'client' },
  '/portal/overdues': { role: 'client' },
  '/portal/claims': { role: 'client' },
  '/portal/submissions': { role: 'client' },
  '/portal/account': { role: 'client' },
  '/change-password': { skip: FORM },
  '/no-access': { skip: 'a notice page' },
  '/buyers': { skip: REDIRECT },
  '/buyers/*': { skip: REDIRECT },
  '/policyholders': { skip: REDIRECT },
  '/policyholders/*': { skip: REDIRECT },
  '/account': { role: 'commercial' },
  '/': { role: 'commercial' },
  '/agenda': { role: 'credit' },
  '/entities': { role: 'commercial' },
  '/entities/:id': { role: 'credit' },
  '/entities/:id/statements/new': { skip: FORM },
  '/entities/:id/statements/:statementId/edit': { skip: FORM },
  '/requests': { role: 'sales' },
  '/requests/:id': { role: 'sales' },
  '/limits': { role: 'credit' },
  '/limits/:id': { role: 'credit' },
  '/policies': { role: 'commercial' },
  '/policies/new': { skip: FORM },
  '/policies/:id': { role: 'commercial' },
  '/policies/:id/edit': { skip: FORM },
  '/declarations': { role: 'commercial' },
  '/declarations/:id': { role: 'commercial' },
  '/overdues': { role: 'commercial' },
  '/overdues/:id': { role: 'commercial' },
  '/claims': { role: 'claims' },
  '/claims/:id': { role: 'claims' },
  '/contracts': { skip: REDIRECT },
  '/wording': { skip: REDIRECT },
  '/portfolio/policies': { skip: REDIRECT },
  '/portfolio/credit': { skip: REDIRECT },
  '/data': { role: 'info' },
  '/data/requests/:id': {
    skip: 'the demo book holds no data request to record (re-record once one exists and give it role info); the page is a request form with its own facts, no register',
  },
  '/brochure': { skip: REDIRECT },
  '/admin': {
    skip: 'admin only, and an admin session needs a second factor that a headless sign-in cannot pass — no demo admin to record; its tables use the same fixed columns and are held by the static contract',
  },
  '/requests/offers/:offerId/print': { skip: 'the printable commercial offer: the document frame alone, no table (its versions table lives on the submission page, covered under /requests/:id)' },
  '/requests/offers/:offerId/edit': {
    skip: 'PENDING (Prompt 27): the commercial offer screen — a parameter form beside the sandboxed document frame, no table or list; the demo book holds no offer to record a fixture from. e2e/offers/offer.spec.ts drives it on stubbed rows meanwhile',
  },
  '/portal/offers': { skip: OFFERS_PENDING },
  '/portal/offers/:offerId': { skip: 'the client\'s view of one offer: a document with two answer buttons, no table' },
  '/portal/offers/:offerId/print': { skip: 'the printable commercial offer (portal face): a document without row actions' },
  '/portal/contracts': { skip: CONCURRENT },
  '/policies/contracts/:draftId': { skip: CONCURRENT },
  '/policies/contracts/:draftId/print': { skip: CONCURRENT },
  '/policies/contracts/:draftId/edit': { skip: CONCURRENT },
  '/policies/contracts/:draftId/compare': { skip: CONCURRENT },
  '*': { skip: 'not-found page' },
}

/**
 * Screen variants the guard leaves out for now, with the reason. A variant is
 * a recorded path (`/policies/<id>?tab=premium`) matched by substring.
 */
export const PENDING_VARIANTS: Record<string, string> = {
  '/portal/premium': 'premium screens being rebuilt in the same round (Prompt 23) — remove this line when they land',
  'tab=premium': 'premium screens being rebuilt in the same round (Prompt 23) — remove this line when they land',
  'view=auto':
    'PENDING (0061): «Авторешения» — the demo book holds no auto decision (auto decisions are switched OFF on canonical) and the view is not recorded; record it with the credit demo user (tools/layout-fixtures/record.mjs) once one exists. Its table uses declared columns (COL.date, two COL.fill, COL.money, COL.count, labelCol limitLifecycle)',
}

/** The full route patterns declared in src/App.tsx, nesting resolved. */
export function appRoutes(appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')): string[] {
  const out: string[] = []
  const stack: string[] = []
  let at = 0
  for (;;) {
    const open = appSource.indexOf('<Route', at)
    const close = appSource.indexOf('</Route>', at)
    if (open < 0 && close < 0) break
    if (close >= 0 && (open < 0 || close < open)) {
      stack.pop()
      at = close + 8
      continue
    }
    // The opening tag ends at the first `>` outside braces (element={<X />}).
    let depth = 0
    let end = open + 6
    for (; end < appSource.length; end++) {
      const c = appSource[end]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    const tag = appSource.slice(open, end + 1)
    at = end + 1
    if (!/^<Route[\s/>]/.test(tag)) continue
    const selfClosing = tag.endsWith('/>')
    const attrs = tag.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    const path = /\bpath="([^"]*)"/.exec(attrs)?.[1]
    const index = /\bindex\b/.test(attrs)
    const parent = stack.filter(Boolean).join('/')
    let full: string | null = null
    if (path !== undefined) full = path === '*' ? '*' : `/${[parent, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/')
    else if (index) full = `/${parent}`
    if (full && !out.includes(full)) out.push(full)
    if (!selfClosing) stack.push(path ?? '')
  }
  return out
}
