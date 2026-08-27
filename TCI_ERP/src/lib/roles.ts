/** Department roles (tci.user_role, migration 0016). A user may hold
 * SEVERAL roles - tci.user_roles has one row per (user, role). Database
 * enum values stay in English; labels are translated in the UI. */
export const USER_ROLES = [
  'admin',
  'sales',
  'commercial_underwriter',
  'credit_underwriter',
  'claims',
  'information_manager',
  'client',
] as const

export type UserRole = (typeof USER_ROLES)[number]

/** Everything except the portal role. Mirrors tci.is_staff(). */
export const STAFF_ROLES: readonly UserRole[] = USER_ROLES.filter((r) => r !== 'client')

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** Mirrors tci.has_role(...): true when the user holds ANY of the roles. */
export function hasRole(roles: readonly UserRole[], ...wanted: readonly UserRole[]): boolean {
  return roles.some((r) => wanted.includes(r))
}

/** Mirrors tci.is_staff(). */
export function isStaff(roles: readonly UserRole[]): boolean {
  return roles.some((r) => r !== 'client')
}

/** Grade bands of the authority matrix (tci.grade_band). The band NAMES are
 * fixed; which engine grade maps to which family comes from the analytics
 * service (/grade-scale returns each band's `family`). */
export const GRADE_BANDS = ['A', 'B', 'C', 'D', 'unrated'] as const
export type GradeBand = (typeof GRADE_BANDS)[number]

/** Mirrors tci.grade_band_for_assessment: the family of a grade code. */
export function bandForGrade(grade: string | null | undefined): GradeBand {
  const family = (grade ?? '').trim().charAt(0).toUpperCase()
  return family === 'A' || family === 'B' || family === 'C' || family === 'D'
    ? family
    : 'unrated'
}

export const AUTHORITY_SCOPES = ['credit', 'commercial'] as const
export type AuthorityScope = (typeof AUTHORITY_SCOPES)[number]
