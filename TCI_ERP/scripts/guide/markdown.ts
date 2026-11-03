/**
 * The user guide’s Markdown dialect (docs/guide/README.md): YAML-ish front
 * matter, a CommonMark subset and the {{ui:…}} / {{term:…}} / {{link:…}} /
 * {{shot:…}} tokens. Pure functions — no file system — so the content build,
 * the checks and the unit tests share them.
 */

export type FrontMatter = Record<string, string | number | string[]>

export function parseFrontMatter(src: string): { data: FrontMatter | null; body: string; bodyLine: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)
  if (!m) return { data: null, body: src, bodyLine: 1 }
  const data: FrontMatter = {}
  for (const raw of m[1].split(/\r?\n/)) {
    const line = stripComment(raw).trimEnd()
    if (!line.trim()) continue
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) throw new Error(`front matter: cannot read «${raw.trim()}»`)
    data[kv[1]] = parseValue(kv[2].trim())
  }
  return { data, body: src.slice(m[0].length), bodyLine: m[0].split('\n').length }
}

/** Drops a `# comment` that is outside quotes. */
function stripComment(line: string): string {
  let q: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function unquote(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

function parseValue(v: string): string | number | string[] {
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`front matter: unclosed list «${v}»`)
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    const out: string[] = []
    let cur = ''
    let q: string | null = null
    for (const c of inner) {
      if (q) {
        if (c === q) q = null
        cur += c
      } else if (c === '"' || c === "'") {
        q = c
        cur += c
      } else if (c === ',') {
        out.push(unquote(cur))
        cur = ''
      } else cur += c
    }
    out.push(unquote(cur))
    return out.filter((s) => s !== '')
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return unquote(v)
}

// ---------------------------------------------------------------------------

export type Lang = 'ru' | 'en' | 'uz'

export type Heading = { id: string; text: string; level: number }

/** How the build resolves tokens; each returns HTML (already escaped) or throws a message. */
export interface Resolver {
  ui(key: string): string
  term(id: string, text?: string): string
  link(id: string, text?: string): string
  shot(id: string): string
}

export type Token = { kind: 'ui' | 'term' | 'link' | 'shot'; arg: string; text?: string }

export const TOKEN_RE = /\{\{(ui|term|link|shot):([^}|]+?)(?:\|([^}]*))?\}\}/g

export function tokensOf(src: string): Token[] {
  const out: Token[] = []
  for (const m of src.matchAll(TOKEN_RE)) out.push({ kind: m[1] as Token['kind'], arg: m[2].trim(), text: m[3]?.trim() })
  return out
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A heading's anchor: lower case, letters (any script) and digits, hyphens. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[ʻʼ‘’'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

export const CALLOUTS = ['note', 'tip', 'warning', 'demo'] as const

export interface RenderResult {
  html: string
  headings: Heading[]
  /** Shot ids in order of appearance. */
  shots: string[]
  errors: string[]
}

interface Ctx {
  resolver: Resolver
  /** Prefix for generated heading anchors (topic id), so ids are unique in a whole PDF. */
  anchorPrefix: string
  headings: Heading[]
  shots: string[]
  errors: string[]
  usedAnchors: Set<string>
}

/** Markdown body → HTML. Errors (unknown keys, bad tokens) are collected, not thrown. */
export function renderMarkdown(body: string, resolver: Resolver, anchorPrefix: string): RenderResult {
  const ctx: Ctx = { resolver, anchorPrefix, headings: [], shots: [], errors: [], usedAnchors: new Set() }
  const lines = body
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\t/g, '    ')
    .split('\n')
  // a leading «# Title» repeats the front matter title: the page shows that one
  const first = lines.findIndex((l) => !isBlank(l))
  if (first >= 0 && /^#\s/.test(lines[first])) lines.splice(first, 1)
  const html = blocks(lines, ctx)
  return { html, headings: ctx.headings, shots: ctx.shots, errors: ctx.errors }
}

const indentOf = (l: string) => /^ */.exec(l)![0].length
const isBlank = (l: string) => !l.trim()
const LIST_RE = /^( *)([-*]|\d+[.)])\s+(.*)$/
const HR_RE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/
const SHOT_LINE = /^\s*\{\{shot:([^}|]+)\}\}\s*$/

