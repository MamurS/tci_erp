/**
 * The country picker: a search over 249 countries with their flags instead
 * of a 249-line dropdown. Finds a country by its name in any of the three
 * languages or by its ISO code — «Узб», «Uzb», «UZ» all find Uzbekistan.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Combobox, CountryFlag } from '../../components/ui'
import type { ComboOption } from '../../components/ui'
import { refName, useCountries } from './api'

interface CountryPickerProps {
  value: string | null
  onChange: (code: string | null) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
}

export function CountryPicker({ value, onChange, placeholder, disabled, invalid, 'aria-label': ariaLabel }: CountryPickerProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: countries } = useCountries()

  const options = useMemo<ComboOption[]>(
    () =>
      (countries ?? [])
        .map((c) => ({
          id: c.code,
          label: refName(c, locale),
          keywords: [c.code, c.name_en, c.name_ru, c.name_uz],
          meta: (
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag code={c.code} />
              {c.code}
            </span>
          ),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [countries, locale],
  )

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      openOnFocus
      limit={12}
      placeholder={placeholder ?? t('picker.countryPlaceholder')}
      disabled={disabled}
      invalid={invalid}
      aria-label={ariaLabel}
    />
  )
}
