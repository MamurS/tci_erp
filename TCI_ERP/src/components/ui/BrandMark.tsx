/**
 * The two-tone condensed wordmark (brand config in src/lib/brand.ts).
 * `inverse` is for the navy sidebar: the second part turns white.
 */

import { BRAND } from '../../lib/brand'

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  inverse?: boolean
  className?: string
}

const SIZES: Record<NonNullable<BrandMarkProps['size']>, string> = {
  sm: 'text-title',
  md: 'text-headline',
  lg: 'text-display',
  xl: 'text-display',
}

export function BrandMark({ size = 'md', inverse = false, className = '' }: BrandMarkProps) {
  const [first, second] = BRAND.wordmark
  return (
    <span
      className={`inline-flex items-baseline font-display leading-none font-bold tracking-tight select-none ${SIZES[size]} ${className}`}
      aria-label={`${first} ${second}`}
    >
      <span className="text-accent-500">{first}</span>
      <span className={`ml-[0.24em] ${inverse ? 'text-white' : 'text-accent-600'}`}>{second}</span>
    </span>
  )
}
