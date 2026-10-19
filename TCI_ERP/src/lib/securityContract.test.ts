/** Security closure contract (migration 0043, audit Phase A) and the
 * authentication hardening that builds on it (migration 0044, Phase A2).
 *
 * Everything here is locked to the migration TEXT so a drift fails CI rather
 * than waiting for the next audit:
 *
 *  1. No migration after 0042 raises `P0004`. It is `assert_failure`, which
 *     `exception when others` does not catch; permission refusals are 42501.
 *  2. The allow-list of SECURITY DEFINER functions that may skip a gate is the
 *     one below, with a justification each. It starts small and grows only
 *     with a reason. tests/db/definer_gates.sql proves the same thing against
 *     the catalog on the replay harness; this test proves the latest migration
 *     that defines the list still SAYS it.
 *  3. The token machinery keeps its shape: two entry points, one closed to
 *     `authenticated`, and a gate helper for every mechanism the rule names.
 *  4. The Auth hooks and the hashing helpers of 0044 are closed to every API
 *     role, and the gates enforce the MFA policy next to the rotation flag.
 */

import { describe, expect, it } from 'vitest'

const MIGRATIONS = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function number(path: string): number {
  const m = /\/(\d{4})_[^/]+\.sql$/.exec(path)
  if (!m) throw new Error(`unnumbered migration: ${path}`)
  return Number(m[1])
}

function migration(suffix: string): string {
  const found = Object.entries(MIGRATIONS).find(([p]) => p.endsWith(suffix))?.[1]
  if (!found) throw new Error(`${suffix} not found`)
  return found
}

const M43 = migration('0043_security_closure.sql')
const M44 = migration('0044_auth_hardening.sql')
const M46 = migration('0046_login_gate.sql')
const M48 = migration('0048_rotation_and_claim_documents.sql')

/** The LATEST migration that (re)defines tci.definer_gate_allowlist(). */
const ALLOWLIST_SOURCE = Object.entries(MIGRATIONS)
  .filter(([, sql]) => /create (or replace )?function tci\.definer_gate_allowlist\(\)/.test(sql))
  .sort(([a], [b]) => number(a) - number(b))
  .slice(-1)[0]?.[1]
if (!ALLOWLIST_SOURCE) throw new Error('no migration defines tci.definer_gate_allowlist()')

/** Mirror of tci.definer_gate_allowlist(). Order and names must match. */
export const DEFINER_GATE_ALLOWLIST: readonly { name: string; why: string }[] = [
  { name: 'has_role', why: "reads only the caller's own tci.user_roles rows; it IS the gate" },
  { name: 'is_staff', why: "reads only the caller's own tci.user_roles rows; it IS the gate" },
  { name: 'current_user_roles', why: "returns only the caller's own roles" },
  { name: 'password_rotation_pending', why: "reads only the caller's own profile flag; part of the gate" },
  { name: 'complete_password_change', why: "writes only the caller's own profile row, keyed by auth.uid()" },
  { name: 'sales_window_hours', why: 'one non-sensitive workflow_settings number, needed by views a client reads' },
  { name: 'group_depth_cap', why: 'one non-sensitive workflow_settings number' },
  { name: 'group_exposure_warn_pct', why: 'one non-sensitive workflow_settings number' },
  { name: 'decision_is_released', why: 'pure computation over its arguments and the sales window; no table read' },
  { name: 'begin_internal_call', why: 'is itself gated on is_staff(); the token it sets dies with the transaction' },
  { name: 'require_staff', why: 'a gate: only raises' },
  { name: 'require_role', why: 'a gate: only raises' },
  { name: 'require_claim_access', why: 'a gate: only raises' },
  { name: 'auth_policy', why: 'non-sensitive policy numbers the UI mirrors to explain a refusal' },
  { name: 'mfa_satisfied', why: "reads only the caller's own factors, roles and JWT claims; part of the gate" },
  { name: 'my_auth_status', why: "reads only the caller's own rotation, MFA and lockout state" },
  { name: 'login_begin', why: 'pre-sign-in entry point: salted hashes only, names no account (see pre_auth_entry_points)' },
  { name: 'my_sign_in_notice', why: "reads only the caller's own sign-in attempts, keyed by auth.uid()" },
  { name: 'require_trusted_write', why: 'a gate: only raises (the guard on workflow-written tables)' },
  {
    name: 'may_remove_claim_object',
    why: "a storage-policy predicate: true only for the caller's own unregistered upload to a claim they may upload to",
  },
]

