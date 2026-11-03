/**
 * The user guide's content build and checks (docs/guide/README.md):
 * docs/guide/<lang>/** → one JSON bundle per language for the Help centre
 * (src/features/help/content/), plus every consistency check `npm test` runs.
 *
 * Ported from the sister product's manual (MIG Inward Re, scripts/manual) so
 * the two Help centres work alike; the domain, the roles, the route parser
 * (TCI nests its routes) and the Uzbek apostrophe rule (U+2018) are TCI's.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  escapeHtml,
  lookup,
  parseFrontMatter,
  renderMarkdown,
  slugify,
  stripTags,
  tokensOf,
  type FrontMatter,
  type Heading,
  type Lang,
  type Resolver,
} from './markdown.ts'

export const LANGS: Lang[] = ['ru', 'en', 'uz']

/** The department roles of tci.user_role (src/lib/roles.ts), in the guide's order. */
export const ROLES = [
  'sales',
  'commercial_underwriter',
  'credit_analyst',
  'credit_underwriter',
  'information_manager',
  'claims',
  'admin',
  'client',
] as const
export type Role = (typeof ROLES)[number]
/** `all` = every STAFF role. A client sees only topics that name `client`. */
export const ROLE_VALUES: string[] = [...ROLES, 'all']

export const SECTIONS = [
  '01-getting-started',
  '02-sales',
  '03-commercial',
  '04-credit-analysis',
  '05-credit-underwriting',
  '06-data',
  '07-claims',
  '08-admin',
  '09-portal',
  '10-glossary',
  '11-faq',
]
export const GLOSSARY_FOLDER = '10-glossary'
/** The role sections (each role's own section), where the task pattern applies. */
export const ROLE_SECTIONS: Record<Role, string> = {
  sales: '02-sales',
  commercial_underwriter: '03-commercial',
  credit_analyst: '04-credit-analysis',
  credit_underwriter: '05-credit-underwriting',
  information_manager: '06-data',
  claims: '07-claims',
  admin: '08-admin',
  client: '09-portal',
}

/** The task pattern's headings: a topic with «Steps» has all four (warning otherwise). */
export const TASK_HEADINGS: Record<Lang, string[]> = {
  ru: ['Когда использовать', 'Шаги', 'Результат', 'Частые ошибки'],
  en: ['When to use it', 'Steps', 'Result', 'Common mistakes'],
  uz: ['Qachon foydalaniladi', 'Qadamlar', 'Natija', 'Ko‘p uchraydigan xatolar'],
}

/**
 * Routes of src/App.tsx that need no guide article — each with its reason.
 * Every other route must be in some topic's `pages`, in all three languages.
 */
export const EXEMPT_ROUTES: Record<string, string> = {
  '*': 'the not-found page',
  '/no-access': 'a notice page that names the role which opens the section',
  '/buyers': 'redirect to /entities',
  '/buyers/*': 'redirect to /entities',
  '/buyers/:id/report': 'redirect to /entities/:id/report',
  '/policyholders': 'redirect to /entities',
  '/policyholders/*': 'redirect to /entities',
  '/contracts': 'redirect to /policies?view=contracts',
  '/wording': 'redirect to /policies?view=templates',
  '/portfolio/policies': 'redirect to /policies?view=overview',
  '/portfolio/credit': 'redirect to /limits?view=overview',
  '/brochure': 'redirect to /requests',
  '/policies/contracts/:draftId/print': 'print route of a contract draft (the browser’s «Save as PDF»)',
  '/requests/offers/:offerId/print': 'print route of a commercial offer',
  '/portal/offers/:offerId/print': 'print route of a commercial offer (portal face)',
  '/admin/tokens': 'the design-token reference for developers',
  '/help': 'the Help centre itself',
  '/help/:topicId': 'the Help centre itself',
  '/help/term/:termId': 'the Help centre itself',
  '/portal/help': 'the Help centre itself (portal)',
  '/portal/help/:topicId': 'the Help centre itself (portal)',
  '/portal/help/term/:termId': 'the Help centre itself (portal)',
}

