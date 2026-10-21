/**
 * «Договоры»: where a draft contract is made. Pick a policy or a submission
 * and generate its contract from the insurer's active wording template (the
 * data — policyholder, terms, credit limits — comes from the database), and
 * find every contract generated so far in the register. When no template is
 * active yet, the page says so and offers the standard ones.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Input, ViewBar, Spinner, Table, Tabs } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatMoment, formatDate } from '../../lib/format'
import { usePolicies } from '../policies/api'
import { statusTone } from '../policies/statusMachine'
import { useInsuranceRequests } from '../requests/api'
import type { ProductStructure, WordingTarget } from './api'
import { useAllPolicyDocuments, useWordingTemplates, wordingDownloadUrl } from './api'
import { contractSubmissions } from './contracts'
import { wordingErrorKey } from './errors'
import { GenerateContractModal } from './GenerateContractModal'
import { languageName } from './labels'
import { useInstallStandardTemplates } from './standardTemplates'

type Tab = 'policies' | 'submissions' | 'register'

interface Pick {
  target: WordingTarget
  reference: string
  countryCode: string | null
  product: ProductStructure | null
}

export function ContractsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const canManageTemplates = roles.includes('admin') || roles.includes('commercial_underwriter')

  const { data: templates, isLoading: templatesLoading } = useWordingTemplates()
  const { data: policies, isLoading: policiesLoading } = usePolicies()
  const { data: requests, isLoading: requestsLoading } = useInsuranceRequests()
  const { data: documents } = useAllPolicyDocuments()
  const { install, installing } = useInstallStandardTemplates()

  const [tab, setTab] = useState<Tab>('policies')
  const [search, setSearch] = useState('')
  const [pick, setPick] = useState<Pick | null>(null)
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

  const policyRows = (policies ?? []).filter((p) => matches(p.policy_number, p.legal_entities?.name))
  const submissionRows = contractSubmissions(requests ?? []).filter((r) =>
    matches(r.request_number, r.legal_entities?.name),
  )
  const registerRows = (documents ?? []).filter((d) =>
    matches(d.policies?.policy_number, d.insurance_requests?.request_number, d.wording_templates?.name, d.file_name),
  )

  const installStandard = () => {
    setError(null)
    install().catch((e: unknown) => setError(t(wordingErrorKey(e))))
  }

  const download = (path: string, fileName: string) =>
    void wordingDownloadUrl(path, fileName)
      .then((url) => window.open(url, '_blank', 'noopener'))
      .catch((e: unknown) => setError(t(wordingErrorKey(e))))

  const generateButton = (next: Pick) => (
    <Button size="sm" variant="secondary" disabled={activeCount === 0} onClick={() => setPick(next)}>
      {t('contracts.generate')}
    </Button>
  )

  return (
    <div>
      <ViewBar hint={t('contracts.subtitle')} />

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
                <Link
                  to="/policies?view=templates"
                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  {t('wording.upload.open')}
                </Link>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-3">
          <Tabs
            tabs={[
              { key: 'policies', label: t('contracts.tabs.policies'), count: policyRows.length },
              { key: 'submissions', label: t('contracts.tabs.submissions'), count: submissionRows.length },
              { key: 'register', label: t('contracts.tabs.register'), count: registerRows.length },
            ]}
            active={tab}
            onChange={(key) => setTab(key as Tab)}
          />
          <div className="w-full pb-2 sm:w-72">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('contracts.searchPlaceholder')}
              aria-label={t('contracts.searchPlaceholder')}
            />
          </div>
        </div>

        <div className="px-5 pt-1 pb-5">
          {tab === 'policies' &&
            (policiesLoading ? (
              <Spinner />
            ) : !policyRows.length ? (
              <EmptyState title={t('contracts.empty.policies')} hint={t('contracts.empty.policiesHint')} />
            ) : (
              <Table dense>
                <thead>
                  <tr>
                    <th>{t('policies.fields.policyNumber')}</th>
                    <th>{t('policies.fields.policyholder')}</th>
                    <th>{t('policies.fields.productStructure')}</th>
                    <th>{t('policies.fields.period')}</th>
                    <th>{t('policies.fields.currency')}</th>
                    <th>{t('policies.fields.status')}</th>
                    <th className="text-right">{t('contracts.columns.documents')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {policyRows.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium whitespace-nowrap">
                        <Link to={`/policies/${p.id}?tab=contract`} className="text-accent-600 hover:text-accent-500">
                          {p.policy_number}
                        </Link>
                      </td>
                      <td className="text-slate-600">{p.legal_entities?.name ?? EM_DASH}</td>
                      <td className="text-slate-500">{t(`policies.structures.${p.product_structure}`)}</td>
                      <td className="whitespace-nowrap text-slate-500">
                        {formatDate(p.inception_date, locale)} — {formatDate(p.expiry_date, locale)}
                      </td>
                      <td>{p.currency_code}</td>
                      <td>
                        <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                      </td>
                      <td className="num text-right">{docCount.get(p.id) ?? 0}</td>
                      <td className="text-right">
                        {generateButton({
                          target: { policyId: p.id },
                          reference: p.policy_number,
                          countryCode: p.legal_entities?.country_code ?? null,
                          product: p.product_structure,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === 'submissions' &&
            (requestsLoading ? (
              <Spinner />
            ) : !submissionRows.length ? (
              <EmptyState title={t('contracts.empty.submissions')} hint={t('contracts.empty.submissionsHint')} />
            ) : (
              <Table dense>
                <thead>
                  <tr>
                    <th>{t('contracts.columns.submission')}</th>
                    <th>{t('contracts.columns.applicant')}</th>
                    <th>{t('policies.fields.productStructure')}</th>
                    <th>{t('policies.fields.currency')}</th>
                    <th>{t('policies.fields.status')}</th>
                    <th className="text-right">{t('contracts.columns.documents')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {submissionRows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium whitespace-nowrap">
                        <Link to={`/requests/${r.id}`} className="text-accent-600 hover:text-accent-500">
                          {r.request_number}
                        </Link>
                      </td>
                      <td className="text-slate-600">{r.legal_entities?.name ?? EM_DASH}</td>
                      <td className="text-slate-500">
                        {r.product_structure ? t(`policies.structures.${r.product_structure}`) : EM_DASH}
                      </td>
                      <td>{r.currency_code ?? EM_DASH}</td>
                      <td>
                        <Badge tone="accent">{t(`requests.statuses.${r.status}`)}</Badge>
                      </td>
                      <td className="num text-right">{docCount.get(r.id) ?? 0}</td>
                      <td className="text-right">
                        {generateButton({
                          target: { requestId: r.id },
                          reference: r.request_number,
                          countryCode: r.legal_entities?.country_code ?? null,
                          product: r.product_structure ?? null,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === 'register' &&
            (!registerRows.length ? (
              <EmptyState title={t('contracts.empty.register')} hint={t('contracts.empty.registerHint')} />
            ) : (
              <Table dense>
                <thead>
                  <tr>
                    <th>{t('wording.generate.generatedAt')}</th>
                    <th>{t('contracts.columns.for')}</th>
                    <th>{t('wording.fields.name')}</th>
                    <th>{t('wording.fields.language')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {registerRows.map((d) => (
                    <tr key={d.id}>
                      <td className="text-xs">{formatMoment(d.generated_at, locale)}</td>
                      <td>
                        {d.policy_id ? (
                          <Link to={`/policies/${d.policy_id}?tab=contract`} className="text-accent-600 hover:text-accent-500">
                            {t('contracts.forPolicy', { number: d.policies?.policy_number ?? EM_DASH })}
                          </Link>
                        ) : (
                          <Link
                            to={`/requests/${d.insurance_request_id ?? ''}`}
                            className="text-accent-600 hover:text-accent-500"
                          >
                            {t('contracts.forSubmission', { number: d.insurance_requests?.request_number ?? EM_DASH })}
                          </Link>
                        )}
                      </td>
                      <td>
                        {d.wording_templates?.name ?? EM_DASH}{' '}
                        <span className="text-xs text-slate-400">v{d.template_version}</span>
                      </td>
                      <td>{languageName(d.language, locale)}</td>
                      <td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => download(d.storage_path, d.file_name)}>
                          {t('wording.templates.download')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}
        </div>
      </Card>

      {pick && (
        <GenerateContractModal
          open
          onClose={() => setPick(null)}
          target={pick.target}
          reference={pick.reference}
          countryCode={pick.countryCode}
          product={pick.product}
        />
      )}
    </div>
  )
}