describe('no migration after 0042 raises P0004', () => {
  it('scans every numbered migration above 0042', () => {
    const late = Object.entries(MIGRATIONS).filter(([p]) => number(p) > 42)
    expect(late.length).toBeGreaterThan(1)
    for (const [path, sql] of late) {
      // The rule statement in 0043's header mentions the code by name; only a
      // `raise` that USES it is forbidden.
      expect(sql, path).not.toMatch(/errcode\s*=\s*'P0004'/i)
    }
  })

  it('0043 re-classifies rather than deletes: 42501 for permission, P0001 for state, P0002 for not-found', () => {
    expect(M43).toContain("raise exception 'only credit underwriting may decide' using errcode = '42501'")
    expect(M43).toContain("'this claim can no longer be edited' using errcode = 'P0001'")
    expect(M43).toContain("'invoice not found' using errcode = 'P0002'")
    expect(M43).toContain("'claim not found' using errcode = 'P0002'")
    expect(M43).toContain("using errcode = 'P0001', detail = 'limits.errors.groupLimitExceeded'")
  })
})

describe('the allow-list in tci.definer_gate_allowlist()', () => {
  const block = ALLOWLIST_SOURCE.slice(
    ALLOWLIST_SOURCE.search(/create (or replace )?function tci\.definer_gate_allowlist\(\)/),
  )
  const body = block.slice(0, block.indexOf('$$;') + 3)
  const listed = [...body.matchAll(/\(\s*'([a-z_]+)',\s*'((?:[^']|'')*)'\)/g)].map((m) => ({
    name: m[1],
    why: m[2].replace(/''/g, "'"),
  }))

  it('is defined last by 0048', () => {
    expect(ALLOWLIST_SOURCE).toBe(M48)
  })

  it('matches this mirror exactly, name for name, reason for reason', () => {
    expect(listed).toEqual(DEFINER_GATE_ALLOWLIST)
  })

  it('every entry carries a justification', () => {
    for (const e of DEFINER_GATE_ALLOWLIST) expect(e.why.length, e.name).toBeGreaterThan(12)
  })

  it('names no workflow writer and none of the auth-hardening writers', () => {
    const writers = ['open_task', 'close_tasks', 'emit_workflow_event', 'file_overdue_notification',
      'generate_premium_instalments', 'suspend_limit_for_noa', 'suspend_limit_for_claim',
      'submit_declaration', 'correct_declaration', 'verify_claim_coverage',
      'password_verification_hook', 'mfa_verification_hook', 'log_auth_event', 'security_hash',
      'unlock_account', 'revoke_user_sessions', 'prune_auth_data']
    for (const w of writers) expect(DEFINER_GATE_ALLOWLIST.map((e) => e.name)).not.toContain(w)
  })
})

describe('the internal-call token and the gates (0043)', () => {
  it('has the two entry points, and only the staff one is granted to authenticated', () => {
    expect(M43).toContain('create function tci.begin_internal_call()')
    expect(M43).toContain('create function tci.begin_trusted_call()')
    expect(M43).toContain('grant execute on function tci.begin_internal_call() to authenticated, service_role;')
    expect(M43).toContain('revoke execute on function tci.begin_trusted_call() from public, anon, authenticated;')
    expect(M43).toContain('revoke execute on function tci.internal_call_token() from public, anon, authenticated;')
    expect(M43).toContain('revoke all on tci.internal_secrets from public, anon, authenticated, service_role;')
  })

  it('restates the authenticated grant BEFORE revoking the PUBLIC default (the only grant most functions had)', () => {
    const loop = M43.slice(M43.indexOf('-- 5. Residual PUBLIC grants'), M43.indexOf('-- 6. The allow-list'))
    const grantAt = loop.indexOf("execute format('grant execute on function %s to authenticated, service_role', r.sig);")
    const revokeAt = loop.indexOf("execute format('revoke execute on function %s from public, anon', r.sig);")
    expect(grantAt).toBeGreaterThan(-1)
    expect(revokeAt).toBeGreaterThan(grantAt)
  })

  it('the token is bound to the transaction and the salt', () => {
    expect(M43).toContain("select md5(pg_current_xact_id()::text || (select salt from tci.internal_secrets))")
    expect(M43).toContain("perform set_config('tci.internal_call', tci.internal_call_token(), true);")
  })

  it('the five internal-only helpers are token-gated, the client-reachable readers are tenant-gated', () => {
    for (const f of ['open_task', 'close_tasks', 'emit_workflow_event', 'suspend_limit_for_noa', 'suspend_limit_for_claim']) {
      const body = M43.slice(M43.indexOf(`create or replace function tci.${f}(`))
      expect(body.slice(0, body.indexOf('$$;')), f).toContain('perform tci.require_internal_call();')
    }
    for (const f of ['calculate_indemnity', 'claim_covered_totals', 'claim_eligible_from', 'claim_submission_blockers', 'missing_claim_documents']) {
      const body = M43.slice(M43.indexOf(`create or replace function tci.${f}(`))
      expect(body.slice(0, body.indexOf('$$;')), f).toContain('perform tci.require_claim_access(p_claim_id);')
    }
  })

  it('the in-migration assertion covers the same four properties this file relies on', () => {
    expect(M43).toContain("0043: ungated SECURITY DEFINER functions executable by authenticated")
    expect(M43).toContain("0043: anon-executable SECURITY DEFINER functions remain")
    expect(M43).toContain("0043: P0004 still raised by")
    expect(M43).toContain("0043: the internal-call token is reachable by authenticated")
  })
})

