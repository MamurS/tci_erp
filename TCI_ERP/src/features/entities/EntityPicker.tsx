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
  /**
   * The full name to request when the company is missing — e.g. the buyer
   * name a client proposed. The search may be seeded with a shorter core of
   * it (seedQuery), but the information manager must receive the whole name
   * as proposed, not whatever happens to be typed in the field.
   */
  requestName?: string
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
  requestName,
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
            <span className="inline-flex items-center gap-2">
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
            ? (query, close) => {
                const name = requestName?.trim() || query
                return name.length >= 3 && !options.some((o) => normalize(o.label) === normalize(name)) ? (
                  <button
                    type="button"
                    onClick={() => {
                      close()
                      setRequesting(name)
                    }}
                    className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-accent-50"
                  >
                    <FilePlus2 className="mt-0.5 size-4 shrink-0 text-sky-600" />
                    <span className="min-w-0">
                      <span className="block truncate text-small font-medium text-accent-700">
                        {t('picker.request', { query: name })}
                      </span>
                      <span className="block text-caption text-slate-500">{t('picker.requestHint')}</span>
                    </span>
                  </button>
                ) : null
              }
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
