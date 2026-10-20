/**
 * «Мои полномочия» — the caller's own underwriting authority: per grade band
 * the credit authority in UZS as tci.my_authority_uzs computes it (the figure
 * decide_limit_request compares against), and the grants behind it in both
 * streams. Grants are set by an administrator on the admin screen.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, PageHeader, SectionTitle, Spinner, Table } from '../../../components/ui'
import { useAuth } from '../../../auth/AuthContext'
import { formatAmount, formatCompact } from '../../../lib/format'
import { AUTHORITY_SCOPES, GRADE_BANDS, hasRole } from '../../../lib/roles'
import type { GradeBand } from '../../../lib/roles'
import { useMyAuthorityGrants, useMyAuthorityUzs } from '../api'
import { BandBadge } from './parts'

function BandAuthority({ band }: { band: GradeBand }) {
  const { t, i18n } = useTranslation()
  const { data, isLoading, isError } = useMyAuthorityUzs(band)
  return (
    <tr>
      <td>
        <BandBadge band={band} />
      </td>
      <td className="num text-right">
        {isLoading ? (
          '…'
        ) : isError ? (
          <span className="text-warn-500">{t('limits.workbench.authority.rateMissing')}</span>
        ) : data ? (
          `${formatCompact(data, i18n.resolvedLanguage ?? 'en')} UZS`
        ) : (
          <span className="text-slate-400">{t('limits.workbench.authority.none')}</span>
        )}
      </td>
    </tr>
  )
}

export function AuthorityView({ sectionTabs }: { sectionTabs?: ReactNode } = {}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { session, roles } = useAuth()
  const isAdmin = hasRole(roles, 'admin')
  const { data: grants, isLoading } = useMyAuthorityGrants(session?.user.id)
  const today = new Date().toISOString().slice(0, 10)
  const live = (grants ?? []).filter((g) => g.valid_from <= today && (g.valid_to === null || g.valid_to >= today))

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t('limits.workbench.authority.title')} subtitle={t('limits.workbench.authority.subtitle')} />
      {sectionTabs}

      {isAdmin && (
        <Card className="mb-5 border-accent-200 bg-accent-50/50 p-4 text-[13px] text-accent-700">
          {t('admin.adminUnlimited')}
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-5">
          <SectionTitle>{t('limits.workbench.authority.byBand')}</SectionTitle>
          <p className="-mt-1 mb-3 text-[12px] leading-relaxed text-slate-500">{t('limits.workbench.authority.byBandHint')}</p>
          <Table dense>
            <thead>
              <tr>
                <th>{t('admin.fields.band')}</th>
                <th className="text-right">{t('limits.workbench.authority.creditUzs')}</th>
              </tr>
            </thead>
            <tbody>
              {GRADE_BANDS.map((band) => (
                <BandAuthority key={band} band={band} />
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="p-5">
          <SectionTitle>{t('limits.workbench.authority.grants')}</SectionTitle>
          {isLoading ? (
            <Spinner />
          ) : !live.length ? (
            <EmptyState title={t('limits.workbench.authority.noGrants')} hint={t('limits.workbench.authority.noGrantsHint')} />
          ) : (
            <Table dense>
              <thead>
                <tr>
                  <th>{t('limits.workbench.authority.stream')}</th>
                  <th>{t('admin.fields.band')}</th>
                  <th className="text-right">{t('admin.fields.maxAmount')}</th>
                  <th>{t('admin.fields.validFrom')}</th>
                  <th>{t('admin.fields.validTo')}</th>
                </tr>
              </thead>
              <tbody>
                {AUTHORITY_SCOPES.flatMap((scope) =>
                  live
                    .filter((g) => g.applies_to === scope)
                    .sort((a, b) => GRADE_BANDS.indexOf(a.grade_band) - GRADE_BANDS.indexOf(b.grade_band))
                    .map((g) => (
                      <tr key={g.id}>
                        <td>
                          <Badge tone={scope === 'credit' ? 'accent' : 'neutral'}>{t(`admin.scopes.${scope}`)}</Badge>
                        </td>
                        <td>
                          <BandBadge band={g.grade_band} />
                        </td>
                        <td className="num text-right whitespace-nowrap">
                          {formatAmount(Number(g.max_amount), locale)} {g.currency_code}
                        </td>
                        <td className="whitespace-nowrap text-slate-600">{g.valid_from}</td>
                        <td className="whitespace-nowrap text-slate-600">{g.valid_to ?? t('admin.openEnded')}</td>
                      </tr>
                    )),
                )}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  )
}
