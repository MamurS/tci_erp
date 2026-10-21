/**
 * The company picker: type a name or a registration number, pick from the
 * suggestions (flag, country, registration number under each). Used wherever
 * a form needs a company out of the registry — the buyer of a limit request,
 * the applicant of a submission, a group counterparty, a policyholder.
 *
 * With `allowRequest`, a staff member who does not find the company can ask
 * an information manager to register it, without leaving the form (the
 * data-request modal opens on top of it — data/RequestEntityModal).
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePlus2 } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { Badge, Combobox, CountryFlag } from '../../components/ui'
import type { ComboOption } from '../../components/ui'
import { normalize } from '../../components/ui/combobox'
import { isStaff } from '../../lib/roles'
import { RequestEntityModal } from '../data/RequestEntityModal'
import { useCountryName } from '../portfolio/useCountryName'
import { useEntities } from './api'
import type { EntityWithRefs } from './types'

interface EntityPickerProps {
  value: string | null
  onChange: (id: string | null) => void
  /** Companies that may not be picked here (the company itself, buyers already on the policy). */
  exclude?: readonly string[]
  /** Narrows the registry (e.g. only companies holding a policy). */
  where?: (entity: EntityWithRefs) => boolean
  /** Offer «request this company» when it is not found (staff only). */
  allowRequest?: boolean
  /** Searched for on focus while nothing is picked. */
  seedQuery?: string
  /** Free-text mode: a name kept when no company is picked. */
  text?: string
  onTextChange?: (text: string) => void
  disabled?: boolean
  autoFocus?: boolean
  invalid?: boolean
  placeholder?: string
  'aria-label'?: string
}

export function EntityPicker({
  value,
  onChange,
  exclude,
  where,
  allowRequest = false,
  seedQuery,
  text,
  onTextChange,
  disabled,
  autoFocus,
  invalid,
  placeholder,
  'aria-label': ariaLabel,
}: EntityPickerProps) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const { data: entities } = useEntities()
  const countryName = useCountryName()
  const [requesting, setRequesting] = useState<string | null>(null)
  const canRequest = allowRequest && isStaff(roles)

  const options = useMemo<ComboOption[]>(
    () =>
      (entities ?? [])
        .filter((e) => !exclude?.includes(e.id) && (!where || where(e)))
        .map((e) => ({
          id: e.id,
          label: e.name,
          keywords: [e.registration_number],
          meta: (
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag code={e.country_code} />
              {countryName(e.country_code)}
              {e.registration_number && <span className="num">· {e.registration_number}</span>}
            </span>
          ),
        })),
    [entities, exclude, where, countryName],
  )

  return (
    <>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        seedQuery={seedQuery}
        text={text}
        onTextChange={onTextChange}
        freeTextBadge={<Badge tone="warn">{t('picker.notInRegistry')}</Badge>}
        disabled={disabled}
        autoFocus={autoFocus}
        invalid={invalid}
        placeholder={placeholder}
        aria-label={ariaLabel}
        renderFooter={
          canRequest
            ? (query, close) =>
                query.length >= 3 && !options.some((o) => normalize(o.label) === normalize(query)) ? (
                  <button
                    type="button"
                    onClick={() => {
                      close()
                      setRequesting(query)
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent-50"
                  >
                    <FilePlus2 className="mt-0.5 size-4 shrink-0 text-brand-orange" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-accent-700">
                        {t('picker.request', { query })}
                      </span>
                      <span className="block text-[12px] text-slate-500">{t('picker.requestHint')}</span>
                    </span>
                  </button>
                ) : null
            : undefined
        }
      />
      {canRequest && (
        <RequestEntityModal
          open={requesting !== null}
          initialName={requesting ?? ''}
          onClose={() => setRequesting(null)}
        />
      )}
    </>
  )
}
