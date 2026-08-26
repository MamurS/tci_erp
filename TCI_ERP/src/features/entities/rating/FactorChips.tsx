/** Renders factor strength/weakness chips (see chips.ts). When onChipClick
 * is provided, chips become buttons that drill into the factor table. */

import type { FactorChip } from './chips'

export function FactorChipList({
  chips,
  onChipClick,
}: {
  chips: FactorChip[]
  onChipClick?: (chip: FactorChip) => void
}) {
  if (!chips.length) return null
  const toneClasses = (chip: FactorChip) =>
    chip.kind === 'strength' ? 'bg-pos-50 text-pos-500' : 'bg-neg-50 text-neg-500'

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) =>
        onChipClick ? (
          <button
            key={chip.factor}
            type="button"
            onClick={() => onChipClick(chip)}
            className={`cursor-pointer rounded-md px-2 py-1 text-left text-[12px] font-medium underline-offset-2 transition-shadow hover:underline hover:shadow-sm ${toneClasses(chip)}`}
          >
            {chip.text}
          </button>
        ) : (
          <span
            key={chip.factor}
            className={`rounded-md px-2 py-1 text-[12px] font-medium ${toneClasses(chip)}`}
          >
            {chip.text}
          </span>
        ),
      )}
    </div>
  )
}
