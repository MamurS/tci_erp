/**
 * «Бенефициары и руководители» (migration 0091): the people behind a
 * company — beneficial owners, shareholders, directors — screened against the
 * sanctions lists with it. The information desk and credit analysts record
 * them (with where it was read) and end them with a reason; nothing is
 * deleted or edited. Every change screens the company again at once.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Button,
  Callout,
  COL,
  DateInput,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Table,
  Textarea,
} from '../../components/ui'
import { todayIso } from '../../components/ui/dateEntry'
import { formatDate } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { CountryPicker } from '../entities/CountryPicker'
import { useAddOwner, useBeneficialOwners, useEndOwner } from './api'
import type { BeneficialOwner } from './api'
import { mayEnterOwners, OWNER_ROLES } from './model'
import type { OwnerRole } from './model'

export function BeneficialOwnersPanel({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { actingRole } = useAuth()
  const owners = useBeneficialOwners(entityId)
  const writer = mayEnterOwners(actingRole)
  const [adding, setAdding] = useState(false)
  const [ending, setEnding] = useState<BeneficialOwner | null>(null)
  const [showEnded, setShowEnded] = useState(false)
  const all = owners.data ?? []
  const current = all.filter((o) => !o.ended_at)
  const rows = showEnded ? all : current

  return (
    <Panel
      title={t('sanctions.owners.title')}
      hint={t('sanctions.owners.hint')}
      actions={
        <>
          {all.length > current.length && (
            <Button size="sm" variant="ghost" aria-pressed={showEnded} onClick={() => setShowEnded((v) => !v)}>
              {showEnded ? t('sanctions.owners.hideEnded') : t('sanctions.owners.showEnded')}
            </Button>
          )}
          {writer && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              {t('sanctions.owners.add')}
            </Button>
          )}
        </>
      }
    >
      {owners.isLoading ? null : rows.length === 0 ? (
        <EmptyState
          pictogram="companies"
          title={t('sanctions.owners.empty')}
          hint={t(writer ? 'sanctions.owners.emptyHintWriter' : 'sanctions.owners.emptyHint')}
        />
      ) : (
        <Table columns={[COL.fill, '9rem', ...(writer ? ['8rem'] : [])]}>
          <thead>
            <tr>
              <th>{t('sanctions.owners.person')}</th>
              <th>{t('sanctions.owners.share')}</th>
              {writer && (
                <th>
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className={o.ended_at ? 'text-slate-500' : undefined}>
                <td className="whitespace-normal">
                  <span className="block font-medium">{o.full_name}</span>
                  <span className="block text-caption text-slate-500">
                    {[
                      t(`sanctions.owners.role.${o.role}`),
                      o.birth_date ? t('sanctions.owners.bornOn', { date: formatDate(o.birth_date, locale) }) : null,
                      o.nationality,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="block text-caption text-slate-500">{t('sanctions.owners.sourceOf', { source: o.source })}</span>
                  {o.ended_at && (
                    <span className="block text-caption text-slate-500">
                      {t('sanctions.owners.endedOn', { date: formatDate(o.ended_at, locale), reason: o.end_reason ?? '' })}
                    </span>
                  )}
                </td>
                <td className="tabular-nums">{o.ownership_pct !== null ? `${Number(o.ownership_pct)} %` : '—'}</td>
                {writer && (
                  <td>
                    {!o.ended_at && (
                      <Button size="sm" variant="ghost" onClick={() => setEnding(o)}>
                        {t('sanctions.owners.end')}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <AddOwnerModal entityId={entityId} onClose={() => setAdding(false)} />}
      {ending && <EndOwnerModal owner={ending} onClose={() => setEnding(null)} />}
    </Panel>
  )
}

function AddOwnerModal({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const add = useAddOwner()
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<OwnerRole>('beneficial_owner')
  const [pct, setPct] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [nationality, setNationality] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pctNumber = pct.trim() ? Number(pct.replace(',', '.')) : null
  const errs = {
    fullName: !fullName.trim() ? t('sanctions.owners.errors.name') : null,
    pct: pctNumber !== null && (!Number.isFinite(pctNumber) || pctNumber <= 0 || pctNumber > 100) ? t('sanctions.owners.errors.pct') : null,
    birthDate: birthDate && birthDate > todayIso() ? t('sanctions.owners.errors.birthDate') : null,
    source: !source.trim() ? t('sanctions.owners.errors.source') : null,
  }
  const shown = (k: keyof typeof errs) => (tried ? errs[k] : null)

  const submit = () => {
    setTried(true)
    setError(null)
    if (Object.values(errs).some(Boolean)) return
    add
      .mutateAsync({
        entityId,
        fullName: fullName.trim(),
        role,
        ownershipPct: pctNumber,
        birthDate: birthDate || null,
        nationality,
        source: source.trim(),
      })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('sanctions.owners.addTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={add.isPending} onClick={submit}>
            {t('sanctions.owners.addSubmit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">{t('sanctions.owners.addIntro')}</p>
      <Field label={t('sanctions.owners.fields.name')} hint={t('sanctions.owners.fields.nameHint')} error={shown('fullName')}>
        <Input value={fullName} maxLength={200} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('sanctions.owners.fields.role')}>
          <Select value={role} onChange={(e) => setRole(e.target.value as OwnerRole)}>
            {OWNER_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`sanctions.owners.role.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sanctions.owners.fields.share')} error={shown('pct')}>
          <Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
        <Field label={t('sanctions.owners.fields.birthDate')} hint={t('sanctions.owners.fields.birthDateHint')} error={shown('birthDate')}>
          <DateInput value={birthDate} onChange={setBirthDate} max={todayIso()} invalid={Boolean(shown('birthDate'))} />
        </Field>
        <Field label={t('sanctions.owners.fields.nationality')}>
          <CountryPicker value={nationality} onChange={setNationality} />
        </Field>
      </div>
      <Field label={t('sanctions.owners.fields.source')} hint={t('sanctions.owners.fields.sourceHint')} error={shown('source')}>
        <Input value={source} maxLength={300} onChange={(e) => setSource(e.target.value)} />
      </Field>
    </Modal>
  )
}

function EndOwnerModal({ owner, onClose }: { owner: BeneficialOwner; onClose: () => void }) {
  const { t } = useTranslation()
  const end = useEndOwner()
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    setTried(true)
    setError(null)
    if (!reason.trim()) return
    end
      .mutateAsync({ ownerId: owner.id, reason: reason.trim() })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }
  return (
    <Modal
      open
      title={t('sanctions.owners.endTitle', { name: owner.full_name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={end.isPending} onClick={submit}>
            {t('sanctions.owners.endSubmit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <Field label={t('sanctions.owners.endReason')} error={tried && !reason.trim() ? t('sanctions.owners.errors.endReason') : null}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}
