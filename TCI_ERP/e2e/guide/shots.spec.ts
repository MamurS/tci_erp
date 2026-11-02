/**
 * Takes the user guide's screenshots (docs/guide/README.md): every spec in
 * e2e/guide/shots/*.ts, in RU / EN / UZ, 1440×900 at 2×, numbered marks drawn
 * as an overlay — into docs/guide/shots/<lang>/<id>.webp.
 *
 * The app runs against the STUBBED backend with the network SEALED
 * (e2e/support): the recorded demo book is replayed with «DEMO …» company
 * names (demo.ts), nothing reaches *.supabase.co, nothing is written anywhere
 * (CLAUDE.md «Tools never write to canonical»). A shot fails if any request
 * tried to leave the machine.
 *
 * Run through `npm run guide:shots` (which also updates the manifest); skipped
 * in the normal suite unless GUIDE_SHOTS=1. GUIDE_SHOT=<regex> limits the ids,
 * GUIDE_LANGS=ru,en the languages.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'
import { loadFixture, replay } from '../layout/fixtures'
import type { RoleFixture } from '../layout/fixtures'
import { DEMO_ROLES } from '../layout/screens'
import { companyNames, demoise } from './demo'
import { LANGS } from './types'
import type { Lang, ShotContext, ShotMark, ShotRect, ShotSpec } from './types'
import gettingStarted from './shots/01-getting-started'
import roles from './shots/02-roles'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'docs/guide/shots')
/** Per-shot results the manifest step (scripts/guide/shots.ts) reads. */
const META_DIR = path.join(ROOT, 'test-results/guide-shots')
const ON = process.env.GUIDE_SHOTS === '1'
const ONLY = process.env.GUIDE_SHOT ? new RegExp(process.env.GUIDE_SHOT) : null
const ONLY_LANGS = (process.env.GUIDE_LANGS?.split(',') as Lang[] | undefined) ?? [...LANGS]
/** Annotation colour: one vivid red that reads on every theme. */
const MARK = '#d9214b'

const SPECS: ShotSpec[] = [...gettingStarted, ...roles]

