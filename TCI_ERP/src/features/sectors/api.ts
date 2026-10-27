/**
 * The two reads «Сектора» needs beyond src/features/risk/api.ts (which holds
 * every other read and every write of 0085):
 *   * whether the caller is the head of credit analysis — a credit analyst
 *     admin marked senior (0074) — asked of tci.is_senior_credit_analyst(),
 *     which answers for the acting role and the caller's own flag, so the
 *     screen offers what decide / end_country_override will accept;
 *   * the in-force limits of a sector's buyers with the date each took
 *     effect (v_credit_portfolio), for the exposure series.
 */

import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { tci } from '../../lib/supabase'
import type { BookLimit } from './model'

export function useIsHeadAnalyst(): boolean {
  const { actingRole, session } = useAuth()
  const enabled = actingRole === 'credit_analyst'
  const { data } = useQuery({
    queryKey: ['risk', 'head-analyst', session?.user.id ?? '', actingRole ?? ''],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data: senior, error } = await tci().rpc('is_senior_credit_analyst')
      if (error) throw error
      return senior === true
    },
  })
  return enabled && data === true
}

/** Today's in-force limits of these buyers (UZS at the latest rate, NULL
 * where the currency has none) with the month each took effect. */
export function useSectorLimitBook(sectorId: string | undefined, entityIds: readonly string[] | undefined) {
  const ids = entityIds ?? []
  return useQuery({
    // Under the risk keys: a grade or a flag refreshes it with the rest.
    queryKey: ['risk', 'sector-limit-book', sectorId ?? '', ids.length],
    enabled: Boolean(sectorId) && entityIds !== undefined,
    queryFn: async (): Promise<BookLimit[]> => {
      if (!ids.length) return []
      const { data, error } = await tci()
        .from('v_credit_portfolio')
        .select('buyer_entity_id, amount_uzs, valid_from, decided_at')
        .in('buyer_entity_id', ids)
      if (error) throw error
      return ((data ?? []) as { amount_uzs: number | null; valid_from: string | null; decided_at: string | null }[]).map(
        (r) => ({
          amount_uzs: r.amount_uzs === null ? null : Number(r.amount_uzs),
          valid_from: r.valid_from,
          decided_at: r.decided_at,
        }),
      )
    },
  })
}
