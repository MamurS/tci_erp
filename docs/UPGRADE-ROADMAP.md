# TCI ERP — Upgrade roadmap (from the September 2026 audit)

Phases are ordered by **risk reduction per unit of effort**. Each is written so
it can become a phase prompt: scope, dependencies, acceptance criteria. Finding
ids refer to `docs/AUDIT-2026-09.md`, Appendix A. Effort: XS < ½ day, S ≤ 2
days, M ≤ 1 week, L > 1 week. "Must" phases (A–D) close security, money and
data-loss exposure; "should" phases (E–J) are ordered but negotiable; "could"
items sit at the end.

Standard phase protocol applies to every phase unless the phase says otherwise
(local replay first, canonical apply, impersonated smoke, cleanup, report).

---

## Phase A — Security closure (must; S-1, S-2, S-3, S-5, S-4 partly) — **M**

**Goal.** No authenticated user can call a `SECURITY DEFINER` function that
changes or discloses data outside what their role and tenancy allow, and the
class of bug cannot return unnoticed.

**Scope.**
1. One migration that gates every internal helper currently reachable by
   `authenticated` without a check. Decide the mechanism per function:
   * staff-only helpers (`generate_premium_instalments`,
     `file_overdue_notification`, `verify_claim_coverage`, `correct_declaration`,
     `submit_declaration` when called by staff, `policy_liability_consumed`,
     `policy_afl_consumed`, `claim_covered_totals`, `claim_submission_blockers`,
     `claim_eligible_from`, `limit_in_force_at`, `buyer_has_effective_limit`,
     `underwriters_covering`, `similar_entities`) — `is_staff()` or the
     narrower role, or `may_access_claim` for claim readers;
   * internal-only helpers (`open_task`, `close_tasks`, `emit_workflow_event`,
     `suspend_limit_for_noa`, `suspend_limit_for_claim`) — an internal-call
     flag: the trusted caller sets `set_config('tci.internal_call', <token>,
     true)` and the helper refuses unless it is present; document why in the
     function comment;
   * client-reachable paths (`client_file_noa` → `file_overdue_notification`,
     `client_submit_declaration` → `submit_declaration`) keep working through
     the flag.
2. Replace `errcode = 'P0004'` (81×) with `'42501'` for permission refusals and
   `'P0003'` in `to_uzs` with `'P0002'`; keep message fragments unchanged so
   `errors.ts` mappings hold.
3. Enforce `must_change_password` in the database: `is_staff()`/`has_role()`
   return false (or the portal views return nothing) while it is set, except
   for `complete_password_change` and the profile read.
4. Revoke the residual `PUBLIC` grants on the 33 definer functions; pin
   `search_path` on `set_updated_at`; enable leaked-password protection and
   document the MFA position.
5. **Contract test** (`tests/db/definer_gates.sql` + a vitest that reads the
   migration chain): every `SECURITY DEFINER` function executable by
   `authenticated` must reference a gate or appear on an explicit allow-list
   with a justification.

**Dependencies.** None. Do this before the portal is opened to a real
policyholder.

**Acceptance.**
* The audit's client probe (unmapped `client` user, real policy id) is
  re-run verbatim and every call in §1.1 is refused with `42501`.
* `EXCEPTION WHEN OTHERS` in a wrapper catches a permission refusal.
* A client user with `must_change_password = true` gets zero rows from every
  `v_client_*` view through the REST API until rotation.
* Advisor: 0 `anon_security_definer_function_executable`; the authenticated
  list equals the allow-list.
* All existing smokes (Phases 3d, 4, 5, 6) still pass.

---

## Phase B — Operational floor (must; O-1, O-2, D-1, D-5, T-1 partly) — **S + M**

**Goal.** The system can be rebuilt from the repository, restored from a
backup, and the ledger on canonical matches the repository.

**Scope.**
1. **Backups (S).** GitHub Action, nightly: `pg_dump --format=custom` over
   the session pooler using a repository secret, encrypted with `age`,
   uploaded as an artifact with 30-day retention and mirrored to a bucket the
   owner controls. A documented restore procedure and a **quarterly restore
   drill** into a Supabase branch, followed by the smoke suite.