/** Latin words allowed in Russian text (case-insensitive). */
export const LATIN_ALLOW = [
  'TCI', 'ERP', 'DEMO', 'ADT', 'NQL', 'DL', 'AFL', 'NOA', 'UZS', 'USD', 'EUR', 'OECD', 'IFRS', 'PDF', 'DOCX', 'MFA',
  'ID', 'Excel', 'CSV', 'Enter', 'Esc', 'Tab', 'Ctrl', 'Shift', 'Alt', 'Cmd', 'F1', 'URL', 'e-mail', 'email', 'Google',
  'Chrome', 'Edge', 'Firefox', 'Safari', 'Windows', 'macOS', 'Mac', 'Authenticator', 'TOTP', 'Allianz', 'Trade', 'Coface',
  'Atradius', 'Moody', 'Fitch', 'S&P', 'OFAC', 'SDN', 'UN', 'EU', 'UK', 'CL', 'DR', 'IR', 'KP', 'IBAN', 'SWIFT', 'A4', 'UTC',
  'WebP', 'Word', 'Up', 'Down', 'Home', 'End', 'J', 'K', 'O', 'C', 'E', 'S', 'T', 'B', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
  'D', 'A', 'BB2', 'GLEIF', 'Companies', 'House', 'Ahbor', 'Reyting', 'SAIPRO', 'ACRA', 'Expert', 'RA', 'HGB', 'GAAP',
  'Supabase', 'FastAPI', 'NAS', 'API',
]
/** More stray Latin words than this in one language fails the check (fewer only warn). */
export const LATIN_FAIL_AT = 25

export interface TopicOut {
  id: string
  section: string
  title: string
  roles: string[]
  pages: string[]
  order: number
  /** True for a section's 00-index.md. */
  index?: boolean
  html: string
  headings: Heading[]
  /** Plain text for the search (title not included). */
  text: string
}

export interface SectionOut {
  id: string
  folder: string
  title: string
  roles: string[]
  /** Topic ids in reading order (the index itself not included). */
  topics: string[]
}

export interface HelpBundle {
  lang: Lang
  version: string
  sections: SectionOut[]
  topics: Record<string, TopicOut>
  terms: Record<string, { text: string; topic: string; anchor: string | null }>
}

export type PageMap = Record<string, { id: string; roles: string[] }[]>

export interface ShotManifest {
  /** Per shot id: alt text and, per language, the app version it was taken with. */
  shots: Record<
    string,
    {
      alt: Partial<Record<Lang, string>>
      langs: Partial<Record<Lang, { version: string; takenAt: string; width: number; height: number }>>
    }
  >
}

export interface Paths {
  root: string
  docs: string
  shotsDir: string
  manifest: string
  shotSpecs: string
  locales: string
  appRoutes: string
  out: string
  pkg: string
}

export function defaultPaths(root: string): Paths {
  return {
    root,
    docs: path.join(root, 'docs/guide'),
    shotsDir: path.join(root, 'docs/guide/shots'),
    manifest: path.join(root, 'docs/guide/shots/manifest.json'),
    shotSpecs: path.join(root, 'e2e/guide/shots'),
    locales: path.join(root, 'src/i18n/locales'),
    appRoutes: path.join(root, 'src/App.tsx'),
    out: path.join(root, 'src/features/help/content'),
    pkg: path.join(root, 'package.json'),
  }
}

interface Doc {
  lang: Lang
  rel: string
  folder: string
  file: string
  fm: FrontMatter | null
  body: string
  index: boolean
}

const listMd = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) for (const f of listMd(path.join(dir, e.name))) out.push(`${e.name}/${f}`)
    else if (e.name.endsWith('.md')) out.push(e.name)
  }
  return out.sort()
}

