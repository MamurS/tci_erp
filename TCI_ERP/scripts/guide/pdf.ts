/**
 * npm run guide:pdf — prints a short «Quick start» per role and language from
 * the compiled guide (src/features/help/content/<lang>.json) with headless
 * Chromium into docs/guide/pdf/<lang>/quick-start-<role>.pdf (A4, a cover,
 * the section at the top of each page, «page X of Y» at the bottom), and
 * records each in docs/guide/pdf/manifest.json with the app version.
 * `ru` / `en` / `uz` as arguments limit the languages. The app serves the
 * files at /guide/pdf/… (vite.config.ts copies them into the build).
 *
 * Screenshots go in as JPEG copies sized for the printed width: Chromium
 * embeds a JPEG as is, anything else it re-compresses losslessly.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from '@playwright/test'
import { LANGS, readJson, SHOT_URL, type HelpBundle } from './content.ts'
import { OUT, QUICK_START, ROLES, buildDate, pageCount, render, root, version, type PdfManifest } from './print.ts'

const JPEG_QUALITY = 0.7
/** Pixels per CSS pixel of the printed size (≈ 135 dpi). */
const PRINT_PX_PER_CSS = 1.4
/** The A4 text width in CSS px: a full-window shot prints at it. */
const TEXT_WIDTH_CSS = 658

async function jpegCopies(browser: Browser, b: HelpBundle, lang: string, tmp: string): Promise<Map<string, string>> {
  const wanted = new Set(Object.values(QUICK_START).flat())
  const re = new RegExp(`src="${SHOT_URL}/([\\w-]+/[\\w.-]+)"`, 'g')
  const files = [...new Set(Object.values(b.topics).filter((t) => wanted.has(t.id)).flatMap((t) => [...t.html.matchAll(re)].map((m) => m[1])))]
  const out = new Map<string, string>()
  const page = await browser.newPage()
  await page.goto(pathToFileURL(path.join(root, 'docs/guide/README.md')).href)
  for (const rel of files) {
    const src = path.join(root, 'docs/guide/shots', rel)
    if (!fs.existsSync(src)) continue
    const url = await page.evaluate(
      async ({ src, q, perCss, textWidth }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const printedCss = Math.min(img.naturalWidth / 2, textWidth)
        const k = Math.min(1, (printedCss * perCss) / img.naturalWidth)
        const c = document.createElement('canvas')
        c.width = Math.round(img.naturalWidth * k)
        c.height = Math.round(img.naturalHeight * k)
        const g = c.getContext('2d')!
        g.fillStyle = '#fff'
        g.fillRect(0, 0, c.width, c.height)
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, 0, 0, c.width, c.height)
        return c.toDataURL('image/jpeg', q)
      },
      { src: pathToFileURL(src).href, q: JPEG_QUALITY, perCss: PRINT_PX_PER_CSS, textWidth: TEXT_WIDTH_CSS },
    )
    const dest = path.join(tmp, 'jpeg', `${rel.replace(/\.\w+$/, '')}.jpg`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))
    out.set(rel, dest)
  }
  await page.close()
  console.log(`guide:pdf: ${lang}: ${out.size} screenshot(s) as JPEG`)
  return out
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files'],
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  })
  const written: PdfManifest['files'] = {}
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-pdf-'))
  try {
    for (const lang of LANGS) {
      if (only.length && !only.includes(lang)) continue
      const bundle = readJson<HelpBundle | null>(path.join(root, `src/features/help/content/${lang}.json`), null)
      if (!bundle || !bundle.sections.length) {
        console.warn(`guide:pdf: no content for ${lang} (npm run guide:content first)`)
        continue
      }
      const locale = readJson<Record<string, unknown>>(path.join(root, `src/i18n/locales/${lang}.json`), {})
      fs.mkdirSync(path.join(OUT, lang), { recursive: true })
      const jpegs = await jpegCopies(browser, bundle, lang, tmp)
      for (const role of ROLES) {
        const page = await browser.newPage()
        const file = path.join(tmp, `${lang}-${role}.html`)
        fs.writeFileSync(
          file,
          render(role, bundle, lang, locale, (l, f) => pathToFileURL(jpegs.get(`${l}/${f}`) ?? path.join(root, 'docs/guide/shots', l, f)).href),
        )
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready)
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: false, outline: true })
        const name = `quick-start-${role}.pdf`
        fs.writeFileSync(path.join(OUT, lang, name), pdf)
        written[`${lang}/${name}`] = { version, date: buildDate, pages: pageCount(pdf) }
        console.log(`guide:pdf: ${lang}/${name} — ${pageCount(pdf)} pages, ${(pdf.length / 1024).toFixed(0)} KB`)
        await page.close()
      }
    }
    const manifest = path.join(OUT, 'manifest.json')
    const m = readJson<PdfManifest>(manifest, { files: {} })
    for (const [k, v] of Object.entries(written)) m.files[k] = v
    const files = Object.fromEntries(Object.entries(m.files).sort(([x], [y]) => x.localeCompare(y)))
    fs.writeFileSync(manifest, `${JSON.stringify({ files }, null, 1)}\n`)
  } finally {
    await browser.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