2. **Ledger reconciliation (M).** Take `pg_dump --schema-only` of canonical
   and of a fresh replay of 0001–0042 on Postgres 17; diff them; fix any
   difference in the repository; then rewrite canonical's
   `supabase_migrations.schema_migrations` to the file names (one controlled
   migration, dry-run on a branch first). From then on migrations are applied
   only by `supabase db push` from CI on merge to `main`, after a branch
   deploy.
3. **Committed replay harness (S).** `tools/db/` with `bootstrap.sql` (the
   Supabase stub), `replay.sh`, and the impersonation probes as
   `tests/db/*.sql`; a CI job runs the replay on a Postgres **17** service
   container and executes the probes.
4. **Tier and pause (XS).** Move canonical to a paid tier or add a keep-alive;
   record the region decision (Tokyo) and its latency as accepted or plan the
   move.
5. **Repo hygiene (S).** Move `Fineye*`, the report sample and the screenshot
   directory out of this repository (or under `legacy/` with a README);
   fix the stale path in DESIGN.md.

**Dependencies.** None; B.2 benefits from A landing first so the baseline
contains the gates.

**Acceptance.**
* A backup artifact exists for each of the last 7 nights; a restore into a
  branch passes the Phase 4–6 smokes.
* `diff` between the replayed schema and canonical is empty (ignoring owner
  and comment whitespace).
* CI is red if the replay fails or any impersonation probe returns rows.
* `supabase migration list` shows the same names locally and remotely.

---

## Phase C — Limit lifecycle and missing-rate safety (must; M-1, M-2, X-1, M-3, M-4) — **S**

**Goal.** A limit never lapses silently, and a missing fx rate never breaks a
screen or a decision path.

**Scope.**
1. `valid_until` becomes a **review date**: `v_effective_limits` no longer
   filters on it; `limit_review_due` remains the task; add
   `limit_review_overdue` (high) once the date passes. Withdrawal is always an
   explicit `revoked` decision with `limit.released` and a client notice.
   Remove the dead `expired` enum value or write it from an explicit
   `expire_limit` function if the owner wants hard expiry for key-buyer
   policies (owner decision — ask).
2. `v_group_exposure_lines.amount_uzs` computed null-safe (mirror
   `v_buyer_exposure`); `GroupExposurePanel` and the report section render
   "no rate" rows (the i18n keys already exist).
3. Stamp `released_at`/`release_kind = 'silent_consent'` lazily when the
   window elapses (extend the existing lazy pass), so `decision_effective_from`
   no longer depends on the current setting; keep the function as a fallback
   for rows released before this phase.
4. Agenda: `group_limit_fx_breach` when a group is over its limit purely from
   a rate move.

**Dependencies.** A (gates) is not required; C touches `decide_limit_request`
so land after A to avoid two rewrites of the same function.

**Acceptance.**
* A limit with `valid_until < today` still appears in `v_effective_limits`
  and `v_client_limits`, with an overdue review task.
* An EUR limit with no EUR rate: the Группа tab renders with a "no rate"
  badge; `decide_limit_request` on a *different* buyer in the same group
  succeeds.
* Changing `sales_window_hours` does not change `limit_in_force_at` for a
  decision released before the change (asserted on a fixture).

---

## Phase D — Group model at scale (must; W-1, D-3) — **M**

**Goal.** Group screens and the decision preflight stay under 200 ms at
10,000 companies.

**Scope.**
1. `tci.entity_group_members (ultimate_parent_id, member_id, depth,
   computed_at)` maintained by an AFTER trigger on `entity_relationships`
   that recomputes only the affected connected component using
   `tci.entity_group()` (which keeps the visited-set walk and the cyclic
   fixture as its test).
2. `v_entity_group`, `v_group_exposure_lines`, `v_group_financials` read the
   table; `ultimate_parent(uuid)` becomes a lookup with the walk as fallback.
