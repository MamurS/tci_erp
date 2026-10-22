/** Hooks shared by the draft screens: the printable context now, the stale
 * fields of a version, and the status each version reached. */

import { useMemo } from 'react'

import { buildWordingContext } from '../wording/context'
import { useWordingLabels } from '../wording/labels'
import type { ContractDraft, StatusChange, VersionMeta } from './api'
import { useCurrentMergeData } from './api'
import type { ContractStatus } from './machine'
import { fieldKey, scheduleCountChanged, staleFields } from './mergeFields'
import type { StaleField } from './mergeFields'
import type { ContractDoc } from './model'

/** What a template generated NOW would print, in the draft's language. */
export function useCurrentContext(draft: ContractDraft | null | undefined) {
  const { data, isLoading, error } = useCurrentMergeData(draft)
  const { labels, ready } = useWordingLabels(draft?.language ?? 'ru', draft?.policy_id ? 'policy' : 'submission')
  const context = useMemo(
    () => (data && ready && draft ? buildWordingContext(data, draft.language, labels) : null),
    [data, ready, draft, labels],
  )
  return { context, isLoading: isLoading || !ready, error }
}

export interface Staleness {
  fields: StaleField[]
  keys: ReadonlySet<string>
  scheduleChanged: boolean
}

export function useStaleness(doc: ContractDoc | null | undefined, context: Record<string, unknown> | null): Staleness {
  return useMemo(() => {
    if (!doc || !context) return { fields: [], keys: new Set<string>(), scheduleChanged: false }
    const fields = staleFields(doc, context)
    return { fields, keys: new Set(fields.map(fieldKey)), scheduleChanged: scheduleCountChanged(doc, context) }
  }, [doc, context])
}

/** The status each version reached: the last status recorded against it; the
 * current version always shows the draft's status. Null when none. */
export function versionStatuses(
  draft: Pick<ContractDraft, 'status' | 'current_version_id'>,
  versions: readonly Pick<VersionMeta, 'id'>[],
  history: readonly Pick<StatusChange, 'version_id' | 'to_status'>[],
): Map<string, ContractStatus | null> {
  const out = new Map<string, ContractStatus | null>()
  for (const v of versions) {
    if (v.id === draft.current_version_id) {
      out.set(v.id, draft.status)
      continue
    }
    const last = [...history].reverse().find((h) => h.version_id === v.id)
    out.set(v.id, last?.to_status ?? null)
  }
  return out
}
