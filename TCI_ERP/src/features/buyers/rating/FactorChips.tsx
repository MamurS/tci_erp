/** Renders factor strength/weakness chips (see factorChips.ts). */

import type { FactorChip } from './chips'

export function FactorChipList({
  chips,
}: {
  chips: FactorChip[]
}) {
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.factor}
          className={`rounded-md px-2 py-1 text-[12px] font-medium ${
            chip.kind === 'strength'
              ? 'bg-pos-50 text-pos-500'
              : 'bg-neg-50 text-neg-500'
          }`}
        >
          {chip.text}
        </span>
      ))}
    </div>
  )
}
