/**
 * «Договоры»: where a draft contract is made. One action in the bar —
 * «Сформировать договор», which asks for the policy or submission in its
 * dialog — and below it the policies, the live submissions and the register
 * of every contract generated so far, switched by one control (no tabs inside
 * the section's own tabs). A row opens its policy's «Договор» tab or its
 * submission, where the contract history lives. When no template is active
 * yet, the page says so and offers the standard ones.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  actionsCol,
  Badge,
  Button,
  Card,
  COL,
  EmptyState,
  Input,
  labelCol,
  LinkButton,
  RowActions,
  Segmented,
  Spinner,
  Table,
  Truncate,
  ViewBar,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatMoment, formatDate } from '../../lib/format'
import { usePolicies } from '../policies/api'
import { statusTone } from '../policies/statusMachine'
import { useInsuranceRequests } from '../requests/api'
import { statusTone as requestStatusTone } from '../requests/machine'
import { useAllDrafts } from '../contracts/api'
import { CONTRACT_STATUS_COL } from '../contracts/columns'
import { statusTone as draftStatusTone } from '../contracts/machine'
import { draftPath } from '../contracts/paths'
import { useAllPolicyDocuments, useWordingTemplates, wordingDownloadUrl } from './api'
import { contractSubmissions } from './contracts'
import { wordingErrorKey } from './errors'
import { GenerateContractModal } from './GenerateContractModal'
import type { SubjectChoice } from './GenerateContractModal'
import { languageName } from './labels'
import { useInstallStandardTemplates, useTemplateText } from './standardTemplates'

type Segment = 'policies' | 'submissions' | 'drafts' | 'register'

const rowLink = 'cursor-pointer transition-colors hover:bg-slate-50'

export function ContractsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { roles } = useAuth()
  const canManageTemplates = roles.includes('admin') || roles.includes('commercial_underwriter')
  const canGenerate = roles.some((r) => r === 'commercial_underwriter' || r === 'sales')

  const { data: templates, isLoading: templatesLoading } = useWordingTemplates()
  const { data: policies, isLoading: policiesLoading } = usePolicies()
  const { data: requests, isLoading: requestsLoading } = useInsuranceRequests()
  const { data: documents } = useAllPolicyDocuments()
  const { data: drafts } = useAllDrafts()
  const { install, installing } = useInstallStandardTemplates()
  const text = useTemplateText()

  const [segment, setSegment] = useState<Segment>('policies')
  const [search, setSearch] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeCount = (templates ?? []).filter((x) => x.status === 'active').length
  const query = search.trim().toLowerCase()
  const matches = (...values: (string | null | undefined)[]) =>
    !query || values.some((v) => v?.toLowerCase().includes(query))

  const docCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of documents ?? []) {
      const key = d.policy_id ?? d.insurance_request_id ?? ''
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [documents])

  const liveSubmissions = useMemo(() => contractSubmissions(requests ?? []), [requests])
  const policyRows = (policies ?? []).filter((p) => matches(p.policy_number, p.legal_entities?.name))
  const submissionRows = liveSubmissions.filter((r) => matches(r.request_number, r.legal_entities?.name))
  const registerRows = (documents ?? []).filter((d) =>
    matches(d.policies?.policy_number, d.insurance_requests?.request_number, text.name(d.wording_templates), d.file_name),
  )

  // What the dialog offers: every policy and every live submission.
  const choices = useMemo<SubjectChoice[]>(
    () => [
      ...(policies ?? []).map((p) => ({
        id: `p:${p.id}`,
        label: t('contracts.forPolicy', { number: p.policy_number }),
        meta: p.legal_entities?.name ?? undefined,
        target: { policyId: p.id },
        reference: p.policy_number,
        countryCode: p.legal_entities?.country_code ?? null,
        product: p.product_structure,
      })),
      ...liveSubmissions.map((r) => ({
        id: `r:${r.id}`,
        label: t('contracts.forSubmission', { number: r.request_number }),
        meta: r.legal_entities?.name ?? undefined,
        target: { requestId: r.id },
        reference: r.request_number,
        countryCode: r.legal_entities?.country_code ?? null,
        product: r.product_structure ?? null,
      })),
    ],
    [policies, liveSubmissions, t],
  )

  const installStandard = () => {
    setError(null)
    install().catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  const download = (path: string, fileName: string) =>
    void wordingDownloadUrl(path, fileName)
      .then((url) => window.open(url, '_blank', 'noopener'))
      .catch((e: unknown) => setError(t(wordingErrorKey(e))))

  const draftRows = (drafts ?? []).filter((d) =>
    matches(d.draft_number, d.policies?.policy_number, d.insurance_requests?.request_number,
      d.policies?.legal_entities?.name, d.insurance_requests?.legal_entities?.name),
  )

  const counts: Record<Segment, number> = {
    drafts: draftRows.length,
    policies: policyRows.length,
    submissions: submissionRows.length,
    register: registerRows.length,
  }

  return (
    <div>
      <ViewBar
        hint={t('contracts.subtitle')}
        actions={
          canGenerate && (
            // While no template is active the notice below says why.
            <span title={activeCount === 0 ? t('contracts.noTemplates.title') : undefined} className="inline-flex">
              <Button disabled={activeCount === 0} onClick={() => setGenerating(true)}>
                {t('contracts.generate')}
              </Button>
            </span>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500" role="alert">
          {error}
        </div>
      )}

      {!templatesLoading && activeCount === 0 && (
        <Card className="mb-5 border-warn-500/30 bg-warn-50/60 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="font-semibold text-slate-800">{t('contracts.noTemplates.title')}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
                {canManageTemplates ? t('contracts.noTemplates.hintManager') : t('contracts.noTemplates.hintOther')}
              </p>
            </div>
            {canManageTemplates && (
              <div className="flex flex-wrap gap-2">
                <Button variant="accent" disabled={installing} onClick={installStandard}>
                  {installing ? t('common.saving') : t('wording.standard.install')}
                </Button>
                <LinkButton to="/policies?view=templates" variant="secondary">
                  {t('wording.upload.open')}
                </LinkButton>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={segment}
          ariaLabel={t('contracts.title')}
          options={(['policies', 'submissions', 'drafts', 'register'] as const).map((key) => ({
            key,
            label: `${t(`contracts.tabs.${key}`)} (${counts[key]})`,
          }))}
          onChange={(key) => setSegment(key as Segment)}
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('contracts.searchPlaceholder')}
          aria-label={t('contracts.searchPlaceholder')}
          className="w-full sm:w-72"
        />
      </div>

      <Card className="p-5">
        {segment === 'policies' &&
          (policiesLoading ? (
            <Spinner />
          ) : !policyRows.length ? (
            query ? (
              <NoMatches onReset={() => setSearch('')} />
            ) : (
              <EmptyState title={t('contracts.empty.policies')} hint={t('contracts.empty.policiesHint')} />
            )
          ) : (
            <Table dense columns={[COL.code, COL.fill, COL.period, labelCol('policyStatus'), COL.count]}>
              <thead>
                <tr>
                  <th>{t('policies.fields.policyNumber')}</th>
                  <th>{t('policies.fields.policyholder')}</th>
                  <th>{t('policies.fields.period')}</th>
                  <th>{t('policies.fields.status')}</th>
                  <th className="num">{t('contracts.columns.documents')}</th>
                </tr>
              </thead>
              <tbody>
                {policyRows.map((p) => (
                  <tr key={p.id} className={rowLink} onClick={() => void navigate(`/policies/${p.id}?tab=contract`)}>
                    <td className="font-medium whitespace-nowrap text-accent-700 tabular-nums">{p.policy_number}</td>
                    <td className="text-slate-600">
                      <Truncate text={p.legal_entities?.name} className="max-w-none">
                        {p.legal_entities?.name ?? EM_DASH}
                      </Truncate>
                      <span className="block text-[12px] text-slate-500">{t(`policies.structures.${p.product_structure}`)}</span>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {formatDate(p.inception_date, locale)} — {formatDate(p.expiry_date, locale)}
                    </td>
                    <td>
                      <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                    </td>
                    <td className="num">{docCount.get(p.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {segment === 'submissions' &&
          (requestsLoading ? (
            <Spinner />
          ) : !submissionRows.length ? (
            query ? (
              <NoMatches onReset={() => setSearch('')} />
            ) : (
              <EmptyState title={t('contracts.empty.submissions')} hint={t('contracts.empty.submissionsHint')} />
            )
          ) : (
            <Table dense columns={[COL.code, COL.fill, labelCol('policyStructure'), labelCol('requestStatus'), COL.count]}>
              <thead>
                <tr>
                  <th>{t('contracts.columns.submission')}</th>
                  <th>{t('contracts.columns.applicant')}</th>
                  <th>{t('policies.fields.productStructure')}</th>
                  <th>{t('policies.fields.status')}</th>
                  <th className="num">{t('contracts.columns.documents')}</th>
                </tr>
              </thead>
              <tbody>
                {submissionRows.map((r) => (
                  <tr key={r.id} className={rowLink} onClick={() => void navigate(`/requests/${r.id}`)}>
                    <td className="font-medium whitespace-nowrap text-accent-700 tabular-nums">{r.request_number}</td>
                    <td className="text-slate-600">
                      <Truncate text={r.legal_entities?.name} className="max-w-none">
                        {r.legal_entities?.name ?? EM_DASH}
                      </Truncate>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {r.product_structure ? t(`policies.structures.${r.product_structure}`) : EM_DASH}
                    </td>
                    <td>
                      <Badge tone={requestStatusTone(r.status)}>{t(`requests.statuses.${r.status}`)}</Badge>
                    </td>
                    <td className="num">{docCount.get(r.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {segment === 'drafts' &&
          (!draftRows.length ? (
            query ? (
              <NoMatches onReset={() => setSearch('')} />
            ) : (
              <EmptyState title={t('contractDrafts.register.empty')} hint={t('contractDrafts.register.emptyHint')} />
            )
          ) : (
            <Table dense columns={[COL.code, '13rem', COL.fill, CONTRACT_STATUS_COL, '5rem', COL.moment]}>
              <thead>
                <tr>
                  <th>{t('contractDrafts.register.number')}</th>
                  <th>{t('contracts.columns.for')}</th>
                  <th>{t('contracts.columns.applicant')}</th>
                  <th>{t('contractDrafts.columns.status')}</th>
                  <th>{t('contractDrafts.columns.version')}</th>
                  <th>{t('contractDrafts.columns.saved')}</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.map((d) => {
                  const holder = d.policies?.legal_entities?.name ?? d.insurance_requests?.legal_entities?.name ?? EM_DASH
                  return (
                    <tr key={d.id} className={rowLink} onClick={() => void navigate(draftPath(d.id))}>
                      <td className="font-mono text-accent-700">{d.draft_number}</td>
                      <td>
                        {d.policy_id
                          ? t('contracts.forPolicy', { number: d.policies?.policy_number ?? EM_DASH })
                          : t('contracts.forSubmission', { number: d.insurance_requests?.request_number ?? EM_DASH })}
                      </td>
                      <td className="text-slate-600">
                        <Truncate text={holder} className="max-w-none">
                          {holder}
                        </Truncate>
                      </td>
                      <td>
                        <Badge tone={draftStatusTone(d.status)}>{t(`contractDrafts.statuses.${d.status}`)}</Badge>
                      </td>
                      <td className="tabular-nums">v{d.current_version_no}</td>
                      <td className="tabular-nums">{formatMoment(d.updated_at, locale)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          ))}

        {segment === 'register' &&
          (!registerRows.length ? (
            query ? (
              <NoMatches onReset={() => setSearch('')} />
            ) : (
              <EmptyState title={t('contracts.empty.register')} hint={t('contracts.empty.registerHint')} />
            )
          ) : (
            <Table dense columns={[COL.moment, '13rem', COL.fill, '8rem', actionsCol(['download'])]}>
              <thead>
                <tr>
                  <th>{t('wording.generate.generatedAt')}</th>
                  <th>{t('contracts.columns.for')}</th>
                  <th>{t('wording.generate.template')}</th>
                  <th>{t('wording.fields.language')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {registerRows.map((d) => {
                  const name = text.name(d.wording_templates)
                  return (
                    <tr
                      key={d.id}
                      className={rowLink}
                      onClick={() =>
                        void navigate(
                          d.policy_id ? `/policies/${d.policy_id}?tab=contract` : `/requests/${d.insurance_request_id ?? ''}`,
                        )
                      }
                    >
                      <td className="whitespace-nowrap tabular-nums">{formatMoment(d.generated_at, locale)}</td>
                      <td className="whitespace-nowrap text-accent-700">
                        {d.policy_id
                          ? t('contracts.forPolicy', { number: d.policies?.policy_number ?? EM_DASH })
                          : t('contracts.forSubmission', { number: d.insurance_requests?.request_number ?? EM_DASH })}
                      </td>
                      <td>
                        <Truncate text={`${name} v${d.template_version}`} className="max-w-none">
                          {name} <span className="text-xs text-slate-400 tabular-nums">v{d.template_version}</span>
                        </Truncate>
                      </td>
                      <td className="whitespace-nowrap">{languageName(d.language, locale)}</td>
                      <RowActions>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            // The row opens the policy; this button only downloads.
                            e.stopPropagation()
                            download(d.storage_path, d.file_name)
                          }}
                        >
                          {t('wording.templates.download')}
                        </Button>
                      </RowActions>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          ))}
      </Card>

      {canGenerate && (
        <GenerateContractModal open={generating} onClose={() => setGenerating(false)} choices={choices} />
      )}
    </div>
  )
}

function NoMatches({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      title={t('common.noMatches')}
      hint={t('common.noMatchesHint')}
      action={
        <Button variant="secondary" onClick={onReset}>
          {t('common.resetFilters')}
        </Button>
      }
    />
  )
}
