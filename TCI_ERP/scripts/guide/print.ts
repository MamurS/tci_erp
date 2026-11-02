/**
 * The quick-start PDFs' print layout (scripts/guide/pdf.ts prints with it).
 * One short document per role and language: a cover, then the topics in
 * QUICK_START — the first steps every staff member needs, and the role's own
 * section introduction and working day (the portal's for a client).
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROLES, SHOT_URL, readJson, type HelpBundle, type Role, type TopicOut } from './content.ts'
import { escapeHtml, lookup, type Lang } from './markdown.ts'

export const root = path.resolve(import.meta.dirname, '../..')
export const OUT = path.join(root, 'docs/guide/pdf')
export const version = readJson<{ version: string }>(path.join(root, 'package.json'), { version: '0.0.0' }).version
export const buildDate = process.env.GUIDE_DATE ?? new Date().toISOString().slice(0, 10)

/** Getting started, for every staff role. */
const STAFF_START = ['start-sign-in', 'start-layout', 'start-workspaces', 'start-agenda']

/** The topics of each role's quick start, in reading order (ids of docs/guide). */
export const QUICK_START: Record<Role, string[]> = {
  sales: [...STAFF_START, 'sales', 'sales-daily'],
  commercial_underwriter: [...STAFF_START, 'commercial', 'commercial-daily'],
  credit_analyst: [...STAFF_START, 'analysis', 'analysis-daily'],
  credit_underwriter: [...STAFF_START, 'credit', 'credit-daily'],
  information_manager: [...STAFF_START, 'data', 'data-daily'],
  claims: [...STAFF_START, 'claims', 'claims-daily'],
  admin: [...STAFF_START, 'admin', 'admin-daily'],
  client: ['portal', 'portal-sign-in', 'portal-policies'],
}

export interface PdfManifest {
  files: Record<string, { version: string; date: string; pages: number }>
}

/** The PDF files of one language (relative to docs/guide/pdf/<lang>/). */
export const pdfFiles = (): string[] => ROLES.map((r) => `quick-start-${r}.pdf`)

const fileUrl = (p: string) => pathToFileURL(p).href
const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** A locale string with {{values}} filled in (the PDF's labels live in the locales: help.pdf.*). */
export function label(locale: Record<string, unknown>, key: string, values: Record<string, string> = {}): string {
  const s = lookup(locale, key) ?? key
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => values[k] ?? m)
}

/** Where the print reads a screenshot (lang, file name) — pdf.ts hands in JPEG copies. */
export type ShotSrc = (lang: string, file: string) => string
const shotFile: ShotSrc = (l, f) => fileUrl(path.join(root, 'docs/guide/shots', l, f))

