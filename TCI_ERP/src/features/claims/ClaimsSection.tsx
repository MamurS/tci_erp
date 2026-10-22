/** The claims block reused by the company card and the policy page. On a
 * policy it also shows how much of the maximum liability the approved claims
 * have already consumed — the number that decides what the next claim can be
 * paid. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  COL,
  EmptyState,
  KeyFigures,
  labelCol,
  Spinner,
  Table,
  Truncate,
  ViewBar,
} from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { CLAIM_STATUS_TONE } from './status'
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
    <div>
      {liability && (
        <KeyFigures
          items={[
            {
              label: t('claims.liability.max'),
              value:
                liability.max_liability_amount === null
                  ? EM_DASH
                  : `${formatAmount(Number(liability.max_liability_amount), locale)} ${liability.currency_code}`,
            },
            {
              label: t('claims.liability.consumed'),
              value: `${formatAmount(Number(liability.liability_consumed), locale)} ${liability.currency_code}`,
            },
            {
              label: t('claims.liability.remaining'),
              value:
                liability.liability_remaining === null
                  ? t('claims.liability.uncapped')
                  : `${formatAmount(Number(liability.liability_remaining), locale)} ${liability.currency_code}`,
              tone: 'pos',
            },
            {
              label: t('claims.liability.aflRemaining'),
              value:
                liability.afl_remaining === null
                  ? EM_DASH
                  : `${formatAmount(Number(liability.afl_remaining), locale)} ${liability.currency_code}`,
              tone: liability.afl_remaining === null ? 'muted' : 'default',
            },
          ]}
        />
      )}

      {onFileClaim && (
        <ViewBar
          actions={
            <Button variant="secondary" onClick={onFileClaim}>
              {t('claims.actions.open')}
            </Button>
          }
        />
      )}

      {(claims ?? []).length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t('claims.section.emptyTitle')} hint={t('claims.section.emptyHint')} />
        </Card>
      ) : (
        <Table columns={[COL.code, COL.fill, COL.money, COL.money, labelCol('claimStatus')]}>
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
                <td>
                  <Truncate text={policyId ? c.buyer_name : c.policy_number} className="max-w-none" />
                </td>
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
      )}
    </div>
  )
}
