/** Row types mirroring tci.policyholders (migration 0012). */

import type { Policy } from '../policies/types'

export interface Policyholder {
  id: string
  name: string
  legal_form: string | null
  country_code: string
  industry_id: string | null
  registration_number: string
  address: string | null
  website: string | null
  contact_person: string | null
  contact_email: string | null
  contact_phone: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface PolicyholderWithRefs extends Policyholder {
  countries: { name_en: string; name_ru: string; name_uz: string } | null
  industries: { name_en: string; name_ru: string; name_uz: string } | null
  policies: Pick<Policy, 'id' | 'status'>[]
}