function blocks(lines: string[], ctx: Ctx): string {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    // fenced code
    if (/^\s*```/.test(line)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }
    // heading
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      out.push(heading(h[1].length, h[2], ctx))
      i++
      continue
    }
    if (HR_RE.test(line)) {
      out.push('<hr>')
      i++
      continue
    }
    // screenshot on its own line
    const s = SHOT_LINE.exec(line)
    if (s) {
      const id = s[1].trim()
      ctx.shots.push(id)
      out.push(safe(ctx, () => ctx.resolver.shot(id), `{{shot:${id}}}`))
      i++
      continue
    }
    // blockquote / callout
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ''))
      const c = /^\[!(\w+)\]\s*(.*)$/.exec(buf[0] ?? '')
      if (c) {
        const kind = c[1].toLowerCase()
        if (!(CALLOUTS as readonly string[]).includes(kind)) ctx.errors.push(`unknown callout [!${c[1]}] (use ${CALLOUTS.map((k) => `[!${k.toUpperCase()}]`).join(', ')})`)
        const rest = [c[2], ...buf.slice(1)]
        out.push(`<div class="help-callout help-callout-${escapeHtml(kind)}">${blocks(rest, ctx)}</div>`)
      } else out.push(`<blockquote>${blocks(buf, ctx)}</blockquote>`)
      continue
    }
    // table
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[][] = []
      const head = cells(line)
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''))
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      const td = (tag: string, c: string, k: number) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, ctx)}</${tag}>`
      out.push(
        `<div class="help-table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      )
      continue
    }
    // list
    const li = LIST_RE.exec(line)
    if (li) {
      const base = li[1].length
      const ordered = /\d/.test(li[2])
      const start = ordered ? parseInt(li[2], 10) : 1
      const items: string[] = []
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i])
        if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break
        const contentIndent = m[1].length + m[2].length + 1
        const body: string[] = [m[3]]
        i++
        // the item continues with indented lines (and blank lines followed by indented ones)
        while (i < lines.length) {
          const l = lines[i]
          if (isBlank(l)) {
            let j = i
            while (j < lines.length && isBlank(lines[j])) j++
            if (j < lines.length && indentOf(lines[j]) > base && !(LIST_RE.test(lines[j]) && indentOf(lines[j]) === base)) {
              body.push('')
              i++
              continue
            }
            break
          }
          if (indentOf(l) <= base) break
          body.push(l.slice(Math.min(indentOf(l), contentIndent)))
          i++
        }
        const loose = body.some(isBlank) || body.length > 1 && body.slice(1).some((l) => SHOT_LINE.test(l) || LIST_RE.test(l))
        const inner = loose || body.length > 1 ? blocks(body, ctx) : inline(body[0], ctx)
        items.push(`<li>${inner}</li>`)
      }
      out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`)
      continue
    }
    // paragraph
    const buf: string[] = []
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !SHOT_LINE.test(lines[i]) &&
      !(buf.length && LIST_RE.test(lines[i])) &&
      !HR_RE.test(lines[i])
    )
      buf.push(lines[i++].trim())
    if (!buf.length) {
      // a line no rule took (cannot happen, but never loop forever)
      buf.push(lines[i++].trim())
    }
    out.push(`<p>${inline(buf.join('\n'), ctx)}</p>`)
  }
  return out.join('\n')
}

function cells(row: string): string[] {
  let r = row.trim()
  if (r.startsWith('|')) r = r.slice(1)
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1)
  return r.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function heading(level: number, raw: string, ctx: Ctx): string {
  let text = raw
  let id: string | null = null
  const a = /\s*\{#([\w-]+)\}\s*$/.exec(text)
  if (a) {
    id = a[1]
    text = text.slice(0, a.index)
  }
  const html = inline(text, ctx)
  const plain = stripTags(html)
  if (!id) {
    const base = `${ctx.anchorPrefix}--${slugify(plain) || 'section'}`
    id = base
    for (let n = 2; ctx.usedAnchors.has(id); n++) id = `${base}-${n}`
  } else if (ctx.usedAnchors.has(id)) ctx.errors.push(`duplicate anchor {#${id}}`)
  ctx.usedAnchors.add(id)
  ctx.headings.push({ id, text: plain, level })
  // h1 in the body is demoted: the topic title is the page's h1
  const tag = `h${Math.max(2, level)}`
  return `<${tag} id="${escapeHtml(id)}">${html}</${tag}>`
}

function safe(ctx: Ctx, fn: () => string, src: string): string {
  try {
    return fn()
  } catch (e) {
    ctx.errors.push(`${src}: ${(e as Error).message}`)
    return `<span class="help-error">${escapeHtml(src)}</span>`
  }
}

/** Inline Markdown: code, tokens, links, bold, italic, <kbd>, line breaks. */
function inline(src: string, ctx: Ctx): string {
  const slots: string[] = []
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`
  let s = src
  s = s.replace(/`([^`]+)`/g, (_, c: string) => hold(`<code>${escapeHtml(c)}</code>`))
  s = s.replace(TOKEN_RE, (m, kind: string, arg: string, text?: string) => {
    const a = arg.trim()
    const tx = text?.trim()
    return hold(
      safe(ctx, () => {
        if (kind === 'ui') return ctx.resolver.ui(a)
        if (kind === 'term') return ctx.resolver.term(a, tx)
        if (kind === 'link') return ctx.resolver.link(a, tx)
        throw new Error('a screenshot must stand on its own line')
      }, m),
    )
  })
  s = s.replace(/<kbd>([^<]{1,30})<\/kbd>/g, (_, k: string) => hold(`<kbd>${escapeHtml(k)}</kbd>`))
  s = s.replace(/<br\s*\/?>/g, () => hold('<br>'))
  s = escapeHtml(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, url: string) => {
    if (!/^(https?:|mailto:|\/)/.test(url)) {
      ctx.errors.push(`link «${url}»: use {{link:<topic id>}} for manual pages, or a full https:// / app-root / URL`)
      return t
    }
    const ext = /^https?:/.test(url)
    return `<a href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${t}</a>`
  })
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^\p{L}\p{N}*])\*(?!\s)(.+?)(?<!\s)\*(?![\p{L}\p{N}*])/gu, '$1<em>$2</em>')
  s = s.replace(/ {2,}\n/g, '<br>').replace(/\n/g, ' ')
  // eslint-disable-next-line no-control-regex
  for (let k = 0; k < 3 && s.includes('\u0000'); k++) s = s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => slots[Number(n)])
  return s
}

export function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?»)])/g, '$1')
    .replace(/([«(])\s+/g, '$1')
    .trim()
}

/** Looks up `a.b.c` in a locale object; strings only. */
export function lookup(obj: unknown, path: string): string | undefined {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}
