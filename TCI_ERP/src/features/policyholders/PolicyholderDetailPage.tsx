/** Policyholder card: editable requisites + their policies with status badges. */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Table,
} from '../../components/ui'
import { refName } from '../buyers/api'
import { countryFlag } from '../../lib/countryFlag'
import { EM_DASH } from '../../lib/format'
import { usePolicies } from '../policies/api'
import { statusTone } from '../policies/statusMachine'
import { usePolicyholder, useUpdatePolicyholder } from './api'
import { PolicyholderFormModal } from './PolicyholderFormModal'

export function PolicyholderDetailPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const { data: policyholder, isLoading } = usePolicyholder(id)
  const { data: allPolicies } = usePolicies()
  const updatePolicyholder = useUpdatePolicyholder(id)
  const [editOpen, setEditOpen] = useState(false)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!policyholder) {
    return (
      <EmptyState
        title={t('policyholders.notFound')}
        action={
          <Link to="/policyholders" className="text-sm font-medium text-accent-700 hover:underline">
            {t('policyholders.backToList')}
          </Link>
        }
      />
    )
  }

  const policies = (allPolicies ?? []).filter((p) => p.policyholder_id === id)

  const requisites: { label: string; value: React.ReactNode }[] = [
    { label: t('policyholders.fields.name'), value: policyholder.name },
    { label: t('policyholders.fields.legalForm'), value: policyholder.legal_form || EM_DASH },
    {
      label: t('policyholders.fields.country'),
      value: `${countryFlag(policyholder.country_code)} ${refName(policyholder.countries, locale)}`,
    },
    {
      label: t('policyholders.fields.industry'),
      value: refName(policyholder.industries, locale) || EM_DASH,
    },
    {
      label: t('policyholders.fields.registrationNumber'),
      value: policyholder.registration_number,
    },
    { label: t('policyholders.fields.address'), value: policyholder.address || EM_DASH },
    { label: t('policyholders.fields.contactPerson'), value: policyholder.contact_person || EM_DASH },
    {
      label: t('policyholders.fields.contactEmail'),
      value: policyholder.contact_email || EM_DASH,
    },
    {
      label: t('policyholders.fields.contactPhone'),
      value: policyholder.contact_phone || EM_DASH,
    },
    { label: t('policyholders.fields.notes'), value: policyholder.notes || EM_DASH },
  ]

  return (
    <div>
      <PageHeader
        title={
          <span>
            <span className="mr-2">{countryFlag(policyholder.country_code)}</span>
            {policyholder.name}
          </span>
        }
        subtitle={
          <span>
            <Link to="/policyholders" className="text-accent-700 hover:underline">
              {t('nav.policyholders')}
            </Link>
            {' / '}
            {policyholder.registration_number}
          </span>
        }
        actions={
          <Button onClick={() => void navigate(`/policies/new?policyholder=${id}`)}>
            {t('policies.newPolicy')}
          </Button>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('buyers.basicInfo')}</h2>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              {t('common.edit')}
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {requisites.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="break-words text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            {t('policyholders.policiesTitle')}
          </h2>
          {policies.length === 0 ? (
            <EmptyState
              title={t('policies.emptyForPolicyholder')}
              action={
                <Button onClick={() => void navigate(`/policies/new?policyholder=${id}`)}>
                  {t('policies.newPolicy')}
                </Button>
              }
            />
          ) : (
            <Table dense>
              <thead>
                <tr>
                  <th>{t('policies.fields.policyNumber')}</th>
                  <th>{t('policies.fields.productStructure')}</th>
                  <th>{t('policies.fields.period')}</th>
                  <th>{t('policies.fields.currency')}</th>
                  <th>{t('policies.fields.status')}</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => void navigate(`/policies/${p.id}`)}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <td className="font-medium text-slate-800">{p.policy_number}</td>
                    <td className="text-slate-500">
                      {t(`policies.structures.${p.product_structure}`)}
                    </td>
                    <td className="text-slate-500">
                      {p.inception_date} — {p.expiry_date}
                    </td>
                    <td>{p.currency_code}</td>
                    <td>
                      <Badge tone={statusTone(p.status)}>
                        {t(`policies.statuses.${p.status}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>

      <PolicyholderFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={policyholder}
        onSubmit={async (input) => {
          await updatePolicyholder.mutateAsync(input)
        }}
      />
    </div>
  )
}