function loadDocs(p: Paths, lang: Lang, problems: Problems): Doc[] {
  const base = path.join(p.docs, lang)
  return listMd(base).flatMap((rel) => {
    const parts = rel.split('/')
    if (parts.length !== 2) {
      problems.error(`${lang}/${rel}: files live in <NN>-<section>/<NN>-<topic>.md`)
      return []
    }
    const src = fs.readFileSync(path.join(base, rel), 'utf8')
    let fm: FrontMatter | null = null
    let body = src
    try {
      const r = parseFrontMatter(src)
      fm = r.data
      body = r.body
    } catch (e) {
      problems.error(`${lang}/${rel}: ${(e as Error).message}`)
    }
    return [{ lang, rel, folder: parts[0], file: parts[1], fm, body, index: parts[1] === '00-index.md' }]
  })
}

export class Problems {
  errors: string[] = []
  warnings: string[] = []
  error(m: string) {
    this.errors.push(m)
  }
  warn(m: string) {
    this.warnings.push(m)
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Shot ids defined in e2e/guide/shots/*.ts (read as text: every `id: '…'`). */
export function shotSpecIds(dir: string): Map<string, string> {
  const ids = new Map<string, string>()
  if (!fs.existsSync(dir)) return ids
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/(?:^|[\s{,])id\s*:\s*(['"`])([\w-]+)\1/g)) {
      if (ids.has(m[2])) throw new Error(`shot id «${m[2]}» defined twice (${ids.get(m[2])}, ${f})`)
      ids.set(m[2], f)
    }
  }
  return ids
}

/** Screenshot file format (lossy WebP: a fifth of the PNG size, text stays sharp at 2×). */
export const SHOT_EXT = '.webp'
/** Where the app serves the screenshots and the PDFs (vite.config.ts copies them into the build). */
export const SHOT_URL = '/guide/shots'
export const PDF_URL = '/guide/pdf'

/** Width × height of a WebP (VP8 / VP8L / VP8X header). */
export function imageSize(file: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(30)
    fs.readSync(fd, b, 0, 30, 0)
    fs.closeSync(fd)
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null
    const kind = b.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    return null
  } catch {
    return null
  }
}

/**
 * The full route patterns declared in src/App.tsx, nesting resolved (TCI
 * nests its routes: `<Route path="portal">` holds `limits`, which is
 * /portal/limits). The same parser as e2e/layout/screens.ts.
 */
export function appRoutes(appSource: string): string[] {
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
    const p = /\bpath="([^"]*)"/.exec(attrs)?.[1]
    const index = /\bindex\b/.test(attrs)
    const parent = stack.filter(Boolean).join('/')
    let full: string | null = null
    if (p !== undefined) full = p === '*' ? '*' : `/${[parent, p].filter(Boolean).join('/')}`.replace(/\/+/g, '/')
    else if (index) full = `/${parent}`
    if (full && !out.includes(full)) out.push(full)
    if (!selfClosing) stack.push(p ?? '')
  }
  return out
}

export function semverLess(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0)
  return false
}

/** True when a reader acting in `role` may read a topic with these roles: staff
 * read the whole guide, a client only what names `client` (mirrored by
 * helpVisibleTo in src/features/help/pages.ts). */
export function visibleTo(roles: readonly string[], role: string): boolean {
  return role === 'client' ? roles.includes('client') : true
}

export interface BuildResult {
  bundles: Record<Lang, HelpBundle>
  pages: PageMap
  problems: Problems
}

export interface BuildOptions {
  /** Treat shots taken with an older app version as a warning, not an error (GUIDE_ALLOW_STALE=1). */
  allowStale?: boolean
}

