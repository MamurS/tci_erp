/** Renders factor strength/weakness chips (see chips.ts). When onChipClick
 * is provided, chips become buttons that drill into the factor table. */

import { badgeClassName } from '../../../components/ui'
import type { FactorChip } from './chips'

export function FactorChipList({
  chips,
  onChipClick,
}: {
  chips: FactorChip[]
  onChipClick?: (chip: FactorChip) => void
}) {
  if (!chips.length) return null
  // The `sm` badge (DESIGN.md «Badges»); a long factor is cut and named in
  // full on hover.
  const toneClasses = (chip: FactorChip) =>
    badgeClassName('sm', chip.kind === 'strength' ? 'bg-pos-50 text-pos-500 ring-pos-500/20' : 'bg-neg-50 text-neg-500 ring-neg-500/20')

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) =>
        onChipClick ? (
          <button
            key={chip.factor}
            type="button"
            onClick={() => onChipClick(chip)}
            data-badge="sm"
            title={chip.text}
            className={`cursor-pointer text-left underline-offset-2 transition-shadow hover:underline hover:shadow-sm ${toneClasses(chip)}`}
          >
            <span className="min-w-0 truncate">{chip.text}</span>
          </button>
        ) : (
          <span key={chip.factor} data-badge="sm" title={chip.text} className={toneClasses(chip)}>
            <span className="min-w-0 truncate">{chip.text}</span>
          </span>
        ),
      )}
    </div>
  )
}
