/**
 * «Рейтинги агентств» on the company card's rating tab, right under our
 * own grade (0088): the company's public credit ratings by rating agencies
 * — S&P, Moody's, Fitch, national agencies — with scale, term, outlook,
 * the date of the rating action and where it was published. A reference,
 * said so in the panel's hint: our grade above is what decisions use, and
 * nothing that decides reads these.
 *
 * Staff read; the information desk and credit analysts enter a rating
 * action (a new rating, an outlook change, a withdrawal). Every entry stays;
 * «История» lists them.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../../auth/AuthContext'
import {
  Badge,
  Button,
  Callout,
  COL,
  DateInput,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Table,
  Textarea,
} from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { formatDate } from '../../../lib/format'
import { refusalKey } from '../../../lib/refusals'
import { useIsStaffReader } from '../../risk/api'
import {
  AGENCIES,
  agencyName,
  gradeClass,
  isValidAgencyRating,
  mayEnterAgencyRatings,
  OUTLOOKS,
  outlookTone,
  referenceUrl,
  SCALES,
  TERMS,
} from './agencyRatings'
import type { Agency, AgencyOutlook, AgencyScale, AgencyTerm } from './agencyRatings'
import { useAgencyRatingHistory, useAgencyRatings, useSetAgencyRating } from './agencyRatingsApi'
import type { AgencyRating } from './agencyRatingsApi'

export function AgencyRatingsPanel({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const staff = useIsStaffReader()
  const { actingRole } = useAuth()
  const live = useAgencyRatings(entityId)
  const [adding, setAdding] = useState<AgencyRating | 'new' | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const history = useAgencyRatingHistory(entityId, historyOpen)
  const writer = mayEnterAgencyRatings(actingRole)

  if (!staff) return null
  const rows = live.data ?? []

  return (
    <Panel
      title={t('agencyRatings.title')}
      hint={t('agencyRatings.hint')}
      actions={
        <>
          {rows.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
              {historyOpen ? t('agencyRatings.hideHistory') : t('agencyRatings.showHistory')}
            </Button>
          )}
          {writer && (
            <Button size="sm" variant="secondary" onClick={() => setAdding('new')}>
              {t('agencyRatings.add')}
            </Button>
          )}
        </>
      }
    >
      {live.isLoading ? null : rows.length === 0 ? (
        <EmptyState
          pictogram="documents"
          title={t('agencyRatings.empty')}
          hint={t(writer ? 'agencyRatings.emptyHintWriter' : 'agencyRatings.emptyHint')}
        />
      ) : (
        <RatingsTable rows={rows} onUpdate={writer ? (r) => setAdding(r) : undefined} />
      )}
      {historyOpen && (
        <div className="mt-4">
          <p className="mb-2 text-small font-medium text-slate-600">{t('agencyRatings.history')}</p>
          {history.data && <RatingsTable rows={history.data} withEntered />}
        </div>
      )}
      {adding && (
        <AgencyRatingModal entityId={entityId} from={adding === 'new' ? null : adding} onClose={() => setAdding(null)} />
      )}
    </Panel>
  )
}

function RatingsTable({
  rows,
  onUpdate,
  withEntered = false,
}: {
  rows: AgencyRating[]
  onUpdate?: (row: AgencyRating) => void
  withEntered?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const columns = ['11rem', '9rem', '10rem', '15rem', '8rem', COL.fill, ...(onUpdate ? ['9rem'] : [])]
  return (
    <Table dense columns={columns}>
      <thead>
        <tr>
          <th>{t('agencyRatings.fields.agency')}</th>
          <th>{t('agencyRatings.fields.scale')}</th>
          <th>{t('agencyRatings.fields.rating')}</th>
          <th>{t('agencyRatings.fields.outlook')}</th>
          <th>{t('agencyRatings.fields.asOf')}</th>
          <th>{t('agencyRatings.fields.reference')}</th>
          {onUpdate && (
            <th>
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cls = gradeClass(r.agency, r.scale, r.term, r.rating)
          const url = referenceUrl(r.reference)
          return (
            <tr key={r.id}>
              <td className="font-medium text-slate-800">{agencyName(r.agency, r.agency_name)}</td>
              <td className="whitespace-normal text-small text-slate-600">
                {t(`agencyRatings.scale.${r.scale}`)}
                <span className="block text-caption text-slate-500">{t(`agencyRatings.term.${r.term}`)}</span>
              </td>
              <td>
                {r.rating ? (
                  <span className="flex flex-col items-start gap-0.5">
                    <Badge tone="neutral">
                      <span className="font-mono">{r.rating}</span>
                    </Badge>
                    {cls && <span className="text-caption whitespace-normal text-slate-500">{t(`agencyRatings.class.${cls}`)}</span>}
                  </span>
                ) : (
                  <span className="text-small text-slate-500" title={r.note ?? undefined}>
                    {t('agencyRatings.withdrawn')}
                  </span>
                )}
              </td>
              <td>
                {r.outlook ? (
                  <Badge tone={outlookTone(r.outlook)}>{t(`agencyRatings.outlook.${r.outlook}`)}</Badge>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
              <td className="tabular-nums">{formatDate(r.as_of, locale)}</td>
              <td className="whitespace-normal text-small text-slate-600">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer noopener" className="break-all text-accent-700 hover:underline">
                    {url.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  r.reference
                )}
                {r.note && <span className="block text-caption text-slate-500">{r.note}</span>}
                {withEntered && (
                  <span className="block text-caption text-slate-500">
                    {t('agencyRatings.enteredOn', { date: formatDate(r.entered_at, locale) })}
                  </span>
                )}
              </td>
              {onUpdate && (
                <td>
                  <Button size="sm" variant="ghost" onClick={() => onUpdate(r)}>
                    {t('agencyRatings.update')}
                  </Button>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

/** A rating action: a new rating, an outlook change or a withdrawal. Opened
 * from a row, it starts from that agency, scale and term. */