3. Indexes on the hot foreign keys: `policyholder_users.user_id`,
   `credit_limit_decisions.adjusts_decision_id`, `…based_on_assessment_id`,
   `overdue_notifications.entity_id`, `declarations.supersedes_id`,
   `entity_relationship_suggestions.entity_b`, `tasks.source_event_id`,
   `legal_entities.industry_id`.
4. A scale test in `tests/db/` that loads 5,000 companies / 8,000 edges and
   asserts the three queries finish under a budget.

**Dependencies.** B.3 (harness in CI) to run the scale test.

**Acceptance.** On the 2,000-company fixture from the audit:
`v_entity_group where entity_id = X` < 20 ms; `v_group_financials where
ultimate_parent_id = X` < 200 ms; the 0038 cyclic assertions still pass;
Phase 6 smoke unchanged.

---

## Phase E — Frontend delivery and correctness (should; F-1, F-2, F-3, F-6, U-1) — **M**

**Scope.**
1. Route-level `React.lazy` per feature folder; `manualChunks` for `recharts`
   and `xlsx`; a bundle-size budget asserted in CI (main chunk < 500 KB).
2. Server-side pagination (`.range()` with a page size) on every list that can
   exceed 1,000 rows: registry, Agenda, claims, limits workspace, declarations,
   NOAs, history tabs. A lint rule or test that flags `select('*')` without a
   bound on those tables.
3. One `lib/sqlErrors.ts` registry (SQLSTATE + fragment → i18n key),
   contract-tested against the whole migration chain; replace the 20 bare
   `catch {}` sites; a top-level and per-route `ErrorBoundary` with a designed
   error state.
4. Fix the three `toFixed` violations; add uz plural forms; an enum-coverage
   test that walks every exported `*_TYPES`/`*_STATUSES` constant against the
   three locales.

**Dependencies.** A (error codes) for the registry.

**Acceptance.** Portal first load ≤ 400 KB gzip; a 1,500-row registry shows
all rows across pages; every deliberate refusal in §1.1 of the audit renders a
mapped message; a thrown render error shows the error state, not a blank page.

---

## Phase F — Host the analytics service and align the engine (should; A-1, A-2, A-3) — **S**

**Scope.**
1. Deploy to the option already chosen (Cloudflare Containers on the existing
   account, or Render Starter); set the secrets; point `VITE_ANALYTICS_API_URL`.
2. Persist `family` from `/grade-scale` on `credit_assessments` at write time;
   `grade_band_for_assessment` reads it (fallback to the first letter only
   for legacy rows); update CLAUDE.md.
3. Declare or remove the `anthropic` dependency in `narrative.py`; if kept,
   name the env var in `.env.example` and README and rate-limit the endpoint.
4. Rounding-parity test: SQL `round()` vs `round_limit` on the boundary cases
   (2500, 3500, 0.5) — documented expected difference, asserted.

**Acceptance.** Provisioning screen leaves its "unavailable" state; a rating
run from the UI writes an assessment with `family`; CI still builds and
smokes the image.

---

## Phase G — Workflow engine hardening (should; W-2, W-4, W-3) — **S**

**Scope.**
1. `pg_cron` job every 5 minutes calling `refresh_agenda()` under
   `pg_try_advisory_lock`; the on-read call becomes "run only if the last run
   is older than 60 s" (a `workflow_settings.agenda_refreshed_at` column).
2. Nightly reconciliation: close tasks whose object is in a terminal state
   (per type), and an admin view `v_stale_tasks`.
3. `for update` on the effective decision in `suspend_limit_for_noa` /
   `suspend_limit_for_claim`.
4. Amend CLAUDE.md: "no cron" becomes "cron only for reconciliation; on-read
   generation remains the fallback".

**Acceptance.** Agenda open time is independent of portfolio size; a task
whose object was changed by direct SQL is closed within 24 h; two concurrent
suspensions produce exactly one effective `revoked` row.

---

## Phase H — Endorsements, renewals and the policy term history (should; X-5 part 1) — **L**

