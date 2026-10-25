/**
 * Term inputs shared by the policy form and the submission's proposed terms.
 *
 * ChoiceField is a Field for a Segmented switch: Field is a <label>, and a
 * click on a label's caption is forwarded to the first button inside it, so a
 * switch placed in one would flip to its first option whenever the caption
 * was clicked.
 */

import { useId } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Segmented } from '../../components/ui'
import { LIABILITY_BASES } from './maxLiability'
import type { LiabilityBasis } from './maxLiability'

export function ChoiceField({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={`flex flex-col gap-1.5 ${className}`}>
      <span id={id} className="text-[0.75rem] font-semibold tracking-wide text-slate-600 uppercase">
        {label}
      </span>
      {/* The height of an input, so a switch lines up with the fields beside it. */}
      <div className="flex min-h-9 items-center">{children}</div>
    </div>
  )
}

/** The maximum liability: the basis on a switch beside the caption, one field
 * for the figure. The other basis is saved as NULL (maxLiability.ts). */
export function MaxLiabilityField({
  basis,
  onBasisChange,
  value,
  onChange,
  currency,
  invalid = false,
  message,
  label,
}: {
  basis: LiabilityBasis
  onBasisChange: (basis: LiabilityBasis) => void
  value: string
  onChange: (plain: string) => void
  currency: string | undefined
  invalid?: boolean
  message?: ReactNode
  /** The caption, when a screen names the term its own way. */
  label?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <span id={id} className="text-[0.75rem] font-semibold tracking-wide text-slate-600 uppercase">
        {label ?? t('policies.terms.maxLiability')}
      </span>
      {/* The basis beside the figure, on the input's line: the caption stays
          one line and the field lines up with its neighbours. */}
      <div className="flex items-center gap-2">
        <Segmented
          value={basis}
          ariaLabel={t('policies.terms.liabilityBasis.label')}
          options={LIABILITY_BASES.map((key) => ({ key, label: t(`policies.terms.liabilityBasis.${key}`) }))}
          onChange={(key) => onBasisChange(key as LiabilityBasis)}
        />
        <div className="min-w-0 flex-1">
          <AmountInput
            aria-labelledby={id}
            value={value}
            onChange={onChange}
            // numeric(18,2) for the amount, numeric(6,2) for the multiple.
            decimals={2}
            suffix={basis === 'amount' ? currency : t('policies.terms.timesPremium')}
            className={basis === 'multiple' ? 'pr-20!' : ''}
            invalid={invalid}
          />
        </div>
      </div>
      {message}
    </div>
  )
}