describe('authentication hardening (0044)', () => {
  it('has_role and is_staff enforce BOTH the rotation flag and the MFA policy, in their latest definition', () => {
    for (const fn of ['has_role', 'is_staff']) {
      const at = M44.lastIndexOf(`create or replace function tci.${fn}(`)
      expect(at, fn).toBeGreaterThan(-1)
      const body = M44.slice(at, M44.indexOf('$$;', at))
      expect(body, fn).toContain('and not tci.password_rotation_pending()')
      expect(body, fn).toContain('and tci.mfa_satisfied()')
    }
  })

  it('the hooks are executable by supabase_auth_admin only and gated on session_user', () => {
    for (const hook of ['password_verification_hook', 'mfa_verification_hook']) {
      expect(M44).toContain(`revoke execute on function tci.${hook}(jsonb) from public, anon, authenticated, service_role;`)
      expect(M44).toContain(`grant execute on function tci.${hook}(jsonb) to supabase_auth_admin;`)
      const body = M44.slice(M44.indexOf(`create function tci.${hook}(event jsonb)`))
      expect(body.slice(0, body.indexOf('$$;')), hook).toContain('perform tci.require_auth_admin();')
    }
    expect(M44).toContain("if session_user <> 'supabase_auth_admin' then")
  })

  it('a lockout refuses even the right password, and the reject message carries the machine token', () => {
    const body = M44.slice(M44.indexOf('create function tci.password_verification_hook(event jsonb)'))
    const hook = body.slice(0, body.indexOf('$$;'))
    // the standing-lockout check comes BEFORE the valid-password branch
    expect(hook.indexOf('v_lock := tci.active_lockout(v_user);')).toBeLessThan(hook.indexOf('if v_valid then'))
    expect(hook).toContain("'account_locked: too many failed sign-in attempts")
  })

  it('identifiers are stored hashed with the server salt, and the hash is closed to the API roles', () => {
    expect(M44).toContain("(select salt from tci.internal_secrets) || ':' || p_value, 'sha256'")
    expect(M44).toContain('revoke execute on function tci.security_hash(text) from public, anon, authenticated, service_role;')
    expect(M44).toContain('revoke all on tci.auth_attempts from public, anon, authenticated, service_role;')
    expect(M44).toContain('revoke all on tci.auth_events from public, anon, authenticated, service_role;')
    expect(M44).toContain('revoke all on tci.auth_lockouts from public, anon, authenticated, service_role;')
  })

  it('the lockout thresholds and the MFA policy live in workflow_settings', () => {
    for (const col of ['lockout_max_failures', 'lockout_window_minutes', 'lockout_duration_minutes',
      'mfa_required_for_admin', 'mfa_staff_enforced_from', 'auth_events_retention_days']) {
      expect(M44).toContain(`add column ${col}`)
    }
  })

  it('the closing assertion covers the new surface', () => {
    expect(M44).toContain('0044: ungated SECURITY DEFINER functions executable by authenticated')
    expect(M44).toContain('0044: an auth-hardening internal is reachable by an API role')
    expect(M44).toContain('0044: GoTrue cannot execute the password verification hook')
    expect(M44).toContain('0044: has_role/is_staff do not enforce the MFA policy')
  })
})

describe('the sign-in gate (0046)', () => {
  it('lets anon reach exactly the pre-auth entry points', () => {
    expect(M46).toContain("values ('login_begin',")
    expect(M46).toContain('0046: anon can execute tci functions beyond the pre-auth entry points')
    // PUBLIC is revoked only after authenticated's grant is restated.
    const loop = M46.slice(M46.indexOf('for r in'), M46.indexOf('end loop;'))
    expect(loop.indexOf('grant execute')).toBeGreaterThan(-1)
    expect(loop.indexOf('grant execute')).toBeLessThan(loop.indexOf('revoke execute'))
  })

  it('keeps the hook GoTrue-only and gated', () => {
    expect(M46).toContain(
      'revoke execute on function tci.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;',
    )
    expect(M46).toContain('grant execute on function tci.custom_access_token_hook(jsonb) to supabase_auth_admin;')
    expect(M46).toContain('0046: custom_access_token_hook is not gated')
  })

  it('refuses the right password while locked, and only a bypass ends sessions', () => {
    expect(M46).toContain("if v_lock.user_id is not null and v_lock.reason = 'bypass' then")
    expect(M46).toContain("if v_method <> 'password' then")
  })
})

describe('rotation and claim documents (0048)', () => {
  it('refuses to clear the rotation flag while the password is unchanged', () => {
    expect(M48).toContain('and p.temp_password_hash = tci.security_hash(u.encrypted_password)')
    expect(M48).toContain("revoke select (temp_password_hash) on tci.user_profiles from authenticated, anon;")
  })

  it('registers size and type from Storage, never from the browser', () => {
    expect(M48).toContain("where o.bucket_id = 'claim-documents' and o.name = p_storage_path;")
    expect(M48).toContain('v_size, v_type, p_note')
  })
})
