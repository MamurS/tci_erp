/** FX rates data access: tci.fx_rates cache + CBU fetch via the analytics
 * service proxy (/fx) + manual entries. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import { rateKey } from './fx'
import type { RateNeed } from './fx'

const ANALYTICS_URL: string =
  import.meta.env.VITE_ANALYTICS_API_URL ?? 'http://localhost:8000'

export interface FxRateRow {
  currency_code: string
  rate_to_uzs: number
  rate_date: string
  source: 'cbu' | 'manual'
}

async function fetchStoredRates(needs: RateNeed[]): Promise<Map<string, FxRateRow>> {
  if (!needs.length) return new Map()
  const currencies = [...new Set(needs.map((n) => n.currency_code))]
  const dates = [...new Set(needs.map((n) => n.rate_date))]
  const { data, error } = await tci()
    .from('fx_rates')
    .select('currency_code, rate_to_uzs, rate_date, source')
    .in('currency_code', currencies)
    .in('rate_date', dates)
  if (error) throw error

  const map = new Map<string, FxRateRow>()
  for (const row of (data ?? []) as unknown as FxRateRow[]) {
    const key = rateKey(row.currency_code, row.rate_date)
    const existing = map.get(key)
    // Prefer CBU over manual when both exist.
    if (!existing || (existing.source === 'manual' && row.source === 'cbu')) {
      map.set(key, { ...row, rate_to_uzs: Number(row.rate_to_uzs) })
    }
  }
  return map
}

async function fetchCbuRate(need: RateNeed): Promise<number | null> {
  try {
    const response = await fetch(
      `${ANALYTICS_URL}/fx?ccy=${encodeURIComponent(need.currency_code)}&date=${need.rate_date}`,
    )
    if (!response.ok) return null
    const body = (await response.json()) as { rate_to_uzs: number }
    return body.rate_to_uzs
  } catch {
    return null
  }
}

async function cacheRate(need: RateNeed, rate: number, source: 'cbu' | 'manual'): Promise<void> {
  await tci()
    .from('fx_rates')
    .upsert(
      {
        currency_code: need.currency_code,
        rate_to_uzs: rate,
        rate_date: need.rate_date,
        source,
      },
      { onConflict: 'currency_code,rate_date,source' },
    )
}

/**
 * Resolve all needed rates: stored first, then CBU via the analytics proxy
 * (caching successes). Returns the lookup map; pairs still missing need
 * manual entry.
 */
export function useFxRates(needs: RateNeed[]) {
  const key = needs
    .map((n) => rateKey(n.currency_code, n.rate_date))
    .sort()
    .join(',')

  return useQuery({
    queryKey: ['fx', key],
    enabled: needs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, number>> => {
      const stored = await fetchStoredRates(needs)
      const result: Record<string, number> = {}
      const unresolved: RateNeed[] = []

      for (const need of needs) {
        const hit = stored.get(rateKey(need.currency_code, need.rate_date))
        if (hit) result[rateKey(need.currency_code, need.rate_date)] = hit.rate_to_uzs
        else unresolved.push(need)
      }

      await Promise.all(
        unresolved.map(async (need) => {
          const rate = await fetchCbuRate(need)
          if (rate !== null) {
            result[rateKey(need.currency_code, need.rate_date)] = rate
            await cacheRate(need, rate, 'cbu').catch(() => undefined)
          }
        }),
      )
      return result
    },
  })
}

export function useSaveManualRate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { need: RateNeed; rate: number }) => {
      await cacheRate(input.need, input.rate, 'manual')
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['fx'] }),
  })
}

/** USD rate for a statement currency at a date, from resolved rates.
 * Returns units of statement currency per 1 USD (engine convention). */
export function usdRateFor(
  currencyCode: string,
  date: string,
  rates: Record<string, number> | undefined,
): number | null {
  if (currencyCode === 'USD') return 1
  const usdToUzs = rates?.[rateKey('USD', date)]
  if (!usdToUzs) return null
  if (currencyCode === 'UZS') return usdToUzs
  const ccyToUzs = rates?.[rateKey(currencyCode, date)]
  if (!ccyToUzs) return null
  return usdToUzs / ccyToUzs
}
