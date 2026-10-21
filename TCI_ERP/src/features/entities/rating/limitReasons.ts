/**
 * The credit engine explains a limit in English sentences
 * (credit_engine/limits.py). A raw server string never reaches the screen:
 * each known sentence is matched to an i18n key with its numbers as params,
 * and anything unrecognised becomes one generic, translated line rather
 * than English in a Russian interface. limitReasons.test.ts reads the
 * engine source, so a reworded reason fails the build instead of falling
 * through to the generic line unnoticed.
 */

export interface LimitReason {
  /** i18n key under rating.limitReasons.* */
  key: string
  params: Record<string, string>
}

const PATTERNS: [RegExp, string, string[]][] = [
  [/^rating not computable/, 'noRating', []],
  [/^rating (\d+) is worse than (\d+)/, 'ratingTooWeak', ['rating', 'threshold']],
  [/^rating outside creditable bands/, 'ratingOutside', []],
  [/^equity is zero or negative/, 'equityNegative', []],
  [/^equity is zero, negative or unknown/, 'equityMissing', []],
  [/^equity ratio below 1%/, 'equityRatioLow', []],
  [/^net result is a loss or unknown/, 'netLoss', []],
  [/^intangible assets unknown/, 'intangiblesUnknown', []],
  [/^DSO unavailable - default (\d+) days used/, 'dsoDefault', ['days']],
  [/^calculated limit is below the minimum ticket \(([\d,]+) USD/, 'belowMinimum', ['amount']],
]

export function limitReason(text: string): LimitReason {
  for (const [pattern, key, names] of PATTERNS) {
    const m = pattern.exec(text.trim())
    if (m) return { key, params: Object.fromEntries(names.map((name, i) => [name, m[i + 1] ?? ''])) }
  }
  return { key: 'other', params: {} }
}

/** The keys a limit reason can resolve to (for the locale test). */
export const LIMIT_REASON_KEYS = [...PATTERNS.map(([, key]) => key), 'other']
