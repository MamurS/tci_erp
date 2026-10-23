/** Two versions side by side or inline, insertions underlined in green and
 * deletions struck through in red (never colour alone). Default: the
 * current version against the one before it. */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Callout, Field, PanelGrid, Segmented, Select, Spinner } from '../../components/ui'
import type { VersionMeta } from './api'
import { useVersion } from './api'
import { diffDocs, diffSummary } from './diff'
import type { DiffLine, Segment } from './diff'
import { sheetStyle } from './sheet'
import './contractDoc.css'

export type CompareLayout = 'inline' | 'side'

function Segments({ segments, side }: { segments: readonly Segment[]; side: 'both' | 'before' | 'after' }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.op === 'equal') return <span key={i}>{s.text}</span>
        if (s.op === 'insert') return side === 'before' ? null : <ins key={i} className="cd-ins">{s.text}</ins>
        return side === 'after' ? null : <del key={i} className="cd-del">{s.text}</del>
      })}
    </>
  )
}

function LineView({ line, side }: { line: DiffLine; side: 'both' | 'before' | 'after' }) {
  const { t } = useTranslation()
  // one side of a side-by-side keeps an empty line where the other has one,
  // so the two columns stay aligned
  const shown = side === 'before' ? line.before : side === 'after' ? line.after : (line.after ?? line.before)
  if (!shown) return <p className="cd-diff-line" aria-hidden>&nbsp;</p>
  const label = side === 'before' ? line.before?.label : (line.after?.label ?? line.before?.label)
  const renumbered = side === 'both' && line.before && line.after && line.before.label !== line.after.label
  const segments: Segment[] =
    line.op === 'change'
      ? line.segments
      : line.op === 'insert'
        ? side === 'before'
          ? []
          : line.segments
        : line.op === 'delete'
          ? side === 'after'
            ? []
            : line.segments
          : [{ op: 'equal', text: shown.text }]
  const className =
    shown.kind === 'title' ? 'text-[1.2em] font-bold' : shown.kind === 'heading' ? 'mt-3 font-bold' : shown.kind === 'row' ? 'cd-diff-row' : ''
  return (
    <p className={`cd-diff-line ${className}`} data-op={line.op === 'equal' ? undefined : line.op}>
      {label && (
        <span className="cd-num" title={renumbered ? t('contractDrafts.compare.renumbered', { from: line.before?.label }) : undefined}>
          {label}
        </span>
      )}
      {shown.kind === 'pageBreak' ? (
        <span className="text-slate-400">{t('contractDrafts.editor.pageBreak')}</span>
      ) : (
        <Segments segments={segments} side={side} />
      )}
    </p>
  )
}

export function CompareView({
  draftId,
  versions,
  older,
  newer,
  layout,
  onChange,
}: {
  draftId: string
  versions: readonly VersionMeta[]
  older: number
  newer: number
  layout: CompareLayout
  onChange: (next: { older?: number; newer?: number; layout?: CompareLayout }) => void
}) {
  const { t } = useTranslation()
  const a = useVersion(draftId, older)
  const b = useVersion(draftId, newer)
  const lines = useMemo(() => (a.data && b.data ? diffDocs(a.data.content, b.data.content) : null), [a.data, b.data])
  const summary = lines ? diffSummary(lines) : null
  const options = versions.map((v) => (
    <option key={v.version_no} value={v.version_no}>
      v{v.version_no} · {t(`contractDrafts.sources.${v.source}`)}
    </option>
  ))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('contractDrafts.compare.older')}>
          <Select value={older} onChange={(e) => onChange({ older: Number(e.target.value) })} className="w-72!">
            {options}
          </Select>
        </Field>
        <Field label={t('contractDrafts.compare.newer')}>
          <Select value={newer} onChange={(e) => onChange({ newer: Number(e.target.value) })} className="w-72!">
            {options}
          </Select>
        </Field>
        <div className="ml-auto">
          <Segmented
            value={layout}
            ariaLabel={t('contractDrafts.compare.layout')}
            options={[
              { key: 'inline', label: t('contractDrafts.compare.inline') },
              { key: 'side', label: t('contractDrafts.compare.side') },
            ]}
            onChange={(key) => onChange({ layout: key as CompareLayout })}
          />
        </div>
      </div>

      {summary && (
        <p className="text-[13px] text-slate-600" aria-live="polite">
          {summary.inserted + summary.deleted + summary.changed === 0
            ? t('contractDrafts.compare.same')
            : t('contractDrafts.compare.summary', {
                inserted: summary.inserted,
                deleted: summary.deleted,
                changed: summary.changed,
              })}
          <span className="ml-3 inline-flex gap-2">
            <ins className="cd-ins px-1">{t('contractDrafts.compare.legendInserted')}</ins>
            <del className="cd-del px-1">{t('contractDrafts.compare.legendDeleted')}</del>
          </span>
        </p>
      )}

      {older === newer && <Callout tone="info" title={t('contractDrafts.compare.sameVersion')} />}

      {!lines ? (
        <Spinner />
      ) : layout === 'inline' ? (
        <article className="cd-sheet" style={sheetStyle(b.data?.content.attrs?.layout)}>
          <div className="cdoc">
            {lines.map((line, i) => (
              <LineView key={i} line={line} side="both" />
            ))}
          </div>
        </article>
      ) : (
        <PanelGrid cols="lg:grid-cols-2" gap="gap-4">
          {(['before', 'after'] as const).map((side) => (
            <article key={side} className="cd-sheet" style={{ ...sheetStyle(b.data?.content.attrs?.layout), padding: '10mm' }}>
              <div className="mb-3 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">
                v{side === 'before' ? older : newer}
              </div>
              <div className="cdoc">
                {lines.map((line, i) => (
                  <LineView key={i} line={line} side={side} />
                ))}
              </div>
            </article>
          ))}
        </PanelGrid>
      )}
    </div>
  )
}
