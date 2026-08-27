/** Admin > Authorities: the 2D matrix for one user — rows are grade bands,
 * each with an amount, currency and validity window, per stream
 * (credit | commercial). Expired grants are collapsed into a history list.
 * Mirrors tci.authority_grants + tci.my_authority_uzs(band). */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Input, Segmented, Select, Table } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {t('admin.authoritiesFor', { email: user.email })}
          </h2>
          <p className="text-[13px] text-slate-500">{t('admin.authoritiesHint')}</p>
        </div>
        <Segmented
          value={scope}
          options={[
            { key: 'credit', label: t('admin.scopes.credit') },
            { key: 'commercial', label: t('admin.scopes.commercial') },
          ]}
          onChange={(key) => setScope(key as AuthorityScope)}
        />
      </div>

      {scope === 'commercial' && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-600">
          {t('admin.commercialDormant')}
        </p>
      )}

      {user.roles.includes('admin') && (
        <p className="rounded-md border border-accent-500/20 bg-accent-50 px-4 py-2.5 text-[13px] text-slate-700">
          {t('admin.adminUnlimited')}
        </p>
      )}

      <Card className="p-5">
        <Table dense>
          <thead>
            <tr>
              <th>{t('admin.fields.band')}</th>
              <th className="text-right">{t('admin.fields.maxAmount')}</th>
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
      </Card>

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
    setAmount(grant ? String(grant.max_amount) : '')
    setCurrency(grant?.currency_code ?? 'UZS')
    setValidFrom(grant?.valid_from ?? new Date().toISOString().slice(0, 10))
    setValidTo(grant?.valid_to ?? '')
    setError(null)
    setEditing(true)
  }

  const parsed = Number(amount.replace(/\s/g, '').replace(',', '.'))
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
    } catch {
      setError(t('common.saveFailed'))
    }
  }

  if (editing) {
    return (
      <tr>
        <td className="font-medium text-slate-800">{t(`limits.bands.${band}`)}</td>
        <td>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="num"
          />
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
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </td>
        <td>
          <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </td>
        <td className="text-right whitespace-nowrap">
          <Button size="sm" onClick={() => void commit()} disabled={save.isPending}>
            {t('common.save')}
          </Button>{' '}
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
          {error && (
            <span className="ml-2 text-[13px] text-neg-500" role="alert">
              {error}
            </span>
          )}
        </td>
      </tr>
    )
  }

  return (
    <tr className={grant ? '' : 'text-slate-400'}>
      <td className="font-medium text-slate-800">{t(`limits.bands.${band}`)}</td>
      <td>
        <span className="num block">
          {grant ? formatAmount(Number(grant.max_amount), locale) : EM_DASH}
        </span>
      </td>
      <td>{grant?.currency_code ?? EM_DASH}</td>
      <td>{grant?.valid_from ?? EM_DASH}</td>
      <td>{grant?.valid_to ?? (grant ? t('admin.openEnded') : EM_DASH)}</td>
      <td className="text-right whitespace-nowrap">
        <Button variant="secondary" size="sm" onClick={start}>
          {grant ? t('common.edit') : t('admin.grant')}
        </Button>
        {grant && (
          <>
            {' '}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void remove.mutateAsync(grant.id)}
              disabled={remove.isPending}
            >
              {t('common.delete')}
            </Button>
          </>
        )}
      </td>
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
        className="text-sm font-semibold text-slate-900"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} {t('admin.expiredGrants', { count: grants.length })}
      </button>
      {open && (
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-slate-600">
          {grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{t(`limits.bands.${g.grade_band}`)}</Badge>
              <span className="num">
                {formatAmount(Number(g.max_amount), locale)} {g.currency_code}
              </span>
              <span className="text-slate-400">
                {g.valid_from} — {g.valid_to ?? t('admin.openEnded')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