const locales = Object.fromEntries(
  LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${l}.json`), 'utf8'))]),
) as Record<Lang, Record<string, unknown>>

/** t(key) as the app shows it: nested key, {{var}} values, plural forms by `count`. */
function makeT(lang: Lang) {
  const get = (key: string): string | undefined => {
    let cur: unknown = locales[lang]
    for (const k of key.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined
    return typeof cur === 'string' ? cur : undefined
  }
  return (key: string, vars: Record<string, string | number> = {}) => {
    let s = get(key)
    if (s === undefined && typeof vars.count === 'number')
      s = get(`${key}_${new Intl.PluralRules(lang).select(vars.count)}`) ?? get(`${key}_other`)
    if (s === undefined) throw new Error(`no locale key «${key}» in ${lang}`)
    return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
  }
}

// The demo book, every company renamed the same way in every fixture.
const RAW = Object.fromEntries(DEMO_ROLES.map((r) => [r, loadFixture(r)])) as Record<string, RoleFixture | null>
const NAMES = [...new Set(Object.values(RAW).flatMap((f) => (f ? [...companyNames(f.responses)] : [])))].sort()
const FIXTURES = Object.fromEntries(
  Object.entries(RAW).map(([r, f]) => [r, f ? demoise(f, NAMES) : null]),
) as Record<string, RoleFixture | null>

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  // skeletons and spinners gone
  await page
    .locator('[aria-busy="true"], .animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {})
  await page.waitForTimeout(300)
}

type Box = { x: number; y: number; width: number; height: number }

/** PNG → lossy WebP by Chromium's own encoder (no extra dependency). */
const WEBP_QUALITY = 0.85
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const url = await page.evaluate(
    async ({ b64, q }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d')!.drawImage(img, 0, 0)
      return c.toDataURL('image/webp', q)
    },
    { b64: png.toString('base64'), q: WEBP_QUALITY },
  )
  if (!url.startsWith('data:image/webp')) throw new Error('this Chromium cannot encode WebP')
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}

/** Draws the numbered marks (viewport coordinates) in a fixed layer above the app. */
async function drawMarks(page: Page, marks: { n: number; kind: string; from: string; box: Box }[]) {
  await page.evaluate(
    ({ marks, color }) => {
      const layer = document.createElement('div')
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
      const badge = (n: number, cx: number, cy: number) => {
        const b = document.createElement('div')
        b.textContent = String(n)
        b.style.cssText = `position:absolute;left:${cx - 13}px;top:${cy - 13}px;width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font:700 14px/26px Inter Variable,Inter,system-ui,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)`
        layer.appendChild(b)
      }
      const vw = window.innerWidth
      for (const m of marks) {
        const { x, y, width: w, height: h } = m.box
        if (m.kind === 'box') {
          const f = document.createElement('div')
          f.style.cssText = `position:absolute;left:${x - 4}px;top:${y - 4}px;width:${w + 8}px;height:${h + 8}px;border:3px solid ${color};border-radius:8px;box-sizing:border-box;box-shadow:0 0 0 2px rgba(255,255,255,.7)`
          layer.appendChild(f)
          badge(m.n, Math.max(15, x - 4), Math.max(15, y - 4))
        } else if (m.kind === 'circle') {
          const left = x - 22 >= 15
          badge(m.n, left ? x - 22 : Math.min(vw - 15, x + w + 22), y + h / 2)
        } else {
          const len = 56
          const tip =
            m.from === 'right'
              ? { x: x + w + 4, y: y + h / 2 }
              : m.from === 'top'
                ? { x: x + w / 2, y: y - 4 }
                : m.from === 'bottom'
                  ? { x: x + w / 2, y: y + h + 4 }
                  : { x: x - 4, y: y + h / 2 }
          const dx = m.from === 'right' ? 1 : m.from === 'left' ? -1 : 0
          const dy = m.from === 'bottom' ? 1 : m.from === 'top' ? -1 : 0
          const tail = { x: tip.x + dx * len, y: tip.y + dy * len }
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          svg.setAttribute('width', String(vw))
          svg.setAttribute('height', String(window.innerHeight))
          svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible'
          const line = (stroke: string, width: number) => {
            const l = document.createElementNS('http://www.w3.org/2000/svg', 'line')
            for (const [k, v] of Object.entries({ x1: tail.x, y1: tail.y, x2: tip.x, y2: tip.y, stroke, 'stroke-width': width, 'stroke-linecap': 'round' }))
              l.setAttribute(k, String(v))
            svg.appendChild(l)
          }
          line('#fff', 7)
          line(color, 4)
          layer.appendChild(svg)
          badge(m.n, tail.x + dx * 15, tail.y + dy * 15)
        }
      }
      document.body.appendChild(layer)
    },
    { marks, color: MARK },
  )
}

async function cropBox(page: Page, crop: ShotSpec['crop'], padding: number): Promise<Box> {
  const vp = page.viewportSize()!
  if (!crop || crop === 'page') return { x: 0, y: 0, width: vp.width, height: vp.height }
  if (typeof crop !== 'string') return crop as ShotRect
  const el = page.locator(crop).first()
  await el.waitFor({ timeout: 15_000 })
  const box = await el.boundingBox()
  if (!box) throw new Error(`crop «${crop}» is not visible`)
  const x = Math.max(0, box.x - padding)
  const y = Math.max(0, box.y - padding)
  return { x, y, width: Math.min(vp.width - x, box.width + 2 * padding), height: Math.min(vp.height - y, box.height + 2 * padding) }
}

test.describe('guide screenshots', () => {
  test.skip(!ON, 'set GUIDE_SHOTS=1 (npm run guide:shots)')
  // a cold dev server compiles each screen's chunk on first use
  test.setTimeout(120_000)
  for (const spec of SPECS) {
    if (ONLY && !ONLY.test(spec.id)) continue
    for (const lang of ONLY_LANGS) {
      test(`${spec.id} · ${lang}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: spec.viewport ?? { width: 1440, height: 900 },
          deviceScaleFactor: 2,
          reducedMotion: 'reduce',
          locale: lang === 'en' ? 'en-GB' : lang === 'ru' ? 'ru-RU' : 'uz-UZ',
          timezoneId: 'Asia/Tashkent',
        })
        // Sealed BEFORE the stub: the stub's routes win, everything else is aborted.
        const seal = await sealNetwork(context)
        const fixture = spec.fixture ? FIXTURES[spec.fixture] : null
        if (spec.fixture && !fixture) throw new Error(`${spec.id}: no recorded fixture «${spec.fixture}»`)
        await stubBackend(context, {
          lang,
          signedIn: spec.role !== null,
          roles: spec.role ? [spec.role] : [],
          user: fixture?.user,
          respond: fixture ? replay(fixture) : undefined,
          sidebar: 'open',
        })
        const page = await context.newPage()
        const ctx: ShotContext = { page, t: makeT(lang), lang }
        await page.goto(spec.path)
        await page.locator(spec.role ? 'main' : 'form').first().waitFor({ timeout: 15_000 })
        await settle(page)
        if (spec.setup) {
          await spec.setup(ctx)
          await settle(page)
        }
        const clip = await cropBox(page, spec.crop, spec.padding ?? 12)
        const marks: { n: number; kind: string; from: string; box: Box }[] = []
        for (const m of spec.marks ?? ([] as ShotMark[])) {
          const loc = (await m.target(ctx)).first()
          const box = await loc.boundingBox()
          if (!box) throw new Error(`${spec.id}: mark ${m.n} target is not visible`)
          marks.push({ n: m.n, kind: m.kind ?? 'box', from: m.from ?? 'left', box })
        }
        await drawMarks(page, marks)
        const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
        fs.mkdirSync(path.join(OUT, lang), { recursive: true })
        fs.writeFileSync(path.join(OUT, lang, `${spec.id}.webp`), await toWebp(page, png))
        fs.mkdirSync(META_DIR, { recursive: true })
        fs.writeFileSync(path.join(META_DIR, `${lang}.${spec.id}.json`), JSON.stringify({ id: spec.id, lang, alt: spec.alt[lang] }))
        expect(seal.violations(), 'requests that tried to leave the machine').toEqual([])
        await context.close()
      })
    }
  }
})