function AgencyRatingModal({
  entityId,
  from,
  onClose,
}: {
  entityId: string
  from: AgencyRating | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const save = useSetAgencyRating()
  const [agency, setAgency] = useState<Agency>(from?.agency ?? 'sp')
  const [otherName, setOtherName] = useState(from?.agency_name ?? '')
  const [scale, setScale] = useState<AgencyScale>(from?.scale ?? 'international')
  const [term, setTerm] = useState<AgencyTerm>(from?.term ?? 'long')
  const [withdrawn, setWithdrawn] = useState(false)
  const [rating, setRating] = useState(from?.rating ?? '')
  const [outlook, setOutlook] = useState<AgencyOutlook | ''>(from?.outlook ?? '')
  const [asOf, setAsOf] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const errs = {
    otherName: agency === 'other' && !otherName.trim() ? t('agencyRatings.errors.agencyName') : null,
    rating: !withdrawn && !isValidAgencyRating(rating) ? t('agencyRatings.errors.rating') : null,
    note: withdrawn && !note.trim() ? t('agencyRatings.errors.withdrawnNote') : null,
    asOf: !asOf || asOf > todayIso() ? t('agencyRatings.errors.asOf') : null,
    reference: !reference.trim() ? t('agencyRatings.errors.reference') : null,
  }
  const shown = (k: keyof typeof errs) => (tried ? errs[k] : null)
  const cls = !withdrawn ? gradeClass(agency, scale, term, rating) : null

  const submit = () => {
    setTried(true)
    setError(null)
    if (Object.values(errs).some(Boolean)) return
    save
      .mutateAsync({
        entityId,
        agency,
        agencyName: agency === 'other' ? otherName.trim() : null,
        scale,
        term,
        rating: withdrawn ? null : rating.trim(),
        outlook: withdrawn || !outlook ? null : outlook,
        asOf,
        reference: reference.trim(),
        note: note.trim() || null,
      })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('agencyRatings.modalTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('agencyRatings.save')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">{t('agencyRatings.modalIntro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('agencyRatings.fields.agency')}>
          <Select value={agency} onChange={(e) => setAgency(e.target.value as Agency)} disabled={Boolean(from)}>
            {AGENCIES.map((a) => (
              <option key={a} value={a}>
                {a === 'other' ? t('agencyRatings.otherAgency') : agencyName(a, null)}
              </option>
            ))}
          </Select>
        </Field>
        {agency === 'other' && (
          <Field label={t('agencyRatings.fields.agencyName')} error={shown('otherName')}>
            <Input value={otherName} maxLength={100} onChange={(e) => setOtherName(e.target.value)} disabled={Boolean(from)} />
          </Field>
        )}
        <Field label={t('agencyRatings.fields.scaleOnly')}>
          <Select value={scale} onChange={(e) => setScale(e.target.value as AgencyScale)} disabled={Boolean(from)}>
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {t(`agencyRatings.scale.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('agencyRatings.fields.term')}>
          <Select value={term} onChange={(e) => setTerm(e.target.value as AgencyTerm)} disabled={Boolean(from)}>
            {TERMS.map((s) => (
              <option key={s} value={s}>
                {t(`agencyRatings.term.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-small text-slate-700">
        <input type="checkbox" checked={withdrawn} onChange={(e) => setWithdrawn(e.target.checked)} />
        {t('agencyRatings.withdrawnCheck')}
      </label>
      {!withdrawn && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('agencyRatings.fields.rating')} hint={t('agencyRatings.ratingHint')} error={shown('rating')}>
            <span className="flex items-center gap-3">
              <Input className="w-32 font-mono" value={rating} maxLength={20} onChange={(e) => setRating(e.target.value)} />
              {cls && <span className="text-caption text-slate-500">{t(`agencyRatings.class.${cls}`)}</span>}
            </span>
          </Field>
          <Field label={t('agencyRatings.fields.outlook')}>
            <Select value={outlook} onChange={(e) => setOutlook(e.target.value as AgencyOutlook | '')}>
              <option value="">{t('agencyRatings.noOutlook')}</option>
              {OUTLOOKS.map((o) => (
                <option key={o} value={o}>
                  {t(`agencyRatings.outlook.${o}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('agencyRatings.fields.asOf')} hint={t('agencyRatings.asOfHint')} error={shown('asOf')}>
          <DateInput value={asOf} onChange={setAsOf} max={todayIso()} invalid={Boolean(shown('asOf'))} required />
        </Field>
        <Field label={t('agencyRatings.fields.reference')} hint={t('agencyRatings.referenceHint')} error={shown('reference')}>
          <Input value={reference} maxLength={500} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <Field label={t('agencyRatings.fields.note')} error={shown('note')}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

