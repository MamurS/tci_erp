/**
 * The guide's compiled HTML on screen — as React elements, never as an HTML
 * string in the DOM (eslint refuses dangerouslySetInnerHTML outside the
 * sandboxed offer frame, DESIGN.md). The HTML comes from the repository's own
 * Markdown (scripts/guide/markdown.ts escapes every text it emits), and it is
 * still read through an allowlist: an unknown tag renders as its text, an
 * unknown attribute is dropped.
 *
 * Internal links stay in the app (react-router), and point into the Help
 * centre the reader is in (/help or /portal/help); the query's words are
 * marked in the text.
 */
import { Fragment, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { helpHref } from './pages'
import { matchRanges } from './search'

/** Tag → the classes it carries (tokens only: the scale and contrast tests read them). */
const TAG_CLASS: Record<string, string> = {
  p: 'mt-3 first:mt-0',
  h2: 'mt-8 scroll-mt-24 text-title font-semibold text-slate-900 first:mt-0',
  h3: 'mt-6 scroll-mt-24 text-lead font-semibold text-slate-900',
  h4: 'mt-4 scroll-mt-24 text-body font-semibold text-slate-900',
  ol: 'mt-3 list-decimal space-y-2 pl-6 marker:font-semibold marker:text-accent-700',
  ul: 'mt-3 list-disc space-y-2 pl-6 marker:text-slate-500',
  li: 'pl-1',
  strong: 'font-semibold',
  b: 'font-semibold text-slate-900',
  em: 'italic',
  code: 'rounded-sm border border-slate-200 bg-slate-100 px-1 font-mono text-small',
  kbd: 'rounded-sm border border-slate-300 bg-white px-1 font-mono text-small text-slate-700 shadow-card',
  pre: 'mt-3 overflow-x-auto rounded-md bg-slate-100 p-3 text-small',
  blockquote: 'mt-3 border-l-2 border-slate-200 pl-4 text-slate-600',
  hr: 'my-6 border-slate-200',
  figure: 'mt-4',
  figcaption: 'p-8 text-center text-small text-slate-500',
  img: 'block h-auto max-w-full rounded-lg border border-slate-200 shadow-card',
  table: 'w-full border-collapse text-small',
  thead: '',
  tbody: '',
  tr: '',
  th: 'border-b border-slate-200 bg-slate-100 px-3 py-2 text-left align-bottom font-semibold text-slate-800',
  td: 'border-b border-slate-100 px-3 py-2 align-top',
  br: '',
  span: '',
  div: '',
  a: 'text-accent-700 underline underline-offset-2 hover:text-accent-900',
}

/** Classes of the compiler's own `help-*` classes, added to the tag's. */
const HELP_CLASS: Record<string, string> = {
  'help-term': 'decoration-dotted',
  'help-table': 'mt-4 overflow-x-auto rounded-lg border border-slate-200',
  'help-callout': 'mt-4 rounded-md border-l-4 px-4 py-3 text-slate-800',
  'help-callout-note': 'border-info-500 bg-info-50',
  'help-callout-tip': 'border-success-500 bg-success-50',
  'help-callout-warning': 'border-warning-500 bg-warning-50',
  'help-callout-demo': 'border-sky-400 bg-sky-50',
  'help-shot-missing': 'rounded-lg border border-dashed border-slate-300',
  'help-error': 'font-mono text-danger-700',
  'help-ui': '',
  'help-link': '',
  'help-shot': '',
}

const ATTRS = new Set(['id', 'src', 'alt', 'width', 'height', 'start', 'loading', 'decoding'])

interface Ctx {
  base: string
  words: readonly string[]
  key: number
}

function marked(text: string, ctx: Ctx): ReactNode {
  if (!ctx.words.length) return text
  const ranges = matchRanges(text, ctx.words)
  if (!ranges.length) return text
  const out: ReactNode[] = []
  let at = 0
  for (const [a, b] of ranges) {
    out.push(text.slice(at, a), <mark key={ctx.key++} className="rounded-sm bg-warning-100 ring-1 ring-warning-400">{text.slice(a, b)}</mark>)
    at = b
  }
  out.push(text.slice(at))
  return <Fragment key={ctx.key++}>{out}</Fragment>
}

function toReact(node: Node, ctx: Ctx): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return marked(node.textContent ?? '', ctx)
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const children = Array.from(el.childNodes).map((c) => toReact(c, ctx))
  if (!(tag in TAG_CLASS)) return <Fragment key={ctx.key++}>{children}</Fragment>
  const own = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c in HELP_CLASS)
  const className = [TAG_CLASS[tag], ...own.map((c) => HELP_CLASS[c])].filter(Boolean).join(' ') || undefined
  const key = ctx.key++
  const props: Record<string, unknown> = { className }
  for (const a of Array.from(el.attributes)) if (ATTRS.has(a.name)) props[a.name] = a.value
  if (tag === 'th' || tag === 'td') {
    const align = /text-align:\s*(left|right|center)/.exec(el.getAttribute('style') ?? '')?.[1]
    if (align) props.className = `${className ?? ''} ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`
  }
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? ''
    if (href.startsWith('/')) {
      return (
        <Link key={key} to={helpHref(href, ctx.base)} className={className}>
          {children}
        </Link>
      )
    }
    if (!/^(https?:|mailto:)/.test(href)) return <Fragment key={ctx.key++}>{children}</Fragment>
    return (
      <a key={key} href={href} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  if (tag === 'img' || tag === 'br' || tag === 'hr') {
    if (tag === 'img' && !String(props.src ?? '').startsWith('/guide/')) return null
    const Void = tag as 'img'
    return <Void key={key} {...props} />
  }
  const Tag = tag as 'div'
  return (
    <Tag key={key} {...props}>
      {children}
    </Tag>
  )
}

/** The compiled HTML of one topic, as React. */
export function HtmlView({ html, base, words = [] }: { html: string; base: string; words?: readonly string[] }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const ctx: Ctx = { base, words, key: 0 }
    return Array.from(doc.body.childNodes).map((n) => toReact(n, ctx))
  }, [html, base, words])
  return <div className="max-w-4xl text-body leading-relaxed text-slate-800">{nodes}</div>
}
