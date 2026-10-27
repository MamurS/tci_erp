/**
 * The rating tab's account of the sector and country adjustment (credit_engine
 * 0.2.0, risk_context.py): the engine's trace lines turned into sentences —
 * «Sector B: no change», «Sector D: −2 notches, B1 → C1», «Country (OECD
 * category 6): cap C1 — B2 → C1» — with the base grade → final grade and the
 * context the engine was given. Pure: it returns i18n keys and params, the
 * tab renders them.
 *
 * The engine emits a sector line when a sector grade was given, a country
 * line always, and a cap line only when a cap BIT. A cap that bit on its own
 * (its rule moved nothing by notches) is said on that rule's line, as the
 * owner reads it; otherwise it gets a line of its own.
 */

import type { CountryAdjustmentLine, GradeCapLine, RatingResponse, RiskContext, SectorAdjustmentLine } from '../../lib/analytics'

export interface TraceText {
  key: string
  params: Record<string, string | number>
}

/** A line of the trace. `country` is the country's label, rendered first
 * and passed to the line as {{country}}. */
export interface TraceLine extends TraceText {
  country?: TraceText
}

export interface RiskTrace {
  base: string
  final: string
  changed: boolean
  lines: TraceLine[]
  /** What the engine was told: the sector grade, and the country. */
  context: { sector: TraceText; country: TraceText }
}

/** «+1» / «−2» (a true minus sign); positive is a better grade. */
export function signedNotch(notch: number): string {
  return notch > 0 ? `+${notch}` : notch < 0 ? `−${Math.abs(notch)}` : '0'
}

/** The country part was not in force when the grade was computed: the
 * screen sends an empty country table until an OECD list is imported or the
 * country has an internal category (rules.ts engineRiskContext). */
export function countryInactive(context: RiskContext | undefined): boolean {
  if (!context) return false
  return Object.keys(context.adjustments?.country ?? {}).length === 0 && !context.country_classified
}

function countryLabel(line: Pick<CountryAdjustmentLine, 'country_category' | 'country_classified' | 'country_source'>): TraceText {
  if (!line.country_classified || line.country_category === null) return { key: 'risk.trace.country.unclassified', params: {} }
  return line.country_source === 'internal'
    ? { key: 'risk.trace.country.internal', params: { category: line.country_category } }
    : { key: 'risk.trace.country.oecd', params: { category: line.country_category } }
}

/** The trace, or null when the rating carried no risk adjustment (an engine
 * before 0.2.0, a rating computed without a context, or no grade at all). */
export function riskTrace(
  rating: Pick<RatingResponse, 'grade' | 'base_grade' | 'risk_adjustments' | 'risk_context'>,
): RiskTrace | null {
  const adjustments = rating.risk_adjustments
  if (!adjustments || adjustments.length === 0 || !rating.grade) return null
  const sector = adjustments.find((l): l is SectorAdjustmentLine => l.code === 'sector_adjustment')
  const country = adjustments.find((l): l is CountryAdjustmentLine => l.code === 'country_adjustment')
  const cap = adjustments.find((l): l is GradeCapLine => l.code === 'grade_cap')
  const base = rating.base_grade ?? sector?.from_grade ?? country?.from_grade ?? rating.grade
  const final = rating.grade
  const inactive = countryInactive(rating.risk_context)

  // A cap is said on its rule's own line when that rule alone set it and
  // moved nothing by notches; else on a line of its own.
  const capOnlyFrom = (source: 'sector' | 'country') =>
    cap !== undefined && cap.cap_sources.length === 1 && cap.cap_sources[0] === source
  const capOnSector = capOnlyFrom('sector') && sector !== undefined && sector.notch === 0
  const capOnCountry = capOnlyFrom('country') && country !== undefined && country.notch === 0 && !inactive

  const lines: TraceLine[] = []
  if (sector) {
    if (capOnSector && cap) {
      lines.push({
        key: 'risk.trace.sectorCap',
        params: { grade: sector.sector_grade, cap: cap.cap_grade, from: cap.from_grade, to: cap.to_grade },
      })
    } else if (sector.notch === 0) {
      lines.push({ key: 'risk.trace.sectorNoChange', params: { grade: sector.sector_grade } })
    } else {
      lines.push({
        key: 'risk.trace.sectorNotch',
        params: {
          grade: sector.sector_grade,
          signed: signedNotch(sector.notch),
          count: Math.abs(sector.notch),
          from: sector.from_grade,
          to: sector.to_grade,
        },
      })
    }
  }
  if (country) {
    if (inactive) {
      lines.push({ key: 'risk.trace.countryInactive', params: {} })
    } else {
      const label = countryLabel(country)
      if (capOnCountry && cap) {
        lines.push({
          key: 'risk.trace.countryCap',
          params: { cap: cap.cap_grade, from: cap.from_grade, to: cap.to_grade },
          country: label,
        })
      } else if (country.notch === 0) {
        lines.push({ key: 'risk.trace.countryNoChange', params: {}, country: label })
      } else {
        lines.push({
          key: 'risk.trace.countryNotch',
          params: {
            signed: signedNotch(country.notch),
            count: Math.abs(country.notch),
            from: country.from_grade,
            to: country.to_grade,
          },
          country: label,
        })
      }
    }
  }
  if (cap && !capOnSector && !capOnCountry) {
    const both = cap.cap_sources.includes('sector') && cap.cap_sources.includes('country')
    lines.push({
      key: both ? 'risk.trace.capBoth' : cap.cap_sources.includes('sector') ? 'risk.trace.capSector' : 'risk.trace.capCountry',
      params: { cap: cap.cap_grade, from: cap.from_grade, to: cap.to_grade },
    })
  }

  const context = rating.risk_context
  return {
    base,
    final,
    changed: base !== final,
    lines,
    context: {
      sector: context?.sector_grade
        ? { key: 'risk.trace.context.sector', params: { grade: context.sector_grade } }
        : { key: 'risk.trace.context.noSector', params: {} },
      country: inactive
        ? { key: 'risk.trace.context.countryInactive', params: {} }
        : country
          ? countryLabel(country)
          : context
            ? countryLabel({
                country_category: context.country_category,
                country_classified: context.country_classified,
                country_source: context.country_source,
              })
            : { key: 'risk.trace.country.unclassified', params: {} },
    },
  }
}
