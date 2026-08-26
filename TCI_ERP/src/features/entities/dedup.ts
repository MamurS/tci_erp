/** Add-entity dedup rules — pure module, mirror of migration 0015:
 *  - EXACT (country_code, registration_number) match is BLOCKING (the DB
 *    enforces it with the partial unique index legal_entities_reg_uq);
 *  - name similarity via pg_trgm (tci.similar_entities: threshold 0.4,
 *    top 5) is a NON-blocking suggestion list. */

import type { LegalEntity, SimilarEntity } from './types'

/** Below these lengths the lookups do not fire (too noisy to be useful). */
export const REG_MIN_CHARS = 3
export const NAME_MIN_CHARS = 4

/** Must match tci.similar_entities in migration 0015. */
export const SIMILARITY_THRESHOLD = 0.4
export const SIMILARITY_LIMIT = 5

export interface DedupVerdict {
  /** An exact (country, reg number) duplicate exists — saving must be blocked. */
  blocked: boolean
  blockingEntity: LegalEntity | null
  /** Fuzzy name matches — shown as "possible duplicates", never blocking. */
  suggestions: SimilarEntity[]
}

export function dedupVerdict(
  regMatch: LegalEntity | null | undefined,
  similar: readonly SimilarEntity[] | undefined,
): DedupVerdict {
  return {
    blocked: Boolean(regMatch),
    blockingEntity: regMatch ?? null,
    suggestions: [...(similar ?? [])].sort((a, b) => b.similarity - a.similarity),
  }
}
