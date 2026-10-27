/** The badge classes of a policyholder tier (tokens `tier-gold-tint` …, 0094):
 * pastel by default — the tint, the ink and a hairline — or, with «Bold,
 * white text» (0089), the ink as the fill behind white. Literal class names,
 * so Tailwind generates them. */

import type { Tier } from './model'

export const TIER_BADGE: Record<Tier, string> = {
  bronze:
    'bg-tier-bronze-tint text-tier-bronze-ink ring-tier-bronze-line in-data-[badge-ink=white]:bg-tier-bronze-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-tier-bronze-ink',
  silver:
    'bg-tier-silver-tint text-tier-silver-ink ring-tier-silver-line in-data-[badge-ink=white]:bg-tier-silver-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-tier-silver-ink',
  gold: 'bg-tier-gold-tint text-tier-gold-ink ring-tier-gold-line in-data-[badge-ink=white]:bg-tier-gold-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-tier-gold-ink',
  platinum:
    'bg-tier-platinum-tint text-tier-platinum-ink ring-tier-platinum-line in-data-[badge-ink=white]:bg-tier-platinum-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-tier-platinum-ink',
}

/** The medal's own colour (bars, the progress meter). */
export const TIER_SOLID: Record<Tier, string> = {
  bronze: 'bg-tier-bronze',
  silver: 'bg-tier-silver',
  gold: 'bg-tier-gold',
  platinum: 'bg-tier-platinum',
}
