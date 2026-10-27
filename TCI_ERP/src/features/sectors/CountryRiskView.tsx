/**
 * «Страновой риск» — every country with its OECD category (the latest
 * imported list; a country not on it is NOT CLASSIFIED, never 0), the
 * internal category the head of credit analysis approved, the one decisions
 * use and where it comes from, and the sanctions flag. Above it: when the
 * OECD list was imported, amber when it is older than the setting or when
 * none ever was.
 *
 * A credit analyst proposes an internal category with a justification; the
 * head of credit analysis (a senior credit analyst) approves or rejects it —
 * never their own — and ends a live one with a reason. Credit underwriting
 * and admin read. The Agenda's approval task lands here with
 * ?override=<id>, which brings that proposal into view.
 */

import { useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Button,
  Callout,
  Card,
  COL,
  CountryFlag,
  EmptyState,
  Field,
  Highlight,
  Modal,
  Panel,
  RowActions,
  Segmented,
  SkeletonRows,
  Table,
  Textarea,
  ViewBar,
} from '../../components/ui'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { formatDate, formatMoment } from '../../lib/format'
import { searchRows } from '../../lib/pageSearch'
import { refusalKey } from '../../lib/refusals'
import { DEEP_LINK_SCROLL_MARGIN, useDeepLinkFocus } from '../../lib/useDeepLinkFocus'
import { useStaffDirectory } from '../data/api'
import { staffName } from '../data/staff'
import { CountryPicker } from '../entities/CountryPicker'
import {
  useCountryOverrides,
  useCountryRisk,
  useDecideCountryOverride,
  useEndCountryOverride,
  useProposeCountryOverride,
} from '../risk/api'
import type { CountryOverride, CountryRiskRow } from '../risk/api'
import { CountryCategoryBadge, SanctionsBadge } from '../risk/badges'
import { COUNTRY_CATEGORIES } from '../risk/rules'
import { useIsHeadAnalyst } from './api'
import {
  COUNTRY_FILTERS,
  countryFilterCounts,
  countryMatches,
  mayEndOverride,
  mayProposeOverride,
  oecdListState,
  overrideDecisionState,
  parseCountryFilter,
  uiLang,
} from './model'
import type { CountryFilter } from './model'
import { ReasonModal } from './ReasonModal'

const OVERRIDE_TONE: Record<CountryOverride['status'], 'accent' | 'pos' | 'neg' | 'neutral'> = {
  pending: 'accent',
  approved: 'pos',
  rejected: 'neg',
  ended: 'neutral',
}

function countryLabel(row: Pick<CountryRiskRow, 'name_en' | 'name_ru' | 'name_uz' | 'country_code'> | undefined, lang: 'en' | 'ru' | 'uz', code: string): string {
  if (!row) return code
  const name = lang === 'ru' ? row.name_ru : lang === 'uz' ? row.name_uz : row.name_en
  return name?.trim() || row.name_en || code
}

