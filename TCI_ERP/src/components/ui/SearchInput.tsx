/** A search box in the Google style (searchField.ts): the magnifier, the
 * field, and a clear button once something is typed. */

import { useRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'

import { SEARCH_FIELD_CLASS } from './searchField'

interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (value: string) => void
}

export function SearchInput({ value, onChange, className = '', ...rest }: SearchInputProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className={`relative ${className}`}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-slate-500" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation()
            onChange('')
          }
        }}
        className={`h-10 border-slate-200 pr-10 pl-10 ${SEARCH_FIELD_CLASS}`}
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('')
            ref.current?.focus()
          }}
          aria-label={t('search.clear')}
          title={t('search.clear')}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
