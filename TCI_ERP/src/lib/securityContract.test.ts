/** Security closure contract (migration 0043, audit Phase A).
 *
 * Three things must stay true, and each is locked to the migration TEXT so
 * a drift fails CI rather than waiting for the next audit:
 *
 *  1. No migration after 0042 raises `P0004`. It is `assert_failure`, which
 *     `exception when others` does not catch; permission refusals are 42501.
 *  2. The allow-list of SECURITY DEFINER functions that may skip a gate is the
 *     one below, with a justification each. It starts small and grows only
 *     with a reason. tests/db/definer_gates.sql proves the same thing against
 *     the catalog on the replay harness; this test proves the migration still
 *     SAYS it.
 *  3. The token machinery keeps its shape: two entry points, one closed to
 *     `authenticated`, and a gate helper for every mechanism the rule names.
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

const M43 = Object.entries(MIGRATIONS).find(([p]) => p.endsWith('0043_security_closure.sql'))?.[1]
if (!M43) throw new Error('0043_security_closure.sql not found')

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
]

describe('no migration after 0042 raises P0004', () => {
  it('scans every numbered migration above 0042', () => {
    const late = Object.entries(MIGRATIONS).filter(([p]) => number(p) > 42)
    expect(late.length).toBeGreaterThan(0)
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
  const block = M43.slice(
    M43.indexOf('create function tci.definer_gate_allowlist()'),
    M43.indexOf('grant execute on function tci.definer_gate_allowlist()'),
  )
  const listed = [...block.matchAll(/\(\s*'([a-z_]+)',\s*'((?:[^']|'')*)'\)/g)].map((m) => ({
    name: m[1],
    why: m[2].replace(/''/g, "'"),
  }))

  it('matches this mirror exactly, name for name, reason for reason', () => {
    expect(listed).toEqual(DEFINER_GATE_ALLOWLIST)
  })

  it('every entry carries a justification', () => {
    for (const e of DEFINER_GATE_ALLOWLIST) expect(e.why.length, e.name).toBeGreaterThan(12)
  })

  it('names no workflow writer', () => {
    const writers = ['open_task', 'close_tasks', 'emit_workflow_event', 'file_overdue_notification',
      'generate_premium_instalments', 'suspend_limit_for_noa', 'suspend_limit_for_claim',
      'submit_declaration', 'correct_declaration', 'verify_claim_coverage']
    for (const w of writers) expect(DEFINER_GATE_ALLOWLIST.map((e) => e.name)).not.toContain(w)
  })
})

describe('the internal-call token and the gates', () => {
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

  it('the password rotation is enforced inside has_role and is_staff', () => {
    expect(M43).toContain('and not tci.password_rotation_pending()')
    expect((M43.match(/and not tci\.password_rotation_pending\(\)/g) ?? []).length).toBe(2)
  })

  it('the in-migration assertion covers the same four properties this file relies on', () => {
    expect(M43).toContain("0043: ungated SECURITY DEFINER functions executable by authenticated")
    expect(M43).toContain("0043: anon-executable SECURITY DEFINER functions remain")
    expect(M43).toContain("0043: P0004 still raised by")
    expect(M43).toContain("0043: the internal-call token is reachable by authenticated")
  })
})