export function CountryRiskView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const lang = uiLang(locale)
  const { actingRole } = useAuth()
  const head = useIsHeadAnalyst()
  const [params, setParams] = useSearchParams()
  const filter = parseCountryFilter(params.get('country'))
  const focusOverride = params.get('override')
  const { query } = usePageSearch('sectors')
  const countries = useCountryRisk()
  const overrides = useCountryOverrides()
  const [proposing, setProposing] = useState(false)
  const [ending, setEnding] = useState<CountryOverride | null>(null)
  const end = useEndCountryOverride()

  const all = useMemo(() => countries.data ?? [], [countries.data])
  const byCode = useMemo(() => new Map(all.map((c) => [c.country_code, c])), [all])
  const overrideById = useMemo(() => new Map((overrides.data ?? []).map((o) => [o.id, o])), [overrides.data])
  const list = oecdListState(all)

  const searched = useMemo(
    () =>
      searchRows(all, query, (r) => [r.country_code, r.name_en, r.name_ru, r.name_uz]).sort((a, b) =>
        countryLabel(a, lang, a.country_code).localeCompare(countryLabel(b, lang, b.country_code), locale),
      ),
    [all, query, lang, locale],
  )
  const counts = countryFilterCounts(searched)
  const rows = searched.filter((r) => countryMatches(r, filter))
  const pendingOverrides = (overrides.data ?? []).filter((o) => o.status === 'pending')
  const pastOverrides = (overrides.data ?? []).filter((o) => o.status !== 'pending')

  useDeepLinkFocus(focusOverride ? `override-${focusOverride}` : null, { ready: !overrides.isLoading })

  const setFilter = (next: CountryFilter) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('country')
        else p.set('country', next)
        p.delete('override')
        return p
      },
      { replace: true },
    )

  const endable = (row: CountryRiskRow) => {
    const o = row.override_id ? overrideById.get(row.override_id) : undefined
    return o && mayEndOverride({ actingRole, senior: head, override: o }) ? o : null
  }
  const showEnd = actingRole === 'credit_analyst' && head
  const columns = [COL.fill, '9.5rem', '9.5rem', '13rem', '8rem', '10rem', ...(showEnd ? ['8rem'] : [])]
  const tableHead = (
    <thead>
      <tr>
        <th>{t('risk.countries.fields.country')}</th>
        <th>{t('risk.countries.fields.oecd')}</th>
        <th>{t('risk.countries.fields.internal')}</th>
        <th>{t('risk.countries.fields.inUse')}</th>
        <th>{t('risk.countries.fields.sanctions')}</th>
        <th>{t('risk.countries.fields.pending')}</th>
        {showEnd && (
          <th>
            <span className="sr-only">{t('common.actions')}</span>
          </th>
        )}
      </tr>
    </thead>
  )

  return (
    <div>
      <ViewBar
        hint={t('risk.countries.hint')}
        actions={
          <>
            {all.length > 0 && (
              <Segmented
                value={filter}
                onChange={(k) => setFilter(k as CountryFilter)}
                ariaLabel={t('risk.countries.filters.label')}
                options={COUNTRY_FILTERS.map((f) => ({ key: f, label: `${t(`risk.countries.filters.${f}`)} · ${counts[f]}` }))}
              />
            )}
            {mayProposeOverride(actingRole) && (
              <Button onClick={() => setProposing(true)}>{t('risk.countries.propose.action')}</Button>
            )}
          </>
        }
      />

      <div className="grid gap-5">
        {!countries.isLoading && <ListBanner state={list.state} effective={list.effective} importedAt={list.importedAt} />}

        {pendingOverrides.length > 0 && (
          <Panel title={t('risk.countries.pending.title')} hint={t('risk.countries.pending.hint')}>
            <ul className="grid gap-3">
              {pendingOverrides.map((o) => (
                <PendingOverride key={o.id} override={o} country={byCode.get(o.country_code)} head={head} />
              ))}
            </ul>
          </Panel>
        )}

        {countries.isLoading ? (
          <Table id="country-risk" columns={columns}>
            {tableHead}
            <tbody>
              <SkeletonRows columns={columns.length} />
            </tbody>
          </Table>
        ) : !rows.length ? (
          <Card className="p-6">
            <EmptyState
              pictogram="search"
              title={t('common.noMatches')}
              hint={t('common.noMatchesHint')}
              action={
                filter !== 'all' ? (
                  <Button variant="secondary" onClick={() => setFilter('all')}>
                    {t('common.resetFilters')}
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Table id="country-risk" columns={columns} stickyHead>
            {tableHead}
            <tbody>
              {rows.map((r) => {
                const o = endable(r)
                return (
                  <tr key={r.country_code}>
                    <td>
                      <span className="flex min-w-0 items-center gap-2">
                        <CountryFlag code={r.country_code} />
                        <span className="truncate font-medium text-slate-800">
                          <Highlight text={countryLabel(r, lang, r.country_code)} query={query} />
                        </span>
                        <span className="font-mono text-caption text-slate-500">{r.country_code}</span>
                      </span>
                    </td>
                    <td>
                      {r.oecd_category !== null ? (
                        <CountryCategoryBadge category={r.oecd_category} source="oecd" />
                      ) : (
                        <span className="text-small text-slate-500">{t('risk.country.unclassifiedShort')}</span>
                      )}
                    </td>
                    <td>
                      {r.internal_category !== null ? (
                        <CountryCategoryBadge category={r.internal_category} source="internal" oecdCategory={r.oecd_category} />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td>
                      <span className="inline-flex max-w-full items-center gap-2">
                        <CountryCategoryBadge category={r.category} source={r.source} oecdCategory={r.oecd_category} />
                        {r.source && (
                          <span className="truncate text-caption text-slate-500">{t(`risk.countries.source.${r.source}`)}</span>
                        )}
                      </span>
                    </td>
                    <td>{r.sanctioned ? <SanctionsBadge /> : <span className="text-slate-500">—</span>}</td>
                    <td>
                      {r.override_pending ? (
                        <Badge tone="accent">{t('risk.countries.pending.marker')}</Badge>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    {showEnd && (
                      <RowActions reveal>
                        {o && (
                          <Button size="sm" variant="dangerOutline" onClick={() => setEnding(o)}>
                            {t('risk.countries.end.action')}
                          </Button>
                        )}
                      </RowActions>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}

        <Panel title={t('risk.countries.history.title')} hint={t('risk.countries.history.hint')}>
          {overrides.isLoading ? null : !pastOverrides.length ? (
            <EmptyState pictogram="documents" title={t('risk.countries.history.empty')} hint={t('risk.countries.history.emptyHint')} />
          ) : (
            <OverrideHistory overrides={pastOverrides} byCode={byCode} />
          )}
        </Panel>
      </div>

      {proposing && <ProposeModal byCode={byCode} onClose={() => setProposing(false)} />}
      {ending && (
        <ReasonModal
          title={t('risk.countries.end.title', { country: countryLabel(byCode.get(ending.country_code), lang, ending.country_code) })}
          intro={t('risk.countries.end.intro')}
          label={t('risk.countries.end.reason')}
          missingMessage={t('risk.errors.overrideEndReason')}
          submitLabel={t('risk.countries.end.action')}
          pending={end.isPending}
          onSubmit={(reason) => end.mutateAsync({ overrideId: ending.id, reason })}
          onClose={() => setEnding(null)}
        />
      )}
    </div>
  )
}

/** When the OECD list was imported — amber when it is old or missing. */
function ListBanner({ state, effective, importedAt }: { state: 'none' | 'stale' | 'current'; effective: string | null; importedAt: string | null }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  if (state === 'none')
    return (
      <Callout tone="warn" title={t('risk.countries.list.none')}>
        {t('risk.countries.list.noneHint')}
      </Callout>
    )
  const line = t('risk.countries.list.current', {
    effective: formatDate(effective, locale),
    imported: importedAt ? formatMoment(importedAt, locale) : '—',
  })
  if (state === 'stale')
    return (
      <Callout tone="warn" title={t('risk.countries.list.stale')}>
        {line} {t('risk.countries.list.staleHint')}
      </Callout>
    )
  return <p className="text-small text-slate-600">{line}</p>
}

function PendingOverride({
  override: o,
  country,
  head,
}: {
  override: CountryOverride
  country: CountryRiskRow | undefined
  head: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const lang = uiLang(locale)
  const { actingRole, session } = useAuth()
  const staff = useStaffDirectory()
  const decide = useDecideCountryOverride()
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = overrideDecisionState({ actingRole, senior: head, userId: session?.user.id, override: o })

  const approve = () => {
    setError(null)
    decide.mutateAsync({ overrideId: o.id, approve: true }).catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <li id={`override-${o.id}`} className={`rounded-lg border border-slate-200 p-4 ${DEEP_LINK_SCROLL_MARGIN}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-slate-800">
            <CountryFlag code={o.country_code} />
            {countryLabel(country, lang, o.country_code)}
            <CountryCategoryBadge category={o.category} source="internal" oecdCategory={country?.oecd_category ?? null} />
          </p>
          <p className="mt-1 text-caption text-slate-500">
            {t('risk.countries.pending.proposed', {
              name: staffName(staff.data, o.proposed_by),
              date: formatMoment(o.proposed_at, locale),
              oecd:
                country?.oecd_category !== null && country?.oecd_category !== undefined
                  ? country.oecd_category
                  : t('risk.country.unclassifiedShort'),
            })}
          </p>
        </div>
        {state === 'decide' && (
          <div className="flex flex-wrap gap-2">
            <Button variant="dangerOutline" onClick={() => setRejecting(true)}>
              {t('risk.countries.pending.reject')}
            </Button>
            <Button loading={decide.isPending && !rejecting} onClick={approve}>
              {t('risk.countries.pending.approve')}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-3 text-small leading-relaxed whitespace-pre-line text-slate-700">{o.justification}</p>
      {error && <Callout className="mt-3" tone="neg" title={error} />}
      {state === 'own' && <p className="mt-3 text-caption text-slate-500">{t('risk.countries.pending.own')}</p>}
      {state === 'notHead' && <p className="mt-3 text-caption text-slate-500">{t('risk.countries.pending.notHead')}</p>}
      {state === 'readonly' && <p className="mt-3 text-caption text-slate-500">{t('risk.countries.pending.readonly')}</p>}
      {rejecting && (
        <ReasonModal
          title={t('risk.countries.pending.rejectTitle', { country: countryLabel(country, lang, o.country_code) })}
          label={t('risk.countries.pending.rejectReason')}
          missingMessage={t('risk.errors.overrideRejectReason')}
          submitLabel={t('risk.countries.pending.reject')}
          pending={decide.isPending}
          onSubmit={(comment) => decide.mutateAsync({ overrideId: o.id, approve: false, comment })}
          onClose={() => setRejecting(false)}
        />
      )}
    </li>
  )
}

function OverrideHistory({ overrides, byCode }: { overrides: CountryOverride[]; byCode: Map<string, CountryRiskRow> }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const lang = uiLang(locale)
  const staff = useStaffDirectory()
  return (
    <Table columns={[COL.fill, '9.5rem', '9rem', COL.fill, COL.fill]}>
      <thead>
        <tr>
          <th>{t('risk.countries.fields.country')}</th>
          <th>{t('risk.countries.fields.internal')}</th>
          <th>{t('risk.countries.history.status')}</th>
          <th>{t('risk.countries.history.proposed')}</th>
          <th>{t('risk.countries.history.outcome')}</th>
        </tr>
      </thead>
      <tbody>
        {overrides.map((o) => {
          const outcome =
            o.status === 'ended'
              ? t('risk.countries.history.endedBy', {
                  name: staffName(staff.data, o.ended_by),
                  date: o.ended_at ? formatDate(o.ended_at, locale) : '—',
                  reason: o.end_reason === 'replaced' ? t('risk.countries.history.replaced') : (o.end_reason ?? '—'),
                })
              : o.decided_at
                ? t(o.status === 'rejected' ? 'risk.countries.history.rejectedBy' : 'risk.countries.history.approvedBy', {
                    name: staffName(staff.data, o.decided_by),
                    date: formatDate(o.decided_at, locale),
                  }) + (o.decision_comment ? ` — ${o.decision_comment}` : '')
                : '—'
          return (
            <tr key={o.id} id={`override-${o.id}`} className={DEEP_LINK_SCROLL_MARGIN}>
              <td>
                <span className="flex min-w-0 items-center gap-2">
                  <CountryFlag code={o.country_code} />
                  <span className="truncate">{countryLabel(byCode.get(o.country_code), lang, o.country_code)}</span>
                </span>
              </td>
              <td>
                <CountryCategoryBadge category={o.category} source="internal" oecdCategory={byCode.get(o.country_code)?.oecd_category ?? null} />
              </td>
              <td>
                <Badge tone={OVERRIDE_TONE[o.status]}>{t(`risk.countries.overrideStatus.${o.status}`)}</Badge>
              </td>
              <td className="whitespace-normal text-small text-slate-600">
                {t('risk.countries.history.proposedBy', {
                  name: staffName(staff.data, o.proposed_by),
                  date: formatDate(o.proposed_at, locale),
                })}
                <span className="block text-caption text-slate-500">{o.justification}</span>
              </td>
              <td className="whitespace-normal text-small text-slate-600">{outcome}</td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

function ProposeModal({ byCode, onClose }: { byCode: Map<string, CountryRiskRow>; onClose: () => void }) {
  const { t } = useTranslation()
  const propose = useProposeCountryOverride()
  const [country, setCountry] = useState<string | null>(null)
  const [category, setCategory] = useState<number | null>(null)
  const [justification, setJustification] = useState('')
  const [left, setLeft] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const row = country ? byCode.get(country) : undefined
  const categoryLabelId = useId()
  const leave = (k: string) => () => setLeft((prev) => new Set([...prev, k]))
  const errs = {
    country: country ? null : t('risk.countries.propose.countryRequired'),
    category: category !== null ? null : t('risk.countries.propose.categoryRequired'),
    justification: justification.trim() ? null : t('risk.errors.overrideJustification'),
  }
  const shown = (k: keyof typeof errs) => (left.has(k) ? errs[k] : null)

  const send = () => {
    setLeft(new Set(['country', 'category', 'justification']))
    setError(null)
    if (!country || category === null || !justification.trim()) return
    propose
      .mutateAsync({ countryCode: country, category, justification: justification.trim() })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('risk.countries.propose.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={propose.isPending} onClick={send}>
            {t('risk.countries.propose.submit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">{t('risk.countries.propose.hint')}</p>
      <Field label={t('risk.countries.fields.country')} error={shown('country')}>
        <span onBlur={leave('country')}>
          <CountryPicker value={country} onChange={setCountry} invalid={Boolean(shown('country'))} aria-label={t('risk.countries.fields.country')} />
        </span>
      </Field>
      {row && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-caption text-slate-500">
          {t('risk.countries.propose.now')}
          <CountryCategoryBadge category={row.category} source={row.source} oecdCategory={row.oecd_category} />
          {row.override_pending && <Badge tone="accent">{t('risk.countries.pending.marker')}</Badge>}
        </p>
      )}
      <div role="group" aria-labelledby={categoryLabelId} className="flex flex-col gap-2" onBlur={leave('category')}>
        <span id={categoryLabelId} className="text-small font-medium text-slate-700">
          {t('risk.countries.propose.category')}
        </span>
        <Segmented
          value={category === null ? '' : String(category)}
          onChange={(k) => setCategory(Number(k))}
          ariaLabel={t('risk.countries.propose.category')}
          options={COUNTRY_CATEGORIES.map((c) => ({ key: String(c), label: String(c) }))}
        />
        {shown('category') ? (
          <span className="text-caption font-medium text-danger-700" role="alert">
            {shown('category')}
          </span>
        ) : (
          <span className="text-caption text-slate-500">{t('risk.countries.propose.categoryHint')}</span>
        )}
      </div>
      <Field label={t('risk.countries.propose.justification')} hint={t('risk.countries.propose.justificationHint')} error={shown('justification')}>
        <Textarea rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} onBlur={leave('justification')} />
      </Field>
    </Modal>
  )
}
