/** Admin > Authorities: the 2D matrix for one user — rows are grade bands,
 * each with an amount, currency and validity window, per stream
 * (credit | commercial). Expired grants are collapsed into a history list.
 * Mirrors tci.authority_grants + tci.my_authority_uzs(band). */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  actionsCol,
  AmountInput,
  Badge,
  Button,
  Card,
  COL,
  DateInput,
  EmptyState,
  labelCol,
  RowActions,
  SectionTitle,
  Segmented,
  Select,
  Table,
} from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { amountToPlain, parseAmount } from '../../components/ui/amount'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { GRADE_BANDS } from '../../lib/roles'
import type { AuthorityScope, GradeBand } from '../../lib/roles'
import { useCurrencies } from '../entities/api'
import type { AuthorityGrant } from '../limits/types'
import { useAuthorityGrants, useDeleteGrant, useSaveGrant } from './api'
import { grantIsCurrent, validateGrant } from './authorityForm'
import type { AdminUser } from './api'

export function AuthoritiesTab({ user }: { user: AdminUser | null }) {
  const { t } = useTranslation()
  const [scope, setScope] = useState<AuthorityScope>('credit')
  const grants = useAuthorityGrants(user?.user_id ?? '')

  if (!user) return <EmptyState title={t('admin.selectUser')} hint={t('admin.selectUserHint')} />

  const all = grants.data ?? []
  const inScope = all.filter((g) => g.applies_to === scope)
  const today = new Date().toISOString().slice(0, 10)
  const current = inScope.filter((g) => grantIsCurrent(g, today))
  const history = inScope.filter((g) => !grantIsCurrent(g, today))

  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        hint={t('admin.authoritiesHint')}
        actions={
          <Segmented
            value={scope}
            options={[
              { key: 'credit', label: t('admin.scopes.credit') },
              { key: 'commercial', label: t('admin.scopes.commercial') },
            ]}
            onChange={(key) => setScope(key as AuthorityScope)}
          />
        }
      >
        {t('admin.authoritiesFor', { email: user.email })}
      </SectionTitle>

      {scope === 'commercial' && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-small text-slate-600">
          {t('admin.commercialDormant')}
        </p>
      )}

      {user.roles.includes('admin') && (
        <p className="rounded-md border border-accent-500/20 bg-accent-50 px-4 py-3 text-small text-slate-700">
          {t('admin.adminDecidesNothing')}
        </p>
      )}

      <Table dense columns={[labelCol('limitBand'), COL.fill, '7rem', '10rem', '10rem', actionsCol(['grantPrimary', 'grantSecondary'])]}>
        <thead>
          <tr>
            <th>{t('admin.fields.band')}</th>
            <th className="num">{t('admin.fields.maxAmount')}</th>
            <th>{t('admin.fields.currency')}</th>
            <th>{t('admin.fields.validFrom')}</th>
            <th>{t('admin.fields.validTo')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {GRADE_BANDS.map((band) => (
            <BandRow
              key={band}
              band={band}
              scope={scope}
              userId={user.user_id}
              grant={current.find((g) => g.grade_band === band) ?? null}
            />
          ))}
        </tbody>
      </Table>

      {history.length > 0 && <HistoryList grants={history} />}
    </div>
  )
}

function BandRow({
  band,
  scope,
  userId,
  grant,
}: {
  band: GradeBand
  scope: AuthorityScope
  userId: string
  grant: AuthorityGrant | null
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: currencies } = useCurrencies()
  const save = useSaveGrant()
  const remove = useDeleteGrant(userId)

  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('UZS')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    setAmount(grant ? amountToPlain(grant.max_amount) : '')
    setCurrency(grant?.currency_code ?? 'UZS')
    setValidFrom(grant?.valid_from ?? new Date().toISOString().slice(0, 10))
    setValidTo(grant?.valid_to ?? '')
    setError(null)
    setEditing(true)
  }

  const parsed = parseAmount(amount) ?? Number.NaN
  const problem = useMemo(
    () => validateGrant({ maxAmount: parsed, validFrom, validTo: validTo || null }),
    [parsed, validFrom, validTo],
  )

  const commit = async () => {
    if (problem) {
      setError(t(`admin.errors.${problem}`))
      return
    }
    setError(null)
    try {
      await save.mutateAsync({
        id: grant?.id,
        user_id: userId,
        applies_to: scope,
        grade_band: band,
        max_amount: parsed,
        currency_code: currency,
        valid_from: validFrom,
        valid_to: validTo || null,
      })
      setEditing(false)
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.saveFailed')))
    }
  }

  // Editing in place swaps text for 36px fields: both modes are one height,
  // so the rows below never move when a grant is opened or saved.
  if (editing) {
    return (
      <tr className="h-12">
        <td className="font-medium text-slate-800">{t(`limits.bands.${band}`)}</td>
        <td>
          <AmountInput value={amount} onChange={setAmount} suffix={currency} />
        </td>
        <td>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(currencies ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </td>
        <td>
          <DateInput value={validFrom} onChange={setValidFrom} />
        </td>
        <td>
          <DateInput value={validTo} onChange={setValidTo} min={validFrom || undefined} />
        </td>
        <RowActions>
          <Button size="sm" onClick={() => void commit()} loading={save.isPending}>
            {t('common.save')}
          </Button>{' '}
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
          {error && (
            <span className="ml-2 text-small text-neg-500" role="alert">
              {error}
            </span>
          )}
        </RowActions>
      </tr>
    )
  }

  return (
    <tr className={`h-12 ${grant ? '' : 'text-slate-500'}`}>
      <td className="font-medium text-slate-800">{t(`limits.bands.${band}`)}</td>
      <td>
        <span className="num block">
          {grant ? formatAmount(Number(grant.max_amount), locale) : EM_DASH}
        </span>
      </td>
      <td>{grant?.currency_code ?? EM_DASH}</td>
      <td>{grant ? formatDate(grant.valid_from, locale) : EM_DASH}</td>
      <td>{grant?.valid_to ? formatDate(grant.valid_to, locale) : grant ? t('admin.openEnded') : EM_DASH}</td>
      <RowActions>
        <Button variant="secondary" size="sm" onClick={start}>
          {grant ? t('common.edit') : t('admin.grant')}
        </Button>
        {grant && (
          <>
            {' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null)
                remove.mutateAsync(grant.id).catch((failure: unknown) => setError(t(refusalOr(failure, 'common.saveFailed'))))
              }}
              loading={remove.isPending}
            >
              {t('common.delete')}
            </Button>
          </>
        )}
        {/* A refused delete puts the grant back; say why beside it. */}
        {error && (
          <span className="ml-2 text-small text-neg-500" role="alert">
            {error}
          </span>
        )}
      </RowActions>
    </tr>
  )
}

function HistoryList({ grants }: { grants: AuthorityGrant[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [open, setOpen] = useState(false)

  return (
    <Card className="p-5">
      <button
        type="button"
        className="text-body font-semibold text-slate-900"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} {t('admin.expiredGrants', { count: grants.length })}
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-2 text-small text-slate-600">
          {grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{t(`limits.bands.${g.grade_band}`)}</Badge>
              <span className="num">
                {formatAmount(Number(g.max_amount), locale)} {g.currency_code}
              </span>
              <span className="text-slate-500">
                {formatDate(g.valid_from, locale)} — {g.valid_to ? formatDate(g.valid_to, locale) : t('admin.openEnded')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
