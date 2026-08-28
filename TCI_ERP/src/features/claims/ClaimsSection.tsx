/** The claims block reused by the company card and the policy page. On a
 * policy it also shows how much of the maximum liability the approved claims
 * have already consumed — the number that decides what the next claim can be
 * paid. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Spinner, Table } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { CLAIM_STATUS_TONE } from './ClaimsPage'
import { useClaims, usePolicyLiability } from './api'

export function ClaimsSection({
  policyId,
  entityId,
  onFileClaim,
}: {
  policyId?: string
  entityId?: string
  onFileClaim?: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: claims, isLoading } = useClaims({ policyId, entityId })
  const { data: liability } = usePolicyLiability(policyId)

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="space-y-4">
      {liability && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <p className="text-xs text-slate-500">{t('claims.liability.max')}</p>
            <p className="num mt-1 text-lg font-semibold">
              {liability.max_liability_amount === null
                ? EM_DASH
                : `${formatAmount(Number(liability.max_liability_amount), locale)} ${liability.currency_code}`}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-slate-500">{t('claims.liability.consumed')}</p>
            <p className="num mt-1 text-lg font-semibold">
              {formatAmount(Number(liability.liability_consumed), locale)} {liability.currency_code}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-slate-500">{t('claims.liability.remaining')}</p>
            <p className="num mt-1 text-lg font-semibold">
              {liability.liability_remaining === null
                ? t('claims.liability.uncapped')
                : `${formatAmount(Number(liability.liability_remaining), locale)} ${liability.currency_code}`}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-slate-500">{t('claims.liability.aflRemaining')}</p>
            <p className="num mt-1 text-lg font-semibold">
              {liability.afl_remaining === null
                ? EM_DASH
                : `${formatAmount(Number(liability.afl_remaining), locale)} ${liability.currency_code}`}
            </p>
          </Card>
        </div>
      )}

      {onFileClaim && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onFileClaim}>
            {t('claims.actions.open')}
          </Button>
        </div>
      )}

      {(claims ?? []).length === 0 ? (
        <EmptyState title={t('claims.section.emptyTitle')} hint={t('claims.section.emptyHint')} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t('claims.fields.number')}</th>
                <th>{policyId ? t('claims.fields.buyer') : t('claims.fields.policy')}</th>
                <th className="num">{t('claims.fields.claimed')}</th>
                <th className="num">{t('claims.fields.indemnity')}</th>
                <th>{t('claims.fields.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(claims ?? []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/claims/${c.id}`} className="text-accent-600 hover:underline">
                      {c.claim_number}
                    </Link>
                  </td>
                  <td>{policyId ? c.buyer_name : c.policy_number}</td>
                  <td className="num">
                    {formatAmount(Number(c.claimed_amount), locale)} {c.currency_code}
                  </td>
                  <td className="num">
                    {c.approved_indemnity === null
                      ? EM_DASH
                      : `${formatAmount(Number(c.approved_indemnity), locale)} ${c.currency_code}`}
                  </td>
                  <td>
                    <Badge tone={CLAIM_STATUS_TONE[c.status]}>
                      {t(`claims.statuses.${c.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