function topicHtml(t: TopicOut, inDoc: Set<string>, shot: ShotSrc): string {
  const shots = new RegExp(`src="${SHOT_URL}/([\\w-]+)/([\\w.-]+)"`, 'g')
  return t.html
    .replace(shots, (_, l: string, f: string) => `src="${shot(l, f)}"`)
    .replace(/ loading="lazy"/g, '')
    .replace(/<a ([^>]*)href="\/help\/([\w-]+)(?:#([\w-]+))?"([^>]*)>([\s\S]*?)<\/a>/g, (_, pre: string, id: string, anchor: string | undefined, post: string, text: string) =>
      inDoc.has(id) ? `<a ${pre}href="#${anchor ?? `t-${id}`}"${post}>${text}</a>` : `<span class="xref">${text}</span>`,
    )
    // other app links mean nothing on paper
    .replace(/<a ([^>]*)href="\/([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, '<span class="xref">$4</span>')
}

/** The HTML of one role's quick start in one language. */
export function render(role: Role, b: HelpBundle, lang: Lang, locale: Record<string, unknown>, shot: ShotSrc = shotFile): string {
  const topics = QUICK_START[role].map((id) => b.topics[id]).filter((t): t is TopicOut => Boolean(t))
  const inDoc = new Set(topics.map((t) => t.id))
  const roleName = label(locale, `roles.${role}`)
  const title = label(locale, 'help.pdf.title', { role: roleName })
  const page = label(locale, 'help.pdf.page', { page: '@@PAGE@@', pages: '@@PAGES@@' })
  // "Page X of Y" in the language's own word order, as CSS content
  const pageCss = page
    .split(/(@@PAGES?@@)/)
    .filter(Boolean)
    .map((part) => (part === '@@PAGE@@' ? 'counter(page)' : part === '@@PAGES@@' ? 'counter(pages)' : cssString(part)))
    .join(' ')
  const body = topics
    .map(
      (t) =>
        `<article class="topic${t.index ? ' intro' : ''}" id="t-${t.id}"><h2 class="topic-title">${escapeHtml(t.title)}</h2>${topicHtml(t, inDoc, shot)}</article>`,
    )
    .join('')
  const font = (p: string) => fileUrl(path.join(root, 'node_modules', p))
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${font('@fontsource-variable/inter/index.css')}">
<link rel="stylesheet" href="${font('@fontsource/pt-sans-narrow/400.css')}">
<link rel="stylesheet" href="${font('@fontsource/pt-sans-narrow/700.css')}">
<style>
@page { size: A4; margin: 20mm 16mm 18mm 18mm;
  @top-left { content: ${cssString(title)}; font: 8pt 'Inter Variable', sans-serif; color: #666; }
  @top-right { content: ${cssString(`TCI ERP · ${label(locale, 'help.pdf.version', { version })}`)}; font: 8pt 'Inter Variable', sans-serif; color: #666; }
  @bottom-right { content: ${pageCss}; font: 8pt 'Inter Variable', sans-serif; color: #666; }
}
@page cover { margin: 0; @top-left { content: none; } @top-right { content: none; } @bottom-right { content: none; } }
:root { --brand: #124f84; --ink: #23211e; --muted: #635d58; --line: #e5e2de; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10pt/1.5 'Inter Variable', Inter, sans-serif; color: var(--ink); }
.cover { page: cover; height: 297mm; padding: 60mm 22mm 25mm; display: flex; flex-direction: column; background: linear-gradient(160deg, #e9f3ff, #ffffff 60%); break-after: page; }
.logo { width: 22mm; height: 22mm; border-radius: 4mm; background: #0a3c68; color: #fff; display: flex; align-items: center; justify-content: center; font: 700 14pt 'PT Sans Narrow', sans-serif; }
.cover .app { margin-top: 14mm; font: 700 30pt/1.1 'PT Sans Narrow', sans-serif; }
.cover .sub { margin-top: 2mm; font-size: 12pt; color: var(--muted); }
.cover .title { margin-top: 6mm; font: 600 20pt/1.2 'Inter Variable', sans-serif; color: var(--brand); }
.cover .meta { margin-top: auto; font-size: 10pt; color: var(--muted); line-height: 1.8; }
.topic { margin-top: 8mm; }
.topic.intro { break-before: page; margin-top: 0; }
.topic:first-of-type { margin-top: 0; }
.topic-title { font: 600 14pt/1.3 'Inter Variable', sans-serif; color: var(--brand); border-bottom: 1px solid var(--line); padding-bottom: 1.5mm; margin: 0 0 3mm; break-after: avoid; }
.topic h2 { font-size: 11.5pt; margin: 5mm 0 2mm; break-after: avoid; }
.topic h3, .topic h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2mm; orphans: 3; widows: 3; }
ol, ul { margin: 0 0 2mm; padding-left: 6mm; }
li { margin: 0.8mm 0; }
ol > li::marker { font-weight: 700; color: var(--brand); }
a { color: var(--brand); }
.xref { font-style: italic; }
b.help-ui, strong { font-weight: 600; }
code, kbd { font-size: 9pt; border: 1px solid var(--line); border-radius: 1mm; padding: 0 1mm; background: #f3f1ef; }
figure.help-shot { margin: 3mm 0 4mm; break-inside: avoid; }
figure.help-shot img { display: block; max-width: 100%; max-height: 120mm; width: auto; height: auto; border: 1px solid var(--line); border-radius: 1.5mm; }
.help-shot-missing { border: 1px solid #aaa; padding: 8mm; text-align: center; color: var(--muted); }
.help-callout { border-left: 3pt solid #2e5ab1; background: #ebf3ff; padding: 2mm 3mm; margin: 2mm 0 3mm; break-inside: avoid; border-radius: 1mm; }
.help-callout-tip { border-color: #008048; background: #effef3; }
.help-callout-warning { border-color: #9c6300; background: #fff9f4; }
.help-callout-demo { border-color: #0078a2; background: #f5fbff; }
.help-callout > :last-child { margin-bottom: 0; }
.help-table table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 2mm 0 3mm; }
.help-table th, .help-table td { border-bottom: 1px solid var(--line); padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
.help-table th { background: #f3f1ef; font-weight: 600; }
.help-table tr { break-inside: avoid; }
</style></head><body>
<section class="cover"><div class="logo">TCI</div><div class="app">TCI ERP</div><div class="sub">${escapeHtml(label(locale, 'help.pdf.subtitle'))}</div><div class="title">${escapeHtml(title)}</div>
<div class="meta">${escapeHtml(label(locale, 'help.pdf.version', { version }))}<br>${buildDate.split('-').reverse().join('.')}</div></section>
${body}
</body></html>`
}

/** The page count of a Chromium PDF (its root page tree's /Count). */
export function pageCount(pdf: Buffer): number {
  const s = pdf.toString('latin1')
  const rootRef = /\/Root (\d+) 0 R/.exec(s)
  const cat = rootRef ? (new RegExp(`(?:^|[\\r\\n])${rootRef[1]} 0 obj([\\s\\S]*?)endobj`).exec(s)?.[1] ?? '') : ''
  const pages = /\/Pages (\d+) 0 R/.exec(cat)
  const po = pages ? (new RegExp(`(?:^|[\\r\\n])${pages[1]} 0 obj([\\s\\S]*?)endobj`).exec(s)?.[1] ?? '') : ''
  return Number(/\/Count (\d+)/.exec(po)?.[1] ?? 0)
}

export { ROLES }
