/**
 * Admin › Риски › «Санкции» (migration 0085): the sanctions flags on a
 * country or a single company. While a flag is live NO cover is possible for
 * that party — the database refuses a limit request, an approving decision,
 * a submission, a package buyer and a policy whatever the authority. Setting
 * a flag revokes nothing: it opens an urgent review task per in-force limit,
 * and the card says how many. Flags are never deleted; lifting needs a
 * reason.
 *
 * Who maintains them is one rule, `mayManageSanctions` (the mirror of
 * tci.may_manage_sanctions): admin today, a compliance role later.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../../auth/AuthContext'
import {
  Badge,
  Button,
  Callout,
  Card,
  COL,
  ConfirmDialog,
  CountryFlag,
  DateInput,
  EmptyState,
  Field,
  Input,
  Modal,
  RowActions,
  SectionTitle,
  Segmented,
  Select,
  Skeleton,
  Table,
  Textarea,
} from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { formatDate, formatMoment } from '../../../lib/format'
import { refusalOr } from '../../../lib/optimistic'
import { CountryPicker } from '../../entities/CountryPicker'
import { EntityPicker } from '../../entities/EntityPicker'
import { useCountryName } from '../../portfolio/useCountryName'
import { useLiftSanctionFlag, useSanctionFlags, useSetSanctionFlag } from '../../risk/api'
import type { SanctionFlag } from '../../risk/api'
import { SANCTION_REGIMES, SANCTION_SCOPES } from '../../risk/rules'
import type { SanctionRegime, SanctionScope } from '../../risk/rules'
import { flagState, mayManageSanctions, sanctionFormProblems } from './riskSettingsForm'
import { usePersonName } from './usePersonName'

type Filter = 'live' | 'lifted'

export function SanctionsCard() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { roles } = useAuth()
  const manage = mayManageSanctions(roles)
  const flags = useSanctionFlags()
  const countryName = useCountryName()
  const personName = usePersonName()
  const [filter, setFilter] = useState<Filter>('live')
  const [adding, setAdding] = useState(false)
  const [lifting, setLifting] = useState<SanctionFlag | null>(null)
  const [result, setResult] = useState<number | null>(null)
  const [lifted, setLifted] = useState(false)

  const today = todayIso()
  const all = flags.data ?? []
  const live = all.filter((f) => flagState(f, today) !== 'lifted')
  const liftedRows = all.filter((f) => flagState(f, today) === 'lifted')
  const rows = filter === 'live' ? live : liftedRows

  const party = (f: SanctionFlag) =>
    f.scope === 'country' ? (
      <span className="inline-flex min-w-0 items-center gap-2">
        <CountryFlag code={f.country_code} />
        <span className="truncate">{countryName(f.country_code)}</span>
      </span>
    ) : f.entity_id ? (
      <Link to={`/entities/${f.entity_id}`} className="truncate text-accent-700 hover:underline">
        {f.legal_entities?.name ?? '—'}
      </Link>
    ) : (
      '—'
    )

  const sourceText = (f: SanctionFlag) => (f.reference ? `${f.source} · ${f.reference}` : f.source)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        hint={t('admin.risk.sanctions.hint')}
        actions={
          manage ? (
            <Button
              onClick={() => {
                setResult(null)
                setLifted(false)
                setAdding(true)
              }}
            >
              {t('admin.risk.sanctions.add')}
            </Button>
          ) : undefined
        }
      >
        {t('admin.risk.sanctions.title')}
      </SectionTitle>

      {!manage && <Callout tone="info" title={t('admin.risk.sanctions.readOnly')} />}

      {result !== null && (
        <Callout
          tone="pos"
          title={t('admin.risk.sanctions.saved')}
        >
          {result === 0
            ? t('admin.risk.sanctions.reviewNone')
            : t('admin.risk.sanctions.reviewCount', { count: result })}
        </Callout>
      )}
      {lifted && <Callout tone="pos" title={t('admin.risk.sanctions.liftedDone')} />}

      <Segmented
        value={filter}
        ariaLabel={t('admin.risk.sanctions.filter')}
        options={[
          { key: 'live', label: t('admin.risk.sanctions.filters.live', { count: live.length }) },
          { key: 'lifted', label: t('admin.risk.sanctions.filters.lifted', { count: liftedRows.length }) },
        ]}
        onChange={(key) => setFilter(key as Filter)}
      />

      {flags.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : flags.isError ? (
        <Callout tone="neg" title={t('admin.risk.sanctions.loadFailed')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t(filter === 'live' ? 'admin.risk.sanctions.emptyLive' : 'admin.risk.sanctions.emptyLifted')}
          hint={t(filter === 'live' ? 'admin.risk.sanctions.emptyLiveHint' : 'admin.risk.sanctions.emptyLiftedHint')}
        />
      ) : filter === 'live' ? (
        <Table dense columns={[COL.fill, '7.5rem', '7rem', '13rem', '9rem', COL.person, COL.date, ...(manage ? ['9rem'] : [])]}>
          <thead>
            <tr>
              <th>{t('admin.risk.sanctions.columns.party')}</th>
              <th>{t('admin.risk.sanctions.columns.scope')}</th>
              <th>{t('admin.risk.sanctions.columns.regime')}</th>
              <th>{t('admin.risk.sanctions.columns.source')}</th>
              <th>{t('admin.risk.sanctions.columns.effective')}</th>
              <th>{t('admin.risk.sanctions.columns.setBy')}</th>
              <th>{t('admin.risk.sanctions.columns.setAt')}</th>
              {manage && <th aria-label={t('common.actions')} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const scheduled = flagState(f, today) === 'scheduled'
              return (
                <tr key={f.id}>
                  <td>{party(f)}</td>
                  <td>{t(`admin.risk.sanctions.scopes.${f.scope}`)}</td>
                  <td>
                    <Badge tone="negStrong">{t(`admin.risk.sanctions.regimes.${f.regime}`)}</Badge>
                  </td>
                  <td title={f.note ?? undefined}>{sourceText(f)}</td>
                  <td>
                    {scheduled ? (
                      <Badge tone="warn" title={t('admin.risk.sanctions.scheduledTitle')}>
                        {t('admin.risk.sanctions.from', { date: formatDate(f.effective_from, lang) })}
                      </Badge>
                    ) : (
                      formatDate(f.effective_from, lang)
                    )}
                  </td>
                  <td>{personName(f.set_by)}</td>
                  <td>{formatDate(f.set_at, lang)}</td>
                  {manage && (
                    <RowActions>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setResult(null)
                          setLifted(false)
                          setLifting(f)
                        }}
                      >
                        {t('admin.risk.sanctions.lift')}
                      </Button>
                    </RowActions>
                  )}
                </tr>
              )
            })}
          </tbody>
        </Table>
      ) : (
        <Table dense columns={[COL.fill, '7.5rem', '7rem', '12rem', COL.date, COL.person, COL.moment, '14rem']}>
          <thead>
            <tr>
              <th>{t('admin.risk.sanctions.columns.party')}</th>
              <th>{t('admin.risk.sanctions.columns.scope')}</th>
              <th>{t('admin.risk.sanctions.columns.regime')}</th>
              <th>{t('admin.risk.sanctions.columns.source')}</th>
              <th>{t('admin.risk.sanctions.columns.effective')}</th>
              <th>{t('admin.risk.sanctions.columns.liftedBy')}</th>
              <th>{t('admin.risk.sanctions.columns.liftedAt')}</th>
              <th>{t('admin.risk.sanctions.columns.liftReason')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <td>{party(f)}</td>
                <td>{t(`admin.risk.sanctions.scopes.${f.scope}`)}</td>
                <td>
                  <Badge tone="neutral">{t(`admin.risk.sanctions.regimes.${f.regime}`)}</Badge>
                </td>
                <td title={f.note ?? undefined}>{sourceText(f)}</td>
                <td>{formatDate(f.effective_from, lang)}</td>
                <td>{personName(f.lifted_by)}</td>
                <td>{f.lifted_at ? formatMoment(f.lifted_at, lang) : '—'}</td>
                <td className="text-slate-600">{f.lift_reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {manage && (
        <AddFlagModal
          open={adding}
          onClose={() => setAdding(false)}
          onSaved={(count) => {
            setAdding(false)
            setResult(count)
            setFilter('live')
          }}
        />
      )}
      {manage && lifting && (
        <LiftFlagModal
          flag={lifting}
          partyName={lifting.scope === 'country' ? countryName(lifting.country_code) : (lifting.legal_entities?.name ?? '—')}
          onClose={() => setLifting(null)}
          onLifted={() => {
            setLifting(null)
            setLifted(true)
          }}
        />
      )}
    </Card>
  )
}

function AddFlagModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: (limitsToReview: number) => void
}) {
  const { t } = useTranslation()
  const setFlag = useSetSanctionFlag()
  const [scope, setScope] = useState<SanctionScope>('country')
  const [countryCode, setCountryCode] = useState<string | null>(null)
  const [entityId, setEntityId] = useState<string | null>(null)
  const [regime, setRegime] = useState<SanctionRegime>('UN')
  const [source, setSource] = useState('')
  const [reference, setReference] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso())
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problems = sanctionFormProblems({ scope, countryCode, entityId, source, effectiveFrom })
  const show = (field: (typeof problems)[number]) => touched && problems.includes(field)

  const reset = () => {
    setScope('country')
    setCountryCode(null)
    setEntityId(null)
    setRegime('UN')
    setSource('')
    setReference('')
    setEffectiveFrom(todayIso())
    setNote('')
    setTouched(false)
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    setConfirming(false)
    setError(null)
    setFlag.mutate(
      {
        scope,
        countryCode: scope === 'country' ? countryCode : null,
        entityId: scope === 'entity' ? entityId : null,
        regime,
        source: source.trim(),
        reference: reference.trim() || null,
        effectiveFrom,
        note: note.trim() || null,
      },
      {
        onSuccess: (res) => {
          reset()
          onSaved(res.limits_to_review)
        },
        onError: (failure) =>
          // One live flag per party and regime (a unique index, 0085).
          setError(
            t(
              (failure as { code?: unknown } | null)?.code === '23505'
                ? 'admin.risk.sanctions.duplicate'
                : refusalOr(failure, 'admin.risk.sanctions.saveFailed'),
            ),
          ),
      },
    )
  }

  return (
    <>
      <Modal
        open={open && !confirming}
        title={t('admin.risk.sanctions.addTitle')}
        onClose={close}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={setFlag.isPending}
              onClick={() => {
                setTouched(true)
                if (problems.length === 0) setConfirming(true)
              }}
            >
              {t('admin.risk.sanctions.addSubmit')}
            </Button>
          </>
        }
      >
        <Field label={t('admin.risk.sanctions.columns.scope')}>
          <Segmented
            value={scope}
            options={SANCTION_SCOPES.map((s) => ({ key: s, label: t(`admin.risk.sanctions.scopes.${s}`) }))}
            onChange={(key) => setScope(key as SanctionScope)}
          />
        </Field>
        {scope === 'country' ? (
          <Field
            label={t('admin.risk.sanctions.country')}
            error={show('target') ? t('admin.risk.sanctions.targetRequired.country') : null}
          >
            <CountryPicker value={countryCode} onChange={setCountryCode} invalid={show('target')} />
          </Field>
        ) : (
          <Field
            label={t('admin.risk.sanctions.company')}
            error={show('target') ? t('admin.risk.sanctions.targetRequired.entity') : null}
          >
            <EntityPicker value={entityId} onChange={setEntityId} invalid={show('target')} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.risk.sanctions.columns.regime')}>
            <Select value={regime} onChange={(e) => setRegime(e.target.value as SanctionRegime)}>
              {SANCTION_REGIMES.map((r) => (
                <option key={r} value={r}>
                  {t(`admin.risk.sanctions.regimes.${r}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('admin.risk.sanctions.columns.effective')}
            error={show('effective_from') ? t('admin.risk.sanctions.effectiveRequired') : null}
          >
            <DateInput value={effectiveFrom} onChange={setEffectiveFrom} invalid={show('effective_from')} required />
          </Field>
        </div>
        <Field
          label={t('admin.risk.sanctions.source')}
          hint={t('admin.risk.sanctions.sourceHint')}
          error={show('source') ? t('admin.risk.sanctions.sourceRequired') : null}
        >
          <Input value={source} maxLength={300} onChange={(e) => setSource(e.target.value)} />
        </Field>
        <Field label={t('admin.risk.sanctions.reference')} hint={t('admin.risk.sanctions.referenceHint')}>
          <Input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label={t('admin.risk.sanctions.note')}>
          <Textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Callout tone="warn" title={t('admin.risk.sanctions.effectTitle')}>
          {t('admin.risk.sanctions.effectBody')}
        </Callout>
        {error && <Callout tone="neg" title={error} />}
      </Modal>

      <ConfirmDialog
        open={open && confirming}
        title={t('admin.risk.sanctions.confirmTitle')}
        message={t('admin.risk.sanctions.confirmBody')}
        confirmLabel={t('admin.risk.sanctions.confirm')}
        pending={setFlag.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      />
    </>
  )
}

function LiftFlagModal({
  flag,
  partyName,
  onClose,
  onLifted,
}: {
  flag: SanctionFlag
  partyName: string
  onClose: () => void
  onLifted: () => void
}) {
  const { t } = useTranslation()
  const lift = useLiftSanctionFlag()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const missing = !reason.trim()

  return (
    <Modal
      open
      title={t('admin.risk.sanctions.liftTitle', { party: partyName })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={lift.isPending}
            onClick={() => {
              setTouched(true)
              if (missing) return
              setError(null)
              lift.mutate(
                { flagId: flag.id, reason: reason.trim() },
                {
                  onSuccess: onLifted,
                  onError: (failure) => setError(t(refusalOr(failure, 'admin.risk.sanctions.liftFailed'))),
                },
              )
            }}
          >
            {t('admin.risk.sanctions.liftSubmit')}
          </Button>
        </>
      }
    >
      <p className="text-body text-slate-600">
        {t('admin.risk.sanctions.liftBody', { regime: t(`admin.risk.sanctions.regimes.${flag.regime}`) })}
      </p>
      <Field
        label={t('admin.risk.sanctions.liftReason')}
        error={touched && missing ? t('risk.errors.sanctionsLiftReason') : null}
      >
        <Textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {error && <Callout tone="neg" title={error} />}
    </Modal>
  )
}