/** Builds the bundles and runs every check. Writes nothing. */
export function buildGuide(p: Paths, opts: BuildOptions = {}): BuildResult {
  const problems = new Problems()
  const version = readJson<{ version: string }>(p.pkg, { version: '0.0.0' }).version
  const locales = Object.fromEntries(
    LANGS.map((l) => [l, readJson<Record<string, unknown>>(path.join(p.locales, `${l}.json`), {})]),
  ) as Record<Lang, Record<string, unknown>>
  const manifest = readJson<ShotManifest>(p.manifest, { shots: {} })
  let specIds = new Map<string, string>()
  try {
    specIds = shotSpecIds(p.shotSpecs)
  } catch (e) {
    problems.error((e as Error).message)
  }
  const docsBy = Object.fromEntries(LANGS.map((l) => [l, loadDocs(p, l, problems)])) as Record<Lang, Doc[]>

  // --- identical tree, front matter, ids --------------------------------------------------------
  const ref = docsBy.ru
  const relSet = (l: Lang) => new Set(docsBy[l].map((d) => d.rel))
  const allRel = [...new Set(LANGS.flatMap((l) => [...relSet(l)]))].sort()
  for (const rel of allRel) {
    const missing = LANGS.filter((l) => !relSet(l).has(rel))
    if (missing.length) problems.error(`${rel}: missing in ${missing.join(', ')} (every language has the same files)`)
  }
  for (const l of LANGS) {
    const seen = new Map<string, string>()
    const folders = new Set(docsBy[l].map((d) => d.folder))
    for (const f of folders) {
      if (!SECTIONS.includes(f)) problems.warn(`${l}/${f}: not one of the guide's sections (${SECTIONS.join(', ')})`)
      if (!docsBy[l].some((d) => d.folder === f && d.index)) problems.error(`${l}/${f}: 00-index.md is missing`)
    }
    for (const d of docsBy[l]) {
      const at = `${l}/${d.rel}`
      if (!d.fm) {
        problems.error(`${at}: front matter is missing`)
        continue
      }
      const id = str(d.fm.id)
      if (!id) problems.error(`${at}: front matter has no id`)
      else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) problems.error(`${at}: id «${id}» is not kebab-case`)
      else if (seen.has(id)) problems.error(`${at}: id «${id}» already used by ${seen.get(id)}`)
      else seen.set(id, d.rel)
      if (!str(d.fm.title)) problems.error(`${at}: front matter has no title`)
      const roles = arr(d.fm.roles)
      if (!roles.length) problems.error(`${at}: front matter has no roles`)
      for (const r of roles) if (!ROLE_VALUES.includes(r)) problems.error(`${at}: unknown role «${r}» (${ROLE_VALUES.join('|')})`)
      for (const pg of arr(d.fm.pages)) if (!pg.startsWith('/')) problems.error(`${at}: page «${pg}» must start with /`)
      if (d.fm.order !== undefined && typeof d.fm.order !== 'number') problems.error(`${at}: order must be a number`)
      if (l !== 'ru') {
        const r = ref.find((x) => x.rel === d.rel)
        if (r?.fm) {
          for (const k of ['id', 'roles', 'pages', 'order'] as const)
            if (JSON.stringify(r.fm[k] ?? null) !== JSON.stringify(d.fm[k] ?? null))
              problems.error(`${at}: ${k} differs from ru (${JSON.stringify(r.fm[k] ?? null)})`)
        }
      }
    }
  }

  // --- what tokens can point at (pass 1) --------------------------------------------------------
  const idOf = (d: Doc) => str(d.fm?.id)
  const topicIds = new Set(LANGS.flatMap((l) => docsBy[l].map(idOf)).filter(Boolean))
  const rolesOfTopic = new Map(ref.filter((d) => idOf(d)).map((d) => [idOf(d), arr(d.fm?.roles)]))
  const termsBy = {} as Record<Lang, HelpBundle['terms']>
  const anchorsBy = {} as Record<Lang, Map<string, Set<string>>>
  for (const l of LANGS) {
    termsBy[l] = {}
    anchorsBy[l] = new Map()
    for (const d of docsBy[l]) {
      const id = idOf(d)
      if (!id) continue
      const set = new Set<string>()
      for (const m of d.body.matchAll(/^#{1,6}\s+(.*?)\s*\{#([\w-]+)\}\s*$/gm)) set.add(m[2])
      anchorsBy[l].set(id, set)
      if (d.folder !== GLOSSARY_FOLDER) continue
      if (id.startsWith('term-') && !d.index) termsBy[l][id.slice(5)] = { text: str(d.fm?.title), topic: id, anchor: null }
      for (const m of d.body.matchAll(/^#{2,6}\s+(.*?)\s*\{#term-([\w-]+)\}\s*$/gm)) {
        if (termsBy[l][m[2]]) problems.error(`${l}/${d.rel}: glossary term «${m[2]}» defined twice`)
        termsBy[l][m[2]] = { text: m[1].replace(/\*\*|`|\{\{[^}]*\}\}/g, '').trim(), topic: id, anchor: `term-${m[2]}` }
      }
    }
  }
  const titleOf = (l: Lang, id: string) => str(docsBy[l].find((d) => idOf(d) === id)?.fm?.title)

  // --- render (pass 2) --------------------------------------------------------------------------
  const bundles = {} as Record<Lang, HelpBundle>
  const shotsUsed = new Set<string>()
  const seq = {} as Record<Lang, Map<string, string>>
  for (const l of LANGS) {
    seq[l] = new Map()
    const quote = (s: string) => (l === 'en' ? s : `«${s}»`)
    // the topic being rendered: a client topic may only point at what a client sees
    let current: Doc | null = null
    const clientOnly = (target: string, what: string) => {
      const mine = arr(current?.fm?.roles)
      if (!mine.includes('client')) return
      if (!visibleTo(rolesOfTopic.get(target) ?? [], 'client'))
        throw new Error(`a portal topic must not point at ${what} a client cannot read`)
    }
    const resolver: Resolver = {
      ui(key) {
        const v = lookup(locales[l], key)
        if (v === undefined) throw new Error(`no locale key «${key}» in src/i18n/locales/${l}.json`)
        // a label with values in it («Текущая роль: {{role}}») shows them as …
        const label = v.replace(/\{\{[^}]*\}\}/g, '…').replace(/<\/?\d+>/g, '').replace(/[:：]\s*$/, '')
        return `<b class="help-ui">${escapeHtml(quote(label))}</b>`
      },
      term(id, text) {
        const t = termsBy[l][id]
        if (!t) throw new Error(`no glossary term «${id}» (${GLOSSARY_FOLDER}: a heading with {#term-${id}})`)
        clientOnly(t.topic, 'a glossary entry')
        return `<a class="help-term" href="/help/${t.topic}${t.anchor ? `#${t.anchor}` : ''}">${escapeHtml(text || t.text)}</a>`
      },
      link(arg, text) {
        const [id, anchor] = arg.split('#')
        if (!topicIds.has(id)) throw new Error(`no topic «${id}»`)
        if (anchor && !anchorsBy[l].get(id)?.has(anchor)) throw new Error(`topic «${id}» has no heading {#${anchor}}`)
        clientOnly(id, 'a topic')
        return `<a class="help-link" href="/help/${id}${anchor ? `#${anchor}` : ''}">${escapeHtml(text || titleOf(l, id))}</a>`
      },
      shot(id) {
        shotsUsed.add(id)
        if (!specIds.has(id)) throw new Error(`no shot «${id}» in e2e/guide/shots/*.ts`)
        const file = path.join(p.shotsDir, l, `${id}${SHOT_EXT}`)
        const size = imageSize(file)
        const alt = manifest.shots[id]?.alt?.[l] ?? ''
        if (!size) {
          problems.error(`shot «${id}»: docs/guide/shots/${l}/${id}${SHOT_EXT} is missing (npm run guide:shots)`)
          return `<figure class="help-shot help-shot-missing" data-shot="${escapeHtml(id)}"><figcaption>${escapeHtml(id)}</figcaption></figure>`
        }
        // taken at deviceScaleFactor 2: CSS size is half the pixels
        const w = Math.round(size.width / 2)
        const h = Math.round(size.height / 2)
        return `<figure class="help-shot" data-shot="${escapeHtml(id)}"><img src="${SHOT_URL}/${l}/${escapeHtml(id)}${SHOT_EXT}" alt="${escapeHtml(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async"></figure>`
      },
    }
    const topics: Record<string, TopicOut> = {}
    const sections: SectionOut[] = []
    for (const d of docsBy[l]) {
      const id = idOf(d)
      if (!id || !d.fm) continue
      current = d
      const r = renderMarkdown(d.body, resolver, id)
      current = null
      for (const e of r.errors) problems.error(`${l}/${d.rel}: ${e}`)
      seq[l].set(
        d.rel,
        JSON.stringify([r.shots, tokensOf(d.body).filter((t) => t.kind !== 'ui').map((t) => `${t.kind}:${t.arg}`)]),
      )
      const order = typeof d.fm.order === 'number' ? d.fm.order : parseInt(d.file, 10) || 0
      topics[id] = {
        id,
        section: '',
        title: str(d.fm.title),
        roles: arr(d.fm.roles),
        pages: arr(d.fm.pages),
        order,
        ...(d.index ? { index: true } : {}),
        html: r.html,
        headings: r.headings,
        text: stripTags(r.html),
      }
      if (Object.values(ROLE_SECTIONS).includes(d.folder) && !d.index) {
        const hs = r.headings.filter((h) => h.level === 2).map((h) => h.text)
        const want = TASK_HEADINGS[l]
        if (hs.includes(want[1]) && want.some((w) => !hs.includes(w)))
          problems.warn(`${l}/${d.rel}: a task needs the headings ${want.map((w) => `«${w}»`).join(', ')}`)
      }
    }
    const folders = [...new Set(docsBy[l].map((d) => d.folder))].sort()
    for (const f of folders) {
      const docs = docsBy[l].filter((d) => d.folder === f && d.fm && idOf(d))
      const idx = docs.find((d) => d.index)
      if (!idx) continue
      const sid = idOf(idx)
      const list = docs
        .filter((d) => !d.index)
        .map((d) => topics[idOf(d)])
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      for (const t of [topics[sid], ...list]) t.section = sid
      sections.push({ id: sid, folder: f, title: topics[sid].title, roles: topics[sid].roles, topics: list.map((t) => t.id) })
    }
    bundles[l] = { lang: l, version, sections, topics, terms: termsBy[l] }
  }

  // --- same shots and links in every language ---------------------------------------------------
  for (const l of LANGS.slice(1))
    for (const [rel, s] of seq[l]) {
      const r = seq.ru.get(rel)
      if (r !== undefined && r !== s) {
        const [rs] = JSON.parse(r) as [string[]]
        const [ls] = JSON.parse(s) as [string[]]
        if (JSON.stringify(rs) !== JSON.stringify(ls))
          problems.error(`${l}/${rel}: screenshots ${JSON.stringify(ls)} differ from ru ${JSON.stringify(rs)}`)
        else problems.warn(`${l}/${rel}: term / link tokens differ from ru`)
      }
    }

  // --- screenshots: specs, files, freshness -----------------------------------------------------
  for (const id of shotsUsed) {
    if (!specIds.has(id)) continue
    for (const l of LANGS) {
      const m = manifest.shots[id]?.langs?.[l]
      if (!m) {
        if (imageSize(path.join(p.shotsDir, l, `${id}${SHOT_EXT}`)))
          problems.error(`shot «${id}» (${l}): not in docs/guide/shots/manifest.json — retake with npm run guide:shots`)
        continue
      }
      if (semverLess(m.version, version)) {
        const msg = `shot «${id}» (${l}) was taken with v${m.version}, the app is v${version}: retake (npm run guide:shots)`
        if (opts.allowStale) problems.warn(msg)
        else problems.error(msg)
      }
    }
  }
  for (const [id, f] of specIds) if (!shotsUsed.has(id)) problems.warn(`shot «${id}» (e2e/guide/shots/${f}) is not used in the text`)
  for (const l of LANGS) {
    const dir = path.join(p.shotsDir, l)
    if (fs.existsSync(dir))
      for (const f of fs.readdirSync(dir))
        if (f.endsWith('.png') || (f.endsWith(SHOT_EXT) && !specIds.has(f.slice(0, -SHOT_EXT.length))))
          problems.warn(`docs/guide/shots/${l}/${f}: no shot spec, or an old format (npm run guide:shots removes it)`)
  }

  // --- page → topic mapping: every route of App.tsx has an article ------------------------------
  const routes = fs.existsSync(p.appRoutes) ? appRoutes(fs.readFileSync(p.appRoutes, 'utf8')) : []
  const pages: PageMap = {}
  const ru = bundles.ru
  const rank = (t: TopicOut) => {
    const s = ru.sections.findIndex((x) => x.id === t.section)
    return (s < 0 ? 99 : s) * 10000 + (t.index ? 0 : 1 + t.order)
  }
  for (const t of Object.values(ru.topics).sort((a, b) => rank(a) - rank(b))) {
    for (const pg of t.pages) {
      if (routes.length && !routes.includes(pg))
        problems.error(`ru topic «${t.id}»: page «${pg}» is not a route in src/App.tsx`)
      if (pg in EXEMPT_ROUTES) problems.error(`ru topic «${t.id}»: page «${pg}» is exempt (${EXEMPT_ROUTES[pg]}) — drop it`)
      // a portal page's topics must be readable by a client, and a staff page's by staff
      const portal = pg === '/portal' || pg.startsWith('/portal/')
      if (portal && !t.roles.includes('client')) problems.error(`ru topic «${t.id}»: portal page «${pg}» on a topic a client cannot read`)
      if (!portal && pg !== '/login' && pg !== '/change-password' && pg !== '/mfa/verify' && t.roles.length === 1 && t.roles[0] === 'client')
        problems.error(`ru topic «${t.id}»: staff page «${pg}» on a portal-only topic`)
      ;(pages[pg] ??= []).push({ id: t.id, roles: t.roles })
    }
  }
  if (Object.keys(ru.topics).length) {
    for (const r of routes)
      if (!(r in EXEMPT_ROUTES) && !pages[r])
        problems.error(`route «${r}» has no guide article (add it to a topic's pages, or to EXEMPT_ROUTES in scripts/guide/content.ts with a reason)`)
    for (const r of Object.keys(EXEMPT_ROUTES))
      if (routes.length && !routes.includes(r)) problems.warn(`EXEMPT_ROUTES names «${r}», which src/App.tsx no longer has`)
  }

  // --- language: stray Latin words, the Uzbek apostrophes ---------------------------------------
  for (const l of ['ru', 'uz'] as const) {
    const found: string[] = []
    for (const d of docsBy[l]) {
      const text = proseOf(d)
      // the glossary gives each term's English equivalent on purpose
      if (d.folder !== GLOSSARY_FOLDER) for (const w of strayWords(l, text, ALLOW)) found.push(`${l}/${d.rel}: «${w}»`)
      if (l === 'uz') for (const e of uzApostropheErrors(text)) problems.error(`uz/${d.rel}: ${e}`)
      for (const [label, re] of RETIRED[l]) {
        const m = re.exec(text)
        if (m) problems.error(`${l}/${d.rel}: «${m[0]}» — ${label} (CLAUDE.md glossary)`)
      }
    }
    if (found.length > LATIN_FAIL_AT) problems.error(`${l}: ${found.length} stray Latin words (more than ${LATIN_FAIL_AT}):\n  ${found.join('\n  ')}`)
    else for (const f of found) problems.warn(`stray Latin word ${f}`)
  }

  return { bundles, pages, problems }
}

/**
 * Retired variants of the owner-decided terms (CLAUDE.md glossary; the
 * locales are held to the same by src/i18n/ruTerminology.test.ts and
 * uzTerminology.test.ts). The guide may not bring one back.
 */
export const RETIRED: Record<'ru' | 'uz', [string, RegExp][]> = {
  ru: [
    ['the buyer is «Байер»', /покупател\p{L}*/iu],
    ['NQL is «Невозмещаемые убытки»', /(некредитуем|некомпенсируем|неквалифицируем)\p{L}*/iu],
    ['AFL is «Агрегатная франшиза»', /совокупн\p{L}* франшиз\p{L}*/iu],
    ['the grade band is «Диапазон рейтинга»', /рейтингов\p{L}* класс\p{L}*|грейд-бэнд/iu],
    ['the engine limit is «Рекомендуемый лимит»', /расч[её]тн\p{L}* лимит\p{L}*/iu],
    ['a claim is «Претензия»', /требовани\p{L}* о возмещении/iu],
    ['the engine grade is «Рекомендуемый рейтинг», the grade in force «Рейтинг»', /рейтинг модели|действующ\p{L}* рейтинг\p{L}*/iu],
    ['the insured percentage is «Процент покрытия»', /страхов\p{L}* процент\p{L}*|дол\p{L}* покрытия/iu],
  ],
  uz: [
    ['the buyer is «Bayer»', /xaridor\p{L}*/iu],
    ['the policyholder is «Sug‘urtalanuvchi»', /sug.urta qildiruvchi/iu],
    ['an overdue notification is «xabarnoma»', /bildirishnom\p{L}*/iu],
    ['the role is «Kredit tahlilchi»', /tahlilchisi/iu],
    ['the engine grade is «Tavsiya etilgan reyting», the grade in force «Reyting»', /model reyting\p{L}*|amaldagi reyting\p{L}*/iu],
    ['the grade band is «reyting diapazoni»', /reyting (klass|sinf)\p{L}*/iu],
    ['«Bekor qilish» always names its object («Limitni bekor qilish»)', /(?<!\p{L}ni\s)\bbekor qilish\b/iu],
    ['the retired «chaqirib olish» family', /chaqirib/iu],
  ],
}

/**
 * Uzbek Latin as the TCI uz locale writes it (CLAUDE.md glossary): oʻ / gʻ
 * take U+2018 ‘ («Sug‘urtalanuvchi», «ko‘p»), the tutuq belgisi takes U+2019 ’
 * («da’vo», «ma’lumot»). An ASCII apostrophe, U+02BB ʻ or a backtick inside a
 * word, or o / g followed by anything but ‘, is an error.
 */
export function uzApostropheErrors(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[\p{L}]*[oOgG]['’ʻʼ`][\p{L}]+/gu))
    out.push(`«${m[0]}» — Uzbek oʻ / gʻ take ‘ (U+2018), as the uz locale does`)
  for (const m of text.matchAll(/[\p{L}]+['ʻʼ`][\p{L}]+/gu))
    if (!/[oOgG]['’ʻʼ`]/.test(m[0])) out.push(`«${m[0]}» — the tutuq belgisi is ’ (U+2019), as the uz locale writes «da’vo»`)
  return out
}

/** The prose a reader sees, without tokens, code, links' URLs and HTML. */
function proseOf(d: Doc): string {
  return [str(d.fm?.title), d.body]
    .join('\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\{#[\w-]+\}/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+\.\w+/g, ' ')
    .replace(/\[!\w+\]/g, ' ')
}

const ALLOW = new Set(LATIN_ALLOW.map((w) => w.toLowerCase()))

export function strayWords(lang: 'ru' | 'uz', text: string, allow: Set<string> = ALLOW): string[] {
  const out: string[] = []
  if (lang === 'ru') {
    for (const m of text.matchAll(/(?<![\p{L}\d])[A-Za-z][A-Za-z&’'-]*(?![\p{L}])/gu)) {
      const w = m[0].replace(/[’'-]+$/, '')
      if (w.length < 2 || allow.has(w.toLowerCase()) || /^[A-Z0-9&-]+$/.test(w) || /^DEMO/.test(w)) continue
      out.push(w)
    }
  } else {
    // Uzbek Latin has no w, and c only in ch: words with them are English (or a typo)
    for (const m of text.matchAll(/[\p{L}ʻʼ‘’'-]+/gu)) {
      const w = m[0]
      if (/[А-Яа-яЁё]/.test(w)) out.push(w)
      else if (/[wW]|[cC](?![hH])/.test(w) && !allow.has(w.toLowerCase()) && !/^[A-Z0-9&-]+$/.test(w)) out.push(w)
    }
  }
  return out
}

/** Writes the bundles and the page map (stable output). */
export function writeBundles(p: Paths, r: BuildResult) {
  fs.mkdirSync(p.out, { recursive: true })
  for (const l of LANGS) fs.writeFileSync(path.join(p.out, `${l}.json`), `${JSON.stringify(r.bundles[l])}\n`)
  fs.writeFileSync(path.join(p.out, 'pages.json'), `${JSON.stringify(r.pages, null, 1)}\n`)
}

export { slugify }
