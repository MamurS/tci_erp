import type { TFunction } from 'i18next'

import { EM_DASH } from '../../lib/format'
import type { AuthorityScope } from '../../lib/roles'

/** «Уровень 3» or «Кредитный комитет» (authority levels, 0071). */
export function levelName(t: TFunction, stream: AuthorityScope, rank: number | null, isCommittee: boolean): string {
  if (isCommittee) return t(`limits.validation.committee.${stream}`)
  return rank === null ? EM_DASH : t('limits.validation.level', { rank })
}
