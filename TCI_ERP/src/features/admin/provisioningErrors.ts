/** Maps the provisioning service's error codes to i18n keys, following the
 * Phase 2b pattern: the UI never shows a raw server message. */

import { ProvisioningError, ProvisioningUnavailableError } from '../../lib/provisioning'

/** i18n keys live under "provisioning.errors.". */
export const PROVISIONING_ERROR_KEYS = {
  client_only: 'clientOnly',
  forbidden: 'forbidden',
  admin_only: 'adminOnly',
  not_your_client: 'notYourClient',
  entity_required: 'entityRequired',
  entity_not_allowed: 'entityNotAllowed',
  unknown_role: 'unknownRole',
  no_roles: 'noRoles',
  auth_create_failed: 'authCreateFailed',
  provisioning_failed: 'provisioningFailed',
  reset_failed: 'resetFailed',
  state_change_failed: 'stateChangeFailed',
  self_disable: 'selfDisable',
  invalid_input: 'invalidInput',
  no_session: 'noSession',
} as const

export type ProvisioningErrorKey =
  (typeof PROVISIONING_ERROR_KEYS)[keyof typeof PROVISIONING_ERROR_KEYS]

/** The i18n key for any thrown value. Unknown failures fall back to a
 * generic message rather than leaking a server string. */
export function provisioningErrorKey(error: unknown): 'unavailable' | ProvisioningErrorKey | 'unknown' {
  if (error instanceof ProvisioningUnavailableError) return 'unavailable'
  if (error instanceof ProvisioningError) {
    // A duplicate address is the one case worth naming precisely.
    if (error.status === 409) return 'duplicateEmail' as ProvisioningErrorKey
    const mapped = PROVISIONING_ERROR_KEYS[error.code as keyof typeof PROVISIONING_ERROR_KEYS]
    return mapped ?? 'unknown'
  }
  return 'unknown'
}
