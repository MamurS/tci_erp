/**
 * The user guide: compiler unit tests, and the checks `npm test` runs on the
 * real content (docs/guide/README.md lists them). The one that matters most:
 * every route of src/App.tsx has a guide article in all three languages, or
 * is EXEMPT with a reason.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EXEMPT_ROUTES,
  LANGS,
  RETIRED,
  appRoutes,
  buildGuide,
  defaultPaths,
  readJson,
  semverLess,
  strayWords,
  uzApostropheErrors,
  type Paths,
  type ShotManifest,
} from './content.ts'
import { parseFrontMatter, renderMarkdown, slugify, type Resolver } from './markdown.ts'
import { QUICK_START, ROLES, pdfFiles, type PdfManifest } from './print.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')

const R: Resolver = {
  ui: (k) => {
    if (k === 'missing.key') throw new Error('no locale key')
    return `<b class="help-ui">«${k}»</b>`
  },
  term: (id, text) => `<a href="/help/glossary#term-${id}">${text ?? id}</a>`,
  link: (id, text) => `<a href="/help/${id}">${text ?? id}</a>`,
  shot: (id) => `<figure data-shot="${id}"></figure>`,
}

describe('front matter', () => {
  it('reads strings, numbers, lists and comments', () => {
    const { data, body } = parseFrontMatter(
      '---\nid: credit-decide   # stable\ntitle: Решение по заявке\nroles: [credit_underwriter, admin]\npages: ["/limits/:id"]\norder: 3\n---\n\nText',
    )
    expect(data).toEqual({ id: 'credit-decide', title: 'Решение по заявке', roles: ['credit_underwriter', 'admin'], pages: ['/limits/:id'], order: 3 })
    expect(body.trim()).toBe('Text')
  })
  it('reports a missing block as null', () => {
    expect(parseFrontMatter('# No front matter').data).toBeNull()
  })
})

describe('markdown', () => {
  it('renders the task pattern: headings with anchors, numbered steps, a shot between steps', () => {
    const md = '# Title\n\n## Шаги\n\n1. Нажмите {{ui:limits.actions.decide}}.\n2. Введите **сумму**.\n\n{{shot:credit-queue}}\n\n3. Сохраните.\n'
    const r = renderMarkdown(md, R, 'credit-decide')
    expect(r.errors).toEqual([])
    expect(r.html).not.toContain('Title')
    expect(r.html).toContain('<h2 id="credit-decide--шаги">Шаги</h2>')
    expect(r.html).toContain('<ol><li>Нажмите <b class="help-ui">«limits.actions.decide»</b>.</li><li>Введите <strong>сумму</strong>.</li></ol>')
    expect(r.html).toContain('<figure data-shot="credit-queue"></figure>')
    expect(r.html).toContain('<ol start="3"><li>Сохраните.</li></ol>')
    expect(r.shots).toEqual(['credit-queue'])
  })
  it('explicit anchors, terms, links, callouts, tables, code and escaping', () => {
    const md = '### NQL {#term-nql}\n\n> [!TIP]\n> See {{term:nql|NQL}} and {{link:claims-coverage}}.\n\n| A | B |\n|---|--:|\n| `x<y` | 1 |\n\nPlain <script> & *it*'
    const r = renderMarkdown(md, R, 't')
    expect(r.errors).toEqual([])
    expect(r.html).toContain('<h3 id="term-nql">NQL</h3>')
    expect(r.html).toContain('<div class="help-callout help-callout-tip"><p>See <a href="/help/glossary#term-nql">NQL</a> and <a href="/help/claims-coverage">claims-coverage</a>.</p></div>')
    expect(r.html).toContain('<td><code>x&lt;y</code></td><td style="text-align:right">1</td>')
    expect(r.html).toContain('Plain &lt;script&gt; &amp; <em>it</em>')
  })
  it('collects token errors instead of throwing', () => {
    const r = renderMarkdown('A {{ui:missing.key}} and {{shot:inline}} here. [x](relative.md)\n\n> [!BOGUS] y', R, 't')
    expect(r.errors).toHaveLength(4)
  })
  it('slugs keep any script and drop apostrophes', () => {
    expect(slugify('Ko‘p uchraydigan xatolar')).toBe('kop-uchraydigan-xatolar')
    expect(slugify('Частые ошибки!')).toBe('частые-ошибки')
  })
})

describe('language checks', () => {
  it('Uzbek oʻ / gʻ take U+2018 as the uz locale does, the tutuq belgisi U+2019', () => {
    expect(uzApostropheErrors('Sug‘urtalanuvchi va da’vo, ko‘p, bog‘lash')).toEqual([])
    expect(uzApostropheErrors("Sug'urtalanuvchi")).toHaveLength(1)
    expect(uzApostropheErrors('Sugʻurta')).toHaveLength(1)
    expect(uzApostropheErrors('ko’p')).toHaveLength(1)
    expect(uzApostropheErrors("da'vo")).toHaveLength(1)
  })
  it('names the retired variants of the owner-decided terms', () => {
    const hit = (lang: 'ru' | 'uz', text: string) => RETIRED[lang].filter(([, re]) => re.test(text)).map(([label]) => label)
    expect(hit('ru', 'Покупатель не оплатил')).toHaveLength(1)
    expect(hit('ru', 'Расчётный лимит модели')).toHaveLength(1)
    expect(hit('ru', 'Байер не оплатил; Рекомендуемый лимит')).toEqual([])
    expect(hit('uz', 'Xaridor')).toHaveLength(1)
    expect(hit('uz', 'Bekor qilish')).toHaveLength(1)
    expect(hit('uz', 'Limitni bekor qilish va Shartnomani bekor qilish')).toEqual([])
  })
  it('finds stray Latin words in Russian, English words in Uzbek', () => {
    expect(strayWords('ru', 'Откройте TCI в Excel, затем нажмите Submit и DEMO Aral', new Set(['tci', 'excel']))).toEqual(['Submit', 'Aral'])
    expect(strayWords('uz', 'Arizani oching va click qiling', new Set())).toEqual(['click'])
  })
  it('compares versions', () => {
    expect(semverLess('0.1.0', '0.2.0')).toBe(true)
    expect(semverLess('0.10.0', '0.9.9')).toBe(false)
  })
})

describe('routes of App.tsx', () => {
  it('resolves nesting: a portal child is /portal/…, an index is its parent', () => {
    const src = `<Route path="/login" element={<A />} />
      <Route element={<B />}>
        <Route path="portal" element={<C />}>
          <Route index element={<D />} />
          <Route path="limits" element={<E x={{ a: 1 }} />} />
        </Route>
        <Route path="limits/:id" element={<F />} />
      </Route>
      <Route path="*" element={<G />} />`
    expect(appRoutes(src)).toEqual(['/login', '/portal', '/portal/limits', '/limits/:id', '*'])
  })
  it('reads the real router (the staff and the portal help routes included)', () => {
    const routes = appRoutes(fs.readFileSync(path.join(ROOT, 'src/App.tsx'), 'utf8'))
    for (const r of ['/', '/agenda', '/limits/:id', '/portal', '/portal/limits', '/help', '/help/:topicId', '/portal/help']) expect(routes).toContain(r)
  })
})

// --- a miniature guide in a temp folder: each check fires --------------------------------------
function miniGuide(edit?: (dir: string) => void): { dir: string; p: Paths } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-test-'))
  const w = (rel: string, s: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), s)
  }
  const steps = { ru: 'Шаги', en: 'Steps', uz: 'Qadamlar' }
  for (const l of LANGS) {
    w(`docs/guide/${l}/01-getting-started/00-index.md`, `---\nid: getting-started\ntitle: Start ${l}\nroles: [all]\n---\nIntro.`)
    w(`docs/guide/${l}/01-getting-started/01-a.md`, `---\nid: start-a\ntitle: A ${l}\nroles: [all]\npages: ["/x"]\norder: 1\n---\n## ${steps[l]}\n\n1. {{ui:k.label}} {{term:nql}} {{link:getting-started}}\n\n{{shot:s1}}\n`)
    w(`docs/guide/${l}/09-portal/00-index.md`, `---\nid: portal\ntitle: P\nroles: [client]\n---\nPortal.`)
    w(`docs/guide/${l}/10-glossary/00-index.md`, `---\nid: glossary\ntitle: G\nroles: [all]\n---\n### NQL {#term-nql}\nA threshold.`)
    w(`src/i18n/locales/${l}.json`, JSON.stringify({ k: { label: `Label ${l}` } }))
  }
  // a 4×2 lossless-WebP header is enough for the size reader
  const webp = Buffer.alloc(30)
  webp.write('RIFF', 0, 'ascii')
  webp.write('WEBPVP8L', 8, 'ascii')
  webp.writeUInt32LE((4 - 1) | ((2 - 1) << 14), 21)
  for (const l of LANGS) {
    fs.mkdirSync(path.join(dir, `docs/guide/shots/${l}`), { recursive: true })
    fs.writeFileSync(path.join(dir, `docs/guide/shots/${l}/s1.webp`), webp)
  }
  w('e2e/guide/shots/a.ts', "export default [{ id: 's1', role: 'admin', path: '/x', alt: { ru: 'r', en: 'e', uz: 'u' } }]")
  const m: ShotManifest = {
    shots: { s1: { alt: { ru: 'r', en: 'e', uz: 'u' }, langs: Object.fromEntries(LANGS.map((l) => [l, { version: '1.0.0', takenAt: 'x', width: 4, height: 2 }])) } },
  }
  w('docs/guide/shots/manifest.json', JSON.stringify(m))
  w('package.json', JSON.stringify({ version: '1.0.0' }))
  w('src/App.tsx', '<Route path="/no-access" /><Route path="x" />')
  edit?.(dir)
  return { dir, p: defaultPaths(dir) }
}

describe('checks on a miniature guide', () => {
  it('a clean guide builds with no errors', () => {
    const { p } = miniGuide()
    const r = buildGuide(p)
    expect(r.problems.errors).toEqual([])
    const ru = r.bundles.ru.topics['start-a']
    expect(ru.html).toContain('<b class="help-ui">«Label ru»</b>')
    expect(ru.html).toContain('<a class="help-term" href="/help/glossary#term-nql">NQL</a>')
    expect(ru.html).toContain('<img src="/guide/shots/ru/s1.webp" alt="r" width="2" height="1"')
    expect(r.bundles.en.topics['start-a'].html).toContain('<b class="help-ui">Label en</b>')
    expect(r.pages).toEqual({ '/x': [{ id: 'start-a', roles: ['all'] }] })
  })
  it('fails on unknown keys, terms, links, shots and tree differences', () => {
    const { p } = miniGuide((dir) => {
      fs.appendFileSync(path.join(dir, 'docs/guide/ru/01-getting-started/01-a.md'), '\n{{ui:k.none}} {{term:nope}} {{link:nope}}\n\n{{shot:s2}}\n')
      fs.writeFileSync(path.join(dir, 'docs/guide/en/01-getting-started/02-extra.md'), '---\nid: extra\ntitle: E\nroles: [all]\n---\n')
    })
    const e = buildGuide(p).problems.errors.join('\n')
    expect(e).toContain('no locale key «k.none»')
    expect(e).toContain('no glossary term «nope»')
    expect(e).toContain('no topic «nope»')
    expect(e).toContain('no shot «s2»')
    expect(e).toContain('01-getting-started/02-extra.md: missing in ru, uz')
  })
  it('fails on a route with no article, and on a page that is not a route', () => {
    const { p } = miniGuide((dir) => {
      fs.writeFileSync(path.join(dir, 'src/App.tsx'), '<Route path="x" /><Route path="y/:id" />')
      for (const l of LANGS) {
        const f = path.join(dir, `docs/guide/${l}/09-portal/00-index.md`)
        fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('roles: [client]', 'roles: [client]\npages: ["/nowhere"]'))
      }
    })
    const e = buildGuide(p).problems.errors.join('\n')
    expect(e).toContain('route «/y/:id» has no guide article')
    expect(e).toContain('page «/nowhere» is not a route')
  })
  it('a portal topic may not point at what a client cannot read', () => {
    const { p } = miniGuide((dir) => {
      for (const l of LANGS) fs.appendFileSync(path.join(dir, `docs/guide/${l}/09-portal/00-index.md`), '\nSee {{term:nql}}.\n')
    })
    expect(buildGuide(p).problems.errors.join('\n')).toContain('a portal topic must not point at a glossary entry a client cannot read')
  })
  it('fails when a screenshot is older than the app (or warns with allowStale)', () => {
    const { dir, p } = miniGuide()
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.1.0' }))
    expect(buildGuide(p).problems.errors.join('\n')).toContain('taken with v1.0.0, the app is v1.1.0')
    expect(buildGuide(p, { allowStale: true }).problems.errors).toEqual([])
  })
})

// --- the real guide -----------------------------------------------------------------------------
describe('docs/guide', () => {
  const p = defaultPaths(ROOT)
  const r = buildGuide(p, { allowStale: process.env.GUIDE_ALLOW_STALE === '1' })

  it('passes every content check', () => {
    if (r.problems.warnings.length) console.warn(`guide: ${r.problems.warnings.length} warning(s):\n  ${r.problems.warnings.join('\n  ')}`)
    expect(r.problems.errors).toEqual([])
  })

  it('every route in src/App.tsx has an article in all three languages (or is exempt with a reason)', () => {
    const routes = appRoutes(fs.readFileSync(p.appRoutes, 'utf8'))
    for (const l of LANGS) {
      const covered = new Set(Object.values(r.bundles[l].topics).flatMap((t) => t.pages))
      const missing = routes.filter((route) => !(route in EXEMPT_ROUTES) && !covered.has(route))
      expect(missing, `${l}: routes without a guide article`).toEqual([])
    }
    for (const [route, reason] of Object.entries(EXEMPT_ROUTES)) expect(reason.length, route).toBeGreaterThan(5)
  })

  it('the committed Help bundle is up to date (npm run guide:content)', () => {
    const same = (file: string, v: unknown) => JSON.stringify(readJson(path.join(p.out, file), null)) === JSON.stringify(v)
    const stale = [...LANGS.map((l) => [`${l}.json`, r.bundles[l]] as const), ['pages.json', r.pages] as const]
      .filter(([f, v]) => !same(f, v))
      .map(([f]) => f)
    expect(stale, 'src/features/help/content is older than docs/guide: run npm run guide:content').toEqual([])
  })

  it('every role section exists and every quick-start topic is in every language', () => {
    for (const l of LANGS) for (const role of ROLES) for (const id of QUICK_START[role]) expect(r.bundles[l].topics[id], `${l} ${role} ${id}`).toBeTruthy()
  })

  it('the quick-start PDFs exist for every role and language and match the app version', () => {
    const pkg = readJson<{ version: string }>(p.pkg, { version: '0.0.0' }).version
    const m = readJson<PdfManifest>(path.join(ROOT, 'docs/guide/pdf/manifest.json'), { files: {} })
    for (const l of LANGS)
      for (const f of pdfFiles()) {
        const key = `${l}/${f}`
        expect(fs.existsSync(path.join(ROOT, 'docs/guide/pdf', key)), `${key} (npm run guide:pdf)`).toBe(true)
        const stale = !m.files[key] || semverLess(m.files[key].version, pkg)
        if (process.env.GUIDE_ALLOW_STALE !== '1') expect(stale, `${key} printed for v${m.files[key]?.version}, the app is v${pkg}`).toBe(false)
      }
  })
})
