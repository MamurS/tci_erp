/**
 * Admin › Полномочия › «Уровни полномочий» (migration 0071): per stream the
 * five ranks — ranks 1–4 with band authority and members, rank 5 the
 * committee with its chair — and how a proposal is routed (direct or
 * sequential). A technical setting: admin arranges who sits where and
 * decides nothing.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Modal,
  SectionTitle,
  Segmented,
  Select,
  Skeleton,
} from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { EM_DASH, formatAmount } from '../../lib/format'
import { refusalOr } from '../../lib/optimistic'
import { GRADE_BANDS } from '../../lib/roles'
import type { AuthorityScope, GradeBand } from '../../lib/roles'
import { useStaffDirectory } from '../data/api'
import { useCurrencies } from '../entities/api'
import { levelName } from '../limits/levelName'
import { AUTHORITY_ROUTINGS } from '../limits/validation'
import type { AuthorityRouting } from '../limits/validation'
import { isLive, memberCandidates } from './authorityLevels'
import type { AuthorityLevel } from './authorityLevels'
import { useAuthorityLevels, useAuthorityRouting, useLevelGrants, useLevelMembers, useLevelWrites } from './authorityLevelsApi'

export function AuthorityLevelsCard() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const [stream, setStream] = useState<AuthorityScope>('credit')
  const levels = useAuthorityLevels()
  const grants = useLevelGrants()
  const members = useLevelMembers()
  const routing = useAuthorityRouting()
  const people = useStaffDirectory()
  const writes = useLevelWrites()
  const [grantFor, setGrantFor] = useState<AuthorityLevel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  const run = async (action: Promise<unknown>) => {
    setError(null)
    try {
      await action
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.saveFailed')))
    }
  }

  const name = (id: string | null) => {
    if (!id) return EM_DASH
    const p = people.data?.get(id)
    return p?.full_name?.trim() || p?.email || EM_DASH
  }
  const loading = levels.isLoading || grants.isLoading || members.isLoading
  const inStream = (levels.data ?? []).filter((l) => l.stream === stream).sort((a, b) => a.rank - b.rank)
  const liveMembers = (members.data ?? []).filter((m) => isLive(m, today))
  const liveGrants = (grants.data ?? []).filter((g) => isLive(g, today))
  const staff = [...(people.data?.values() ?? [])]

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle
        hint={t('admin.levels.hint')}
        actions={
          <Segmented
            value={stream}
            options={[
              { key: 'credit', label: t('admin.scopes.credit') },
              { key: 'commercial', label: t('admin.scopes.commercial') },
            ]}
            onChange={(key) => setStream(key as AuthorityScope)}
          />
        }
      >
        {t('admin.levels.title')}
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[0.8125rem] font-medium text-slate-600">{t('admin.levels.routing')}</span>
        <Segmented
          value={routing.data ?? 'direct'}
          tone="solid"
          ariaLabel={t('admin.levels.routing')}
          options={AUTHORITY_ROUTINGS.map((r) => ({ key: r, label: t(`admin.levels.routings.${r}`) }))}
          onChange={(key) => void run(writes.routing.mutateAsync(key as AuthorityRouting))}
        />
        <span className="min-w-0 flex-1 text-[0.8125rem] text-slate-500">
          {t(`limits.validation.routing.${routing.data ?? 'direct'}`)}
        </span>
      </div>

      {error && <Callout tone="neg" title={error} />}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
          {inStream.map((level) => {
            const here = liveMembers.filter((m) => m.level_id === level.id)
            const bands = liveGrants.filter((g) => g.level_id === level.id)
            const candidates = memberCandidates(staff, level, levels.data ?? [], members.data ?? [], today)
            return (
              <div key={level.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{levelName(t, stream, level.rank, level.is_committee)}</span>
                  {level.is_committee ? (
                    <Badge tone="accent">{t('admin.levels.unlimited')}</Badge>
                  ) : bands.length === 0 ? (
                    <Badge tone="warn">{t('admin.levels.noAuthority')}</Badge>
                  ) : (
                    GRADE_BANDS.filter((b) => bands.some((g) => g.grade_band === b)).map((b) => {
                      const g = bands.find((x) => x.grade_band === b)!
                      return (
                        <Badge key={b} tone="neutral">
                          {t(`limits.bands.${b}`)}: {formatAmount(Number(g.max_amount), locale)} {g.currency_code}
                        </Badge>
                      )
                    })
                  )}
                  {!level.is_committee && (
                    <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setGrantFor(level)}>
                      {t('admin.levels.setAuthority')}
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
                  <span className="text-slate-500">{t('admin.levels.members')}:</span>
                  {here.length === 0 && <span className="text-slate-400">{t('admin.levels.nobody')}</span>}
                  {here.map((m) => (
                    <span
                      key={m.id}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pr-1 pl-2.5"
                    >
                      {name(m.user_id)}
                      {level.chair_id === m.user_id && <Badge tone="accent">{t('admin.levels.chair')}</Badge>}
                      <button
                        type="button"
                        className="rounded-full px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label={t('admin.levels.remove', { name: name(m.user_id) })}
                        onClick={() => void run(writes.endMember.mutateAsync(m.id))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {candidates.length > 0 && (
                    <Select
                      className="h-8 min-w-44"
                      value=""
                      aria-label={t('admin.levels.add')}
                      onChange={(e) => {
                        if (e.target.value) void run(writes.addMember.mutateAsync({ levelId: level.id, userId: e.target.value }))
                      }}
                    >
                      <option value="">{t('admin.levels.add')}</option>
                      {candidates.map((p) => (
                        <option key={p.user_id} value={p.user_id}>
                          {p.full_name?.trim() || p.email}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>

                {level.is_committee && here.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <span className="text-slate-500">{t('admin.levels.chair')}:</span>
                    <Select
                      className="h-8 min-w-44"
                      value={level.chair_id ?? ''}
                      aria-label={t('admin.levels.chair')}
                      onChange={(e) =>
                        void run(writes.chair.mutateAsync({ levelId: level.id, userId: e.target.value || null }))
                      }
                    >
                      <option value="">{t('admin.levels.noChair')}</option>
                      {here.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {name(m.user_id)}
                        </option>
                      ))}
                    </Select>
                    <span className="text-slate-500">{t('admin.levels.committeeRule')}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {grantFor && (
        <LevelGrantModal
          level={grantFor}
          stream={stream}
          pending={writes.grant.isPending}
          onClose={() => setGrantFor(null)}
          onSave={async (band, amount, currency) => {
            await writes.grant.mutateAsync({ levelId: grantFor.id, band, amount, currency })
            setGrantFor(null)
          }}
        />
      )}
    </Card>
  )
}

function LevelGrantModal({
  level,
  stream,
  pending,
  onClose,
  onSave,
}: {
  level: AuthorityLevel
  stream: AuthorityScope
  pending: boolean
  onClose: () => void
  onSave: (band: GradeBand, amount: number, currency: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const currencies = useCurrencies()
  const [band, setBand] = useState<GradeBand>('unrated')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('UZS')
  const [error, setError] = useState<string | null>(null)
  const parsed = parseAmount(amount)
  const valid = parsed !== null && parsed > 0

  const save = async () => {
    if (!valid || parsed === null) return
    setError(null)
    try {
      await onSave(band, parsed, currency)
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.saveFailed')))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('admin.levels.setAuthorityFor', { level: levelName(t, stream, level.rank, level.is_committee) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} disabled={!valid} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="text-[0.8125rem] text-slate-600">{t('admin.levels.setAuthorityHint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('admin.fields.band')}>
          <Select value={band} onChange={(e) => setBand(e.target.value as GradeBand)}>
            {GRADE_BANDS.map((b) => (
              <option key={b} value={b}>
                {t(`limits.bands.${b}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.fields.maxAmount')}>
          <AmountInput value={amount} onChange={setAmount} />
        </Field>
        <Field label={t('admin.fields.currency')}>
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(currencies.data ?? [{ code: 'UZS' }]).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && (
        <p className="text-[0.8125rem] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
