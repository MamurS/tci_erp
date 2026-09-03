/** The group preflight on a decision form.
 *
 * «Экспозиция на группу: X из Y; это решение доведёт её до Z.»
 *
 * The numbers come from tci.group_exposure_preflight — the SAME function
 * tci.decide_limit_request calls before it refuses — so the banner and the
 * refusal cannot disagree. This component chooses words; it computes nothing.
 */

import { useTranslation } from 'react-i18next'

import { formatAmount } from '../../lib/format'
import { preflightState } from './group'
import type { GroupPreflight } from './types'

const TONE_CLASS: Record<string, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  pos: 'border-slate-200 bg-slate-50 text-slate-600',
  warn: 'border-warn-500/30 bg-warn-50 text-warn-500',
  neg: 'border-neg-500/30 bg-neg-50 text-neg-500',
}

interface GroupPreflightNoticeProps {
  preflight: GroupPreflight | null | undefined
  /** Admin is exempt from the group block (documented in 0040): the numbers
   * still show, but the wording must not promise a refusal that will not
   * happen. */
  isAdmin?: boolean
}

export function GroupPreflightNotice({ preflight, isAdmin = false }: GroupPreflightNoticeProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const state = preflightState(preflight)
  if (!preflight || state.kind === 'none') return null
  // A group of one has no group control to speak of; saying so on every
  // decision would be noise.
  if (preflight.group_size <= 1 && !preflight.has_group_limit) return null

  const numbers = {
    exposure: formatAmount(Number(preflight.exposure_uzs), locale),
    after: formatAmount(Number(preflight.exposure_after_uzs), locale),
    limit:
      preflight.group_limit_uzs === null
        ? '—'
        : formatAmount(Number(preflight.group_limit_uzs), locale),
    members: preflight.group_size,
  }

  const body =
    state.kind === 'no_limit'
      ? t('groups.preflight.noLimit', numbers)
      : state.kind === 'over'
        ? t(isAdmin ? 'groups.preflight.overAdmin' : 'groups.preflight.over', numbers)
        : state.kind === 'warn'
          ? t('groups.preflight.warn', {
              ...numbers,
              pct: Number(preflight.utilisation_pct ?? 0).toFixed(1),
            })
          : t('groups.preflight.within', numbers)

  return (
    <div
      role="status"
      className={`rounded-md border px-4 py-2.5 text-[13px] ${TONE_CLASS[state.tone]}`}
    >
      {body}
      {preflight.missing_rates > 0 && (
        <span className="ml-1">{t('groups.preflight.missingRates', { count: preflight.missing_rates })}</span>
      )}
    </div>
  )
}
