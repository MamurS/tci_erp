/**
 * «Мои полномочия» — the caller's own underwriting authority: per grade band
 * the credit authority in UZS as tci.my_authority_uzs computes it (the figure
 * decide_limit_request compares against), and the grants behind it in both
 * streams. Grants are set by an administrator on the admin screen.
 */

import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, Panel, PanelGrid, Skeleton, Table, ViewBar } from '../../../components/ui'
import { useAuth } from '../../../auth/AuthContext'
import { formatAmount, formatCompact, formatDate } from '../../../lib/format'
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
          <Skeleton className="ml-auto h-4 w-24" />
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

export function AuthorityView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { session, roles } = useAuth()
  const isAdmin = hasRole(roles, 'admin')
  const { data: grants, isLoading } = useMyAuthorityGrants(session?.user.id)
  const today = new Date().toISOString().slice(0, 10)
  const live = (grants ?? []).filter((g) => g.valid_from <= today && (g.valid_to === null || g.valid_to >= today))

  return (
    <div>
      <ViewBar hint={t('limits.workbench.authority.subtitle')} />

      {isAdmin && (
        <Card className="mb-5 border-accent-200 bg-accent-50/50 p-4 text-[13px] text-accent-700">
          {t('admin.adminUnlimited')}
        </Card>
      )}

      <PanelGrid cols="lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title={t('limits.workbench.authority.byBand')} hint={t('limits.workbench.authority.byBandHint')}>
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
        </Panel>

        <Panel title={t('limits.workbench.authority.grants')} hint={t('limits.workbench.authority.grantsHint')}>
          {isLoading ? (
            // The same placeholder as the band column beside it: rows, not a
            // lone spinner in an empty card.
            <div className="flex flex-col gap-2 py-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
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
                        <td className="whitespace-nowrap text-slate-600">{formatDate(g.valid_from, locale)}</td>
                        <td className="whitespace-nowrap text-slate-600">{g.valid_to ? formatDate(g.valid_to, locale) : t('admin.openEnded')}</td>
                      </tr>
                    )),
                )}
              </tbody>
            </Table>
          )}
        </Panel>
      </PanelGrid>
    </div>
  )
}
