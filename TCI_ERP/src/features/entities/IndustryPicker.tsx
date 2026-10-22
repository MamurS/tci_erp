/**
 * The industry picker, the same control as the country picker beside it: a
 * short list shown on focus, narrowed by typing in any of the three
 * languages. A native dropdown next to a typeahead read as two different
 * kinds of field for the same kind of choice.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox } from '../../components/ui'
import type { ComboOption } from '../../components/ui'
import { refName, useIndustries } from './api'

interface IndustryPickerProps {
  value: string | null
  onChange: (code: string | null) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
}

export function IndustryPicker({ value, onChange, placeholder, disabled, 'aria-label': ariaLabel }: IndustryPickerProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: industries } = useIndustries()

  const options = useMemo<ComboOption[]>(
    () =>
      (industries ?? [])
        .map((i) => ({
          id: i.code,
          label: refName(i, locale),
          keywords: [i.code, i.name_en, i.name_ru, i.name_uz],
        }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [industries, locale],
  )

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      openOnFocus
      // The whole list fits: there are about twenty industries.
      limit={50}
      placeholder={placeholder ?? t('picker.industryPlaceholder')}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  )
}
