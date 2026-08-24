/** Roles stored in tci.user_roles. Database enum values stay in English; labels are translated in the UI. */
export const USER_ROLES = ['admin', 'senior_underwriter', 'underwriter', 'policyholder'] as const

export type UserRole = (typeof USER_ROLES)[number]

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}
