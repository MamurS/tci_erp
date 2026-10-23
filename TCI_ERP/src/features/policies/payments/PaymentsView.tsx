/**
 * «Платежи» — a view of «Полисы» for the commercial desk (Prompt 23,
 * migration 0056): bank statements in, premium payments out.
 *
 * A statement is read in the browser with the bank's saved column layout and
 * imported; the database matches every incoming payment against invoice and
 * policy numbers in its purpose text, its amount and its date. Confident
 * matches are confirmed in one click; what needs a person waits in «Не
 * распознаны» here and as an Agenda task (`premium_payment_unmatched`, which
 * links back with `?import=<id>`). A payment typed by hand on the policy's
 * «Премия» tab stays the audited fallback.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Landmark } from 'lucide-react'

import { COL, Count, EmptyState, SectionTitle, Skeleton, Table, ViewBar } from '../../../components/ui'
import { EM_DASH, formatMoment } from '../../../lib/format'
import { DEEP_LINK_SCROLL_MARGIN, useDeepLinkFocus } from '../../../lib/useDeepLinkFocus'
import { useStaffDirectory } from '../../data/api'
import { useBankImports } from './api'
import { ImportCard } from './ImportCard'
import { ImportLines } from './ImportLines'
import { pickImport } from './lines'

const LINES_ANCHOR_ID = 'bank-import-lines'
/** A count under a one-word heading («Совпадения», «Aniqlanmagan») that must not be cut. */
const COUNT = '8.5rem'

export function PaymentsView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [params, setParams] = useSearchParams()
  const { data: imports, isLoading } = useBankImports()
  const { data: staff } = useStaffDirectory()
  // Only an address that arrived with ?import= (the Agenda's link) scrolls.
  const [linked] = useState(() => params.get('import'))

  const requested = params.get('import')
  const selected = useMemo(() => pickImport(imports ?? [], requested), [imports, requested])
  useDeepLinkFocus(linked && selected?.id === linked ? LINES_ANCHOR_ID : null, { ready: Boolean(selected) })

  const select = (id: string) =>
    setParams(
      (current) => {
        const out = new URLSearchParams(current)
        out.set('import', id)
        return out
      },
      { replace: true },
    )

  const who = (id: string | null) => {
    if (!id) return EM_DASH
    const person = staff?.get(id)
    return person ? (person.full_name ?? person.email) : EM_DASH
  }

  return (
    <div>
      <ViewBar hint={t('premium.bank.viewHint')} />

      <div className="flex flex-col gap-8">
        <ImportCard onImported={select} />

        {isLoading ? (
          <Skeleton className="h-32" />
        ) : !imports?.length ? (
          <EmptyState
            icon={<Landmark />}
            title={t('premium.bank.empty.title')}
            hint={t('premium.bank.empty.hint')}
          />
        ) : (
          <section className="flex flex-col gap-3">
            <SectionTitle hint={t('premium.bank.imports.hint')}>{t('premium.bank.imports.title')}</SectionTitle>
            {/* Narrow enough for a laptop: the line count is in the statement's own heading. */}
            <Table columns={[COL.moment, COL.fill, COUNT, COUNT, COUNT, COL.person]} fillMin="10rem">
              <thead>
                <tr>
                  <th>{t('premium.bank.imports.importedAt')}</th>
                  <th>{t('premium.bank.imports.file')}</th>
                  <th className="num">{t('premium.bank.sections.matched')}</th>
                  <th className="num">{t('premium.bank.sections.suggested')}</th>
                  <th className="num">{t('premium.bank.sections.unmatched')}</th>
                  <th>{t('premium.bank.imports.importedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((imp) => {
                  const current = imp.id === selected?.id
                  return (
                    <tr
                      key={imp.id}
                      aria-selected={current}
                      onClick={() => select(imp.id)}
                      className={`cursor-pointer ${current ? 'bg-accent-50 shadow-[inset_3px_0_0_var(--color-accent-500)]' : ''}`}
                    >
                      <td>{formatMoment(imp.imported_at, locale)}</td>
                      <td>
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-medium text-accent-600 hover:underline focus-visible:outline-2 focus-visible:outline-accent-500"
                          onClick={(e) => {
                            e.stopPropagation()
                            select(imp.id)
                          }}
                        >
                          {imp.file_name ?? t('premium.bank.imports.noName')}
                        </button>
                      </td>
                      <td className="num">{imp.counts.matched}</td>
                      <td className="num">{imp.counts.suggested}</td>
                      <td className="num">
                        {imp.counts.unmatched ? (
                          <Count value={imp.counts.unmatched} className="bg-warn-50 text-slate-800 ring-1 ring-warn-500/40 ring-inset" />
                        ) : (
                          0
                        )}
                      </td>
                      <td>{who(imp.imported_by)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </section>
        )}

        {selected && (
          <section id={LINES_ANCHOR_ID} className={`flex flex-col gap-4 ${DEEP_LINK_SCROLL_MARGIN}`}>
            <SectionTitle
              rule
              hint={t('premium.bank.lines.hint', {
                lines: selected.line_count,
                when: formatMoment(selected.imported_at, locale),
              })}
            >
              {t('premium.bank.lines.title', { file: selected.file_name ?? t('premium.bank.imports.noName') })}
            </SectionTitle>
            {/* Keyed: what a visit holds in place belongs to one import. */}
            <ImportLines key={selected.id} importId={selected.id} />
          </section>
        )}
      </div>
    </div>
  )
}
