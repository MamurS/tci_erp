/**
 * The contract document, read-only: the viewer, the portal, the print route
 * and each side of a comparison. Numbers come from numbering.ts; fields are
 * chips on screen (amber when their source has moved) and plain text on
 * paper. The editor shows the same document with the same stylesheet.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { fieldKey } from './mergeFields'
import type { BlockNode, ContractDoc, InlineNode, Mark } from './model'
import { docNumbering } from './numbering'
import { blockAnchor, sheetStyle } from './sheet'
import './contractDoc.css'

function withMarks(marks: readonly Mark[] | undefined, node: ReactNode): ReactNode {
  return (marks ?? []).reduce<ReactNode>((acc, m) => {
    if (m.type === 'bold') return <strong>{acc}</strong>
    if (m.type === 'italic') return <em>{acc}</em>
    return <u>{acc}</u>
  }, node)
}

interface RenderOptions {
  stale: ReadonlySet<string>
  pageBreakLabel: string
}

function Inline({ nodes, opts }: { nodes: readonly InlineNode[] | undefined; opts: RenderOptions }) {
  return (
    <>
      {(nodes ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />
        if (n.type === 'text') return <span key={i}>{withMarks(n.marks, n.text)}</span>
        const stale = opts.stale.has(fieldKey(n.attrs))
        return (
          <span
            key={i}
            className={`cd-field${stale ? ' cd-field-stale' : ''}${n.attrs.value ? '' : ' cd-field-empty'}`}
            data-path={n.attrs.path}
            title={n.attrs.path}
          >
            {withMarks(n.marks, n.attrs.value)}
          </span>
        )
      })}
    </>
  )
}

function Block({
  block,
  label,
  anchor,
  opts,
}: {
  block: BlockNode
  label?: string | null
  anchor?: string
  opts: RenderOptions
}) {
  switch (block.type) {
    case 'heading': {
      const Tag = (`h${block.attrs.level}` as 'h1' | 'h2' | 'h3')
      return (
        <Tag id={anchor} style={{ textAlign: block.attrs.textAlign ?? undefined }}>
          {label && <span className="cd-num">{label}</span>}
          <Inline nodes={block.content} opts={opts} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p id={anchor} style={{ textAlign: block.attrs?.textAlign ?? undefined }}>
          {label && <span className="cd-num">{label}</span>}
          <Inline nodes={block.content} opts={opts} />
        </p>
      )
    case 'bulletList':
    case 'orderedList': {
      const List = block.type === 'bulletList' ? 'ul' : 'ol'
      return (
        <List id={anchor} start={block.type === 'orderedList' ? block.attrs?.start : undefined}>
          {block.content.map((item, i) => (
            <li key={i}>
              {item.content.map((b, k) => (
                <Block key={k} block={b} opts={opts} />
              ))}
            </li>
          ))}
        </List>
      )
    }
    case 'table':
      return (
        <table id={anchor} className={block.attrs?.bordered ? 'cd-bordered' : undefined}>
          <tbody>
            {block.content.map((row, r) => (
              <tr key={r}>
                {row.content.map((cell, c) => {
                  const Cell = cell.type === 'tableHeader' ? 'th' : 'td'
                  return (
                    <Cell key={c} colSpan={cell.attrs?.colspan ?? 1} rowSpan={cell.attrs?.rowspan ?? 1}>
                      {cell.content.map((b, k) => (
                        <Block key={k} block={b} opts={opts} />
                      ))}
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'pageBreak':
      return <hr id={anchor} className="cd-pagebreak" data-label={opts.pageBreakLabel} />
  }
}

export function DocBody({
  doc,
  stale,
  plain = false,
}: {
  doc: ContractDoc
  /** fieldKey()s of fields whose source has changed. */
  stale?: ReadonlySet<string>
  /** Fields as plain text (print, export preview). */
  plain?: boolean
}) {
  const { t } = useTranslation()
  const labels = docNumbering(doc)
  const opts: RenderOptions = { stale: stale ?? new Set(), pageBreakLabel: t('contractDrafts.editor.pageBreak') }
  return (
    <div className={`cdoc${plain ? ' cd-plain' : ''}`}>
      {doc.content.map((block, i) => (
        <Block key={i} block={block} label={labels[i]} anchor={blockAnchor(i)} opts={opts} />
      ))}
    </div>
  )
}

/** The page-like sheet with the document in it. */
export function DocSheet({ doc, stale, plain }: { doc: ContractDoc; stale?: ReadonlySet<string>; plain?: boolean }) {
  return (
    <article className="cd-sheet" style={sheetStyle(doc.attrs?.layout)}>
      <DocBody doc={doc} stale={stale} plain={plain} />
    </article>
  )
}
