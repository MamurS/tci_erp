/**
 * One data request. For a missing company the information manager looks it
 * up in an official registry (or enters it by hand), then either creates it
 * or points the request at a company we already hold. For statements they
 * enter them on the company's financials tab and mark the request done. A
 * refusal needs a reason the requester will read.
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Button,
  Callout,
  Card,
  DescriptionList,
  DetailHeader,
  EmptyState,
  Field,
  Modal,
  Panel,
  PanelGrid,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui'
import type { RegistryRecord } from '../../lib/analytics'
import { formatMoment } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { EntityFormModal } from '../entities/EntityFormModal'
import { useCountryName } from '../portfolio/useCountryName'
import { useAssignRequest, useEntityRequest, useResolveRequest, useStaffDirectory, useTakeRequest } from './api'
import { LinkExistingPanel } from './LinkExistingPanel'
import { RegistryPanel } from './RegistryPanel'
import { STATUS_TONE, canWorkRequests, isOpen } from './requests'
import { informationManagers, staffName } from './staff'

export function RequestPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles, session } = useAuth()
  const me = session?.user.id
  const countryName = useCountryName()
  const { data: request, isLoading } = useEntityRequest(id)
  const staff = useStaffDirectory()
  const take = useTakeRequest()
  const assign = useAssignRequest()
  const resolve = useResolveRequest()
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState<RegistryRecord | 'manual' | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reassigning, setReassigning] = useState(false)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!request)
    return (
      <Card className="p-6">
        <EmptyState title={t('data.request.notFound')} />
      </Card>
    )

  const open = isOpen(request.status)
  const worker = canWorkRequests(roles)
  const mineToWork = open && worker && request.assigned_to === me
  const run = (p: Promise<unknown>) => {
    setError(null)
    return p.catch((e: unknown) => {
      setError(t(refusalKey(e)))
      throw e
    })
  }

  const prefill =
    creating === null
      ? undefined
      : creating === 'manual'
        ? { name: request.requested_name ?? '', country_code: request.country_code ?? undefined, registration_number: request.registration_number }
        : {
            name: creating.name,
            country_code: creating.country_code ?? request.country_code ?? undefined,
            registration_number: creating.registration_number,
            address: creating.address,
            founded_date: creating.founded_date,
            legal_form: creating.legal_form,
          }

  return (
    <div>
      <DetailHeader
        eyebrow={`${t('data.request.eyebrow')} · ${request.request_number}`}
        title={request.requested_name ?? '—'}
        status={<Badge tone={STATUS_TONE[request.status]}>{t(`data.statuses.${request.status}`)}</Badge>}
        meta={[
          t(`data.kinds.${request.kind}`),
          request.country_code && countryName(request.country_code),
          `${t('data.fields.requestedBy')}: ${staffName(staff.data, request.requested_by)}`,
          formatMoment(request.created_at, locale),
        ]}
        actions={
          open && worker ? (
            <>
              {request.assigned_to !== me && (
                <Button onClick={() => void run(take.mutateAsync(request.id))}>{t('data.actions.take')}</Button>
              )}
              {request.assigned_to === me && request.status === 'new' && (
                <Button onClick={() => void run(take.mutateAsync(request.id))}>{t('data.actions.start')}</Button>
              )}
              <Button variant="secondary" onClick={() => setReassigning(true)}>
                {t('data.actions.reassign')}
              </Button>
              <Button variant="dangerOutline" onClick={() => setRejecting(true)}>
                {t('data.actions.reject')}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
        {error && <Callout tone="neg" title={error} />}
        {!open && (
          <Callout
            tone={request.status === 'rejected' ? 'warn' : 'pos'}
            title={t(`data.request.outcome.${request.status}`, {
              when: request.resolved_at ? formatMoment(request.resolved_at, locale) : '',
              who: staffName(staff.data, request.resolved_by),
            })}
            action={
              request.entity_id && (
                <Link to={`/entities/${request.entity_id}`} className="font-medium text-accent-600 hover:underline">
                  {t('data.request.openCompany')}
                </Link>
              )
            }
          >
            {request.resolution_note}
          </Callout>
        )}
        {open && worker && request.assigned_to !== me && (
          <Callout
            tone="info"
            title={
              request.assigned_to
                ? t('data.request.heldBy', { name: staffName(staff.data, request.assigned_to) })
                : t('data.request.unassigned')
            }
          />
        )}
      </div>

      <PanelGrid>
        <Panel title={t('data.request.what')} hint={t('data.request.whatHint')}>
          <DescriptionList
            items={[
              { label: t('data.fields.company'), value: request.requested_name ?? '—' },
              { label: t('data.fields.country'), value: request.country_code ? countryName(request.country_code) : '—' },
              { label: t('data.fields.registrationNumber'), value: request.registration_number ?? '—' },
              { label: t('data.fields.assignedTo'), value: request.assigned_to ? staffName(staff.data, request.assigned_to) : t('data.unassigned') },
              {
                label: t('data.fields.assignedAt'),
                value: request.assigned_at ? formatMoment(request.assigned_at, locale) : '—',
              },
            ]}
          />
          {request.note && (
            <p className="mt-4 border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-600">
              {request.note}
            </p>
          )}
        </Panel>

        {request.kind === 'statements_update' ? (
          <Panel title={t('data.request.statementsTitle')} hint={open ? t('data.request.statementsHint') : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              {request.entity_id && (
                <>
                  <Button variant="secondary" onClick={() => void navigate(`/entities/${request.entity_id}?tab=financials`)}>
                    {t('data.request.openFinancials')}
                  </Button>
                  <Button variant="secondary" onClick={() => void navigate(`/entities/${request.entity_id}/statements/new`)}>
                    {t('data.request.enterStatement')}
                  </Button>
                </>
              )}
              {mineToWork && (
                <Button
                  onClick={() => void run(resolve.mutateAsync({ id: request.id, outcome: 'updated' }))}
                >
                  {t('data.actions.markUpdated')}
                </Button>
              )}
            </div>
            {!mineToWork && open && worker && (
              <p className="mt-3 text-[12px] text-slate-500">{t('data.request.takeFirst')}</p>
            )}
          </Panel>
        ) : (
          <Panel title={t('data.request.resolveTitle')} hint={open ? t('data.request.resolveHint') : undefined}>
            {mineToWork ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setCreating('manual')}>{t('data.actions.createManually')}</Button>
              </div>
            ) : (
              <p className="text-[13px] text-slate-500">
                {open && worker ? t('data.request.takeFirst') : t('data.request.closed')}
              </p>
            )}
          </Panel>
        )}
      </PanelGrid>

      {request.kind === 'new_company' && mineToWork && (
        <PanelGrid className="mt-5">
          <RegistryPanel
            initialQuery={request.requested_name ?? ''}
            country={request.country_code}
            onUse={(record) => setCreating(record)}
          />
          <LinkExistingPanel
            initialQuery={request.requested_name ?? ''}
            onLink={(entityId) =>
              void run(resolve.mutateAsync({ id: request.id, outcome: 'linked', entityId }))
            }
          />
        </PanelGrid>
      )}

      <EntityFormModal
        open={creating !== null}
        onClose={() => setCreating(null)}
        prefill={prefill}
        onCreated={(entity) => {
          setCreating(null)
          void run(resolve.mutateAsync({ id: request.id, outcome: 'created', entityId: entity.id }))
        }}
      />

      <RejectModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        onConfirm={(note) =>
          run(resolve.mutateAsync({ id: request.id, outcome: 'rejected', note })).then(() => setRejecting(false))
        }
      />

      <ReassignModal
        open={reassigning}
        current={request.assigned_to}
        people={informationManagers(staff.data)}
        onClose={() => setReassigning(false)}
        onConfirm={(userId) =>
          run(assign.mutateAsync({ id: request.id, userId })).then(() => setReassigning(false))
        }
      />

    </div>
  )
}

function RejectModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (note: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  return (
    <Modal
      open={open}
      title={t('data.actions.reject')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={!note.trim()} onClick={() => void onConfirm(note.trim()).catch(() => {})}>
            {t('data.actions.reject')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-slate-600">{t('data.request.rejectHint')}</p>
      <Field label={t('data.fields.reason')}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}

function ReassignModal({
  open,
  current,
  people,
  onClose,
  onConfirm,
}: {
  open: boolean
  current: string | null
  people: { user_id: string; full_name: string | null; email: string }[]
  onClose: () => void
  onConfirm: (userId: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [userId, setUserId] = useState('')
  const choices = people.filter((p) => p.user_id !== current)
  return (
    <Modal
      open={open}
      title={t('data.actions.reassign')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!userId} onClick={() => void onConfirm(userId).catch(() => {})}>
            {t('data.actions.reassign')}
          </Button>
        </>
      }
    >
      {choices.length ? (
        <Field label={t('data.fields.assignedTo')}>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t('data.request.pickPerson')}</option>
            {choices.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.full_name?.trim() || p.email}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-[13px] text-slate-500">{t('data.request.noOtherManagers')}</p>
      )}
    </Modal>
  )
}