**Scope.**
1. `tci.policy_terms` as an effective-dated child of `policies` (all wording
   terms, `valid_from`, `valid_to`, `endorsement_number`, reason); the
   `policies` columns become a projection of the current row; every consumer
   that judges a date (coverage verification, declaration split, premium)
   reads the term row in force at that date.
2. `endorse_policy(policy, terms, effective_from, reason)` SQL function with
   history and an Agenda task to commercial; client notice through the
   portal.
3. Renewal pipeline: `policy_renewals` (or an `insurance_request` of kind
   `renewal`) opened automatically 60 days before expiry with limits rolled
   over as `pending_review`; `expired` policy status set by a lazy pass;
   Agenda tasks for sales and credit.

**Dependencies.** C (limit lifecycle) and G (cron) first.

**Acceptance.** A mid-term DL change affects only shipments after its
effective date in `verify_claim_coverage`; a policy 60 days from expiry has a
renewal submission and rolled-over limit requests; the old terms remain
readable on the claim page for a shipment before the endorsement.

---

## Phase I — Claims timeline and DL basis (should; X-2, X-3, X-4) — **M**

**Scope.** Stop-shipment rule (shipments after the NOA deadline are
`not_covered` with a new reason code); claim filing deadline after the
waiting period (`claims.filing_deadline`, Agenda task, refusal by name);
withdrawal notice date on the revoked decision with a pipeline allowance
window (owner sets the days); DL basis captured per buyer (`dl_basis` enum:
`trading_experience`, `credit_report`, `other` + evidence note) and shown on
the declaration line and the claim verdict. Reason-code catalogue and
`coverage.ts` mirror extended, contract-tested.

**Acceptance.** Phase 5 smoke extended with one invoice shipped after the NOA
deadline (zero cover, new reason), one claim filed after the deadline
(refused by name), one DL line without a basis (flagged, not refused).

---

## Phase J — Calibration tooling for the engine (should; A-4) — **M–L**

**Scope.** A `credit_engine/calibration/` CLI: load a labelled corpus
(statements + outcome flags), score it with the current tables, print grade
distribution, migration matrix, AUC/KS, and the limit-to-revenue distribution;
tables versioned with a `TABLES_VERSION` recorded on every assessment. No
change to the tables themselves — that is the owner's decision with the
report in hand.

**Acceptance.** The CLI runs on a synthetic corpus in CI; an assessment row
records the tables version; the README explains how to calibrate.

---

## Phase K — Reinsurance, country limits, regulator reporting, audit export (should; X-5 part 2) — **L**

Separate scoping prompt needed; depends on H. Sketch: `treaties` (quota share
/ XoL, capacity, period), cession per policy/buyer/country computed on
`v_effective_limits`, a retained-capacity check in `decide_limit_request`
beside the group control; `country_limits` mirroring `group_limits`; a
reporting schema with the supervisor's forms as views; an `audit_export`
function producing a signed CSV/JSON bundle of decisions, status histories
and events for a period.

---

## Could (any time, XS–S each)

* Consolidated baseline migration + `docs/schema-history.md` (D-2) — after B.2.
* `set_updated_at` triggers on the nine tables; drop dead enum value; rename
  policies consistently (D-4).
* `eslint-plugin-jsx-a11y`, Modal focus trap and focus return, a mobile pass
  on the portal shell (F-5).
* Frontend error reporting (Sentry or equivalent), uptime check, migration
  failure alert, anon-key rotation runbook, provisioning audit log (O-3).
* Premium correction test (M-5); anon-key rotation doc; DESIGN.md refresh.

---

## Sequencing summary

```
A  Security closure ─────────┐
B  Operational floor ────────┼──► C  Limit lifecycle ──► D  Group scale ──► G  Workflow cron
                             │                                                   │
                             └──► E  Frontend ──► F  Host service               ▼
                                                                    H  Endorsements/renewals ──► I  Claims timeline ──► K  Reinsurance/reporting
                                                                    J  Calibration (parallel to H)
```

A and B are independent and should run first, in either order or in parallel.
Nothing else should be scheduled before both are done.
