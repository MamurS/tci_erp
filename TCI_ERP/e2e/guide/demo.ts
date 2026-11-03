/**
 * The guide's screenshots show only demo-style names: the recorded demo book
 * (e2e/layout/fixtures) is replayed with every company name replaced by a
 * fictional «DEMO …» one, the same original always becoming the same name, so
 * a screen that compares two of them still behaves. People are already
 * placeholders there (sanitiser in e2e/layout/fixtures.ts).
 */
import type { RoleFixture } from '../layout/fixtures'

/** Keys whose string values are company names in the recorded responses. */
const NAME_KEYS = new Set([
  'name',
  'buyer_name',
  'policyholder_name',
  'entity_name',
  'ultimate_parent_name',
  'proposed_name',
  'group_name',
  'member_name',
  'legal_name',
  'company_name',
  'applicant_name',
])

const FIRST = ['Silk Road', 'Aral', 'Zarafshan', 'Chorsu', 'Registan', 'Turan', 'Pamir', 'Caspian', 'Steppe', 'Altai', 'Oasis', 'Caravan']
const SECOND = ['Textiles', 'Trading', 'Foods', 'Logistics', 'Metals', 'Pharma', 'Auto Parts', 'Commodities', 'Retail', 'Machinery', 'Agro', 'Electronics']

/** The n-th fictional name: «DEMO Silk Road Textiles», «DEMO Aral Trading», … */
export function demoName(n: number): string {
  const first = FIRST[n % FIRST.length]
  const second = SECOND[(n + Math.floor(n / FIRST.length)) % SECOND.length]
  return `DEMO ${first} ${second}`
}

/** Company names found under NAME_KEYS, in a stable order (reference data such as
 * countries and industries has name_ru / name_en, not `name`, and is left alone). */
export function companyNames(value: unknown, out = new Set<string>(), key?: string): Set<string> {
  if (typeof value === 'string') {
    if (key && NAME_KEYS.has(key) && value.trim().length > 2 && !value.startsWith('DEMO')) out.add(value)
  } else if (Array.isArray(value)) for (const v of value) companyNames(v, out, key)
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) companyNames(v, out, k)
  return out
}

/** Every occurrence of a known company name, in any string, becomes its DEMO name. */
export function demoise(fixture: RoleFixture, names: readonly string[]): RoleFixture {
  const map = new Map(names.map((n, i) => [n, demoName(i)]))
  // longest first: «PAO Ozon Holding» before «Ozon»
  const order = [...map.keys()].sort((a, b) => b.length - a.length)
  const swap = (s: string) => {
    let out = s
    for (const n of order) if (out.includes(n)) out = out.split(n).join(map.get(n)!)
    return out
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return { ...fixture, responses: walk(fixture.responses) as RoleFixture['responses'] }
}
