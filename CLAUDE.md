# TCI ERP — Mosaic Insurance Group

ERP system for the Trade Credit Insurance (TCI) line of business at Mosaic Insurance Group JSC (Tashkent, Uzbekistan). Standalone application, but built with module discipline so it can later be embedded into a wider company ERP.

## Product vision

Two underwriting pillars plus operations:

1. **Credit underwriting (buyer underwriting)** — register of buyers (debtors), credit limit requests, decisions (approve / partial / decline / withdraw), buyer financials, scoring & credit grades, limit monitoring and reviews, full decision history per buyer.
2. **Commercial underwriting (policy underwriting)** — policyholders, quotations, policies (whole-turnover and key-buyer structures), terms: premium rate, insured percentage, non-qualifying loss (NQL), maximum liability, waiting period, deductibles, discretionary limit.
3. **Operations** — turnover declarations, premium booking, overdue notifications, claims and recoveries (subrogation).
4. **Reference & authority** — countries, industries, underwriting authority limits (who can approve up to which amount), approval workflow.

Benchmark for domain logic: Allianz Trade / Coface / Atradius practices.

## Tech stack

- **Frontend:** React + TypeScript (strict) + Vite
- **Backend:** Supabase (PostgreSQL + Auth + RLS + auto REST)
- **Hosting:** Cloudflare Pages, deploy via GitHub
- **Future analytics service:** separate Python FastAPI service (buyer scoring, rating models, financial statement analysis) talking to the same Postgres. Do NOT put analytics logic into Edge Functions.

## Architecture rules (important)

- **Minimize Supabase lock-in.** Keep as much logic as possible in plain PostgreSQL: tables, views, SQL functions, triggers, RLS policies. The project must survive a future migration to self-hosted Supabase or bare Postgres + FastAPI.
- **All TCI tables live in dedicated Postgres schema `tci`** (not `public`). Never assume we are alone in the database.
- **Migrations only.** All schema changes via Supabase CLI migration files committed to the repo (`supabase/migrations/`). Never change schema manually through the dashboard.
- **RLS from day one.** Every table gets RLS enabled with explicit policies before any UI touches it.

## Roles & access model

Department roles (stored in `tci.user_roles`, enforced via RLS). **A user may hold SEVERAL roles** — one row per (user, role); access is the union:

- `admin` — full access, manages users, roles and authorities
- `sales` — companies and policies (read), raises limit requests
- `commercial_underwriter` — policy terms; the commercial stage of decisions (Phase 3c)
- `credit_underwriter` — ratings, limits and credit decisions within band authority
- `claims` — claims and recoveries
- `information_manager` — fills in company data and financial statements
- `client` — external portal user: sees ONLY own policies, own limit requests, own declarations. Design every policy with this role in mind even before the portal exists.

SQL helpers: `tci.current_user_roles()` (setof), `tci.has_role(variadic)`, `tci.is_staff()` (= any role except `client`). There is **no `senior_underwriter`** any more — seniority is expressed by the authority matrix.

Underwriting authority is a **2D matrix** (`tci.authority_grants`): user × stream (`credit` | `commercial`) × grade band (`A`/`B`/`C`/`D`/`unrated`) × amount × currency × validity. `tci.my_authority_uzs(band)` = MAX over the caller's currently valid `credit` grants for that band, converted to UZS by the Phase 2b fx rule. **Admin is unlimited.** A decision above the deciding user's band authority sets the request to `escalated` (a workflow status, not just UI hiding); any credit underwriter whose band authority covers it — or an admin — can then decide it. The band comes from the grade FAMILY of the assessment the decision is based on (A1/A2→A …); no assessment ⇒ `unrated`. Band families are served by the analytics service (`GET /grade-scale` → `family`), never hardcoded outside the band names.

## i18n

- Trilingual: **English (en), Russian (ru), Uzbek (uz)** — same approach as our existing proposal app.
- Use `react-i18next`. No hardcoded user-facing strings anywhere, including validation messages and enum labels.
- Database enum values stay in English; translation happens in the UI layer.
- Default language: Russian. Currency handling: policies may be in UZS, USD, EUR — store amounts with currency code, never assume one currency.

## Conventions

- TypeScript strict mode; no `any` unless truly unavoidable.
- Feature-folder structure: `src/features/buyers`, `src/features/limits`, `src/features/policies`, `src/features/declarations`, `src/features/claims`, `src/features/admin`.
- Shared UI primitives in `src/components/ui`. Keep components small; extract logic into hooks.
- Dates: store `timestamptz` in UTC; display in Asia/Tashkent.
- Money: `numeric(18,2)` in Postgres, never floats.
- Conventional commits (`feat:`, `fix:`, `chore:`, `db:`).
- Every migration file gets a short comment header explaining what and why.

## Standard phase protocol

The rules every phase follows. A prompt saying "follow the standard phase
protocol" means all of this; a prompt may override any single point, but
silence means the default below applies.

### Before starting

- Read this file and `DESIGN.md` first.
- Before a large refactor, enumerate EVERY touchpoint (grep for the old
  names, the routes, the i18n keys, the tests) and work from that list —
  half-renamed code is worse than none.
- A migration that moves or destroys EXISTING data gets a dry run against
  canonical first: run it inside a transaction with a forced rollback, check
  the row counts, then apply for real. Additive migrations do not need this.

### Schema discipline

- Numbered migration files in `TCI_ERP/supabase/migrations/` only. **Never**
  dashboard SQL, never an ad-hoc `execute_sql` DDL. Each file opens with a
  `-- What:` / `-- Why:` header.
- Everything in the `tci` schema. RLS enabled on every table, with explicit
  policies per role, before any UI touches it.
- Business logic and state machines live in **SQL functions**, not in the
  client: transitions, guards, authority checks, derived visibility. The UI
  mirrors them so it can grey out a button; the database is what enforces.
- `SECURITY INVOKER` by default. Reach for `SECURITY DEFINER` only when the
  function must read what the caller cannot (`tci.has_role` and the admin
  views) or when a policy would recurse into itself — and say why in a
  comment.
- History is immutable: decisions, status history and event rows are
  inserted and superseded, never updated in place. A new row supersedes an
  old one; the chain stays readable.
- A data-moving migration asserts its own success in-migration (row counts
  before/after, no orphans) and raises rather than committing a bad merge.

### Contract tests

Wherever the frontend restates SQL logic — a state machine, an authority
rule, grade-band mapping, view precedence, a release predicate — lock the
mirror to the migration **text**:

```ts
import MIGRATION from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
expect(MIGRATION).toContain("if v_request.status not in ('submitted', 'under_review', 'escalated') then")
```

The same trick works across languages (`provisioningAccess.test.ts` reads
the service's `provisioning_rules.py`). This is not ceremony: it has already
caught real drift between the two sides. Test the pure module, never the
component tree.

### Canonical project

- After local verification, apply migrations to the canonical Supabase
  project (ref in the **Infrastructure** section) — and nowhere else.
- Then run a live smoke with **role impersonation**, not as the owner:
  `set local role authenticated` + `set_config('request.jwt.claims', …)`,
  `reset role` between actors. Assert the refusals too, by SQLSTATE.
- Create fixtures and delete them in the same transaction; temp tables get
  `on commit drop` (and a `grant` to `authenticated` if an impersonated role
  writes to them). Verify the pre-existing dataset is unchanged afterwards.
- **Never leave a test user, entity or row behind.** The canonical project
  holds the owner's real data.

### Quality gates

`npm run typecheck`, `npm run build`, `npm run lint`, `npm test`, and
`uv run pytest` in `services/analytics` when that service is touched — all
green before pushing. New logic ships with its tests in the same commit.

### i18n

- Every user-facing string in en/ru/uz, including validation messages, enum
  labels and error text. Locale parity is enforced by a test.
- The glossary below is **authoritative**. Never invent a term that
  contradicts it, and never quietly pick a translation for a domain term the
  glossary does not cover — flag it in the final report for the owner.
- Check declension and suffix forms, not just the nominative: ru plurals and
  cases, uz suffixes. A term correct in isolation can be wrong in a sentence.

### Errors and UX

- A deterministic refusal gets a **mapped, readable message** naming what
  was refused and why. A generic "something went wrong" is acceptable only
  for a genuinely unknown failure — never for a rule the database enforces
  on purpose.
- Amber for non-blocking accounting and validation warnings, red for hard
  errors (`DESIGN.md`). Never a raw server string in the UI.
- Every screen has a designed empty state — what it is, and what to do next.

### Design system

- Compose from `src/components/ui`. If a control is needed twice, extract a
  primitive; do not duplicate a one-off.
- Follow the financial display rules in `DESIGN.md`: `src/lib/format.ts` is
  the only formatter, dynamics coloring is direction-aware, null renders as
  "—" and never as 0.

### Git

- Work on a branch; conventional commits; open a PR when the phase is done.
- Keep the tree clean — no scratch scripts, no `.tmp` files.
- **Never** commit a `.env` or any key. `.env.example` carries names only.

### Finishing

Update the phase checklist in **Current status / roadmap**, then report:

1. **Schema** — tables, enums, views, functions added or changed.
2. **Function contracts** — signature, who may call it, what it refuses.
3. **Screens** — what shipped, and who can see each.
4. **Terminology flags** — every term you were unsure of.
5. **Live smoke** — what ran against canonical, and that cleanup verified.
6. **Deviations** — where you departed from the prompt and why.

Deviations are expected and welcome when justified. **Silent** deviations
are not: if the prompt cannot be followed as written, say so and say what
you did instead.

## Domain glossary (for consistent naming)

- `buyer` — the debtor whose credit risk is insured (NOT our client)
- `policyholder` — our insured client (the seller)
- `credit_limit_request` → `credit_limit_decision` — request/decision pair, full history preserved (decisions are never updated in place; new decision supersedes old)
- `discretionary_limit` (DL) — amount up to which policyholder self-assesses buyers
- `insured_percentage` — typically 80–90%
- `max_liability` — cap on insurer's aggregate liability, usually a multiple of premium
- `turnover_declaration` — periodic report of insurable sales per buyer/country
- `overdue_notification` — policyholder's report of a buyer exceeding the maximum extension period
- `annulled` (policy status) — policy voided as if never concluded (premium returned); distinct from `cancelled` (расторжение: terminated from a date, prior performance stands)

### Uzbek insurance terminology (owner-dictated, authoritative)

Use these exact uz terms everywhere (UI, reports, narratives, validation). The apostrophe is U+2018 (‘), matching the existing uz locale.

| Concept | ru | uz (authoritative) |
|---|---|---|
| policyholder | Страхователь | **Sug‘urtalanuvchi** (NOT «Sug‘urta qildiruvchi») |
| buyer (debtor role) | **Байер** (NOT «Покупатель») | **Bayer** (NOT «Xaridor») |
| company / organization (registry entity; en "Company") | **Организация** | **Tashkilot** |
| insured person | Застрахованное лицо | **Sug‘urtalanuvchi shaxs** |
| insurer | Страховщик | **Sug‘urtalovchi** |
| non-qualifying loss | NQL | **Qoplanmaydigan zarar (NQL)** |
| discretionary limit | Дискреционный лимит | **Diskretsion limit** |
| deductible | Франшиза | **Franshiza** |
| risk | Риск | **Qaltislik** |
| policy cancellation (расторжение) | Расторгнут | **Bekor qilish** / **Bekor qilingan** |
| policy annulment | Аннулирован | **Annulyatsiya** / **Annulyatsiya qilingan** |
| limit revocation (risk action) | Отозван | **Limitni bekor qilish** / **Bekor qilingan** |
| request withdrawal (by requester) | Отозвана | **Qaytarib olish** / **Qaytarib olingan** |
| claims (department / section) | Убытки | **Sug‘urta da’volari** |
| insured event | Страховой случай | **Sug‘urta hodisasi** (the event itself — never for the department) |

**Homonymy rule (owner-dictated).** Policy cancellation and limit revocation deliberately share the short status label **«Bekor qilingan»** — they live on different screens, so the badge is unambiguous in context. Buttons and confirmations must ALWAYS name the object: «Shartnomani bekor qilish», «Limitni bekor qilish». Never ship a bare «Bekor qilish» as a domain action. `zarar` stays the accounting term for *loss* (P&L, NQL, deductibles) and must not be swapped for `da’vo`.

**«Bekor qilish» is RESERVED for domain actions (owner-dictated).** The generic
modal/form dismiss is **«Yopish»** (`common.cancel`), never «Bekor qilish» — so
the phrase only ever appears with an object in front of it and can never be
mistaken for a cancellation or a revocation. Two consequences:

* **Annulment keeps its object-less label** «Annulyatsiya qilish» as shipped.
  The object rule exists to separate the two *bekor qilish* meanings; annulment
  is not one of them, so it needs no object to be unambiguous.
* **Do not borrow the verb for “cannot be undone.”** Irreversibility is
  **«qaytarilmas»** («Bu amal qaytarilmas»), not «bekor qilib bo‘lmaydi», which
  would read as the cancellation action.

`src/i18n/uzTerminology.test.ts` enforces all of this: it fails on a bare
«Bekor qilish» anywhere in the uz locale and names the offending key.

Department role names (uz, confirmed): `admin` — Administrator, `sales` — **Sotuv**, `commercial_underwriter` — **Tijorat anderrayteri**, `credit_underwriter` — **Kredit anderrayteri**, `claims` — **Sug‘urta da’volari**, `information_manager` — **Axborot menejeri**, `client` — **Mijoz**.

## Infrastructure

- **Canonical Supabase project: `tci_erp`, ref `reunqrpeumokqgarknge`, org United Organics.**
  NEVER deploy TCI migrations or write TCI data to any other Supabase project,
  regardless of what MCP lists. The company ERP project `mosaic-erp-production`
  (org Mosaic APP) is out of bounds for TCI.

### The service-role key (user provisioning)

Creating auth users needs `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses RLS
entirely**. It lives ONLY in `services/analytics`'s environment:

- never a `VITE_` variable, never in `TCI_ERP/.env.local` — anything Vite can
  see ships to the browser;
- never committed (`.env` is git-ignored; `.env.example` carries names only);
- never logged, returned, or echoed in an error (the wrapper truncates
  upstream error bodies);
- if exposed, rotate it in the dashboard — rotation is the only remedy.

The endpoints authenticate the CALLER with the caller's own access token and
load their roles from `tci.user_roles` server-side; a role claimed in a
request body is never trusted.

**Cloud-deployment dependency.** The service runs locally only, so on the
deployed site the provisioning screens show «Сервис подготовки пользователей
недоступен» (the Rating-tab pattern) and everything else works normally.
Deploying it somewhere that can hold the key is a separate task; it gates
the client portal (Phase 3d), which cannot onboard anyone without it.

## Current status / roadmap

- [x] Phase 0: scaffold (repo, Vite app, Supabase project, auth, roles, i18n, layout)
- [x] Phase 1a: Financial Analysis — design system, buyers registry, IFRS statement spreading (BS/P&L), vertical/horizontal analysis, ratios (see DESIGN.md)
- [x] Phase 1b: Local forms & mapping — UZ NAS templates (F1/F2), local entry, IFRS mapping algorithm with cross-checks
- [x] Phase 1c: Rating & Limit v1 — services/analytics (FastAPI over credit_engine), credit_assessments history, functional tab
- [x] Phase 1d: Analytics core — derived cash flow (indirect), risk analysis (Altman Z-double-prime), statutory/management split, multi-period display, CBU currency conversion, Excel export
- [x] Phase 1f: Rating presentation & Risk Report — GradeScale, factor traffic lights, score history, buyer profile (founded/legal form), print-route PDF report en/ru/uz
- [x] Phase 1g: Buyer dashboard — Overview tab as a living report composed from existing modules (requisites + compact GradeScale, factor chips, key-figure strip, clickable narrative bullets → tab/sub-tab drill-down, responsive dynamics charts); growth dynamics always in original statement currency; report print pagination fixed (verified headlessly)
- [ ] Phase 1e: credit limit requests/decisions (UI will be modeled on screenshots of our legacy system — to be provided)
- [x] Phase 2a: commercial underwriting foundation — policyholder registry, TCI policies with wording terms, SQL status machine (change_policy_status + history), portal-ready policy RLS, dashboard stat cards (quotations deliberately deferred)
- [x] Phase 2b: credit limit workflow — requests/decisions attached to (policy, buyer): one open request per pair, immutable decisions with typed conditions, authority routing in UZS (escalation to senior), supersede/revoke chains, exposure views, /limits workspace + request page, policy & buyer integration
- [x] Phase 3a: unified legal-entities registry — tci.legal_entities merges buyers + policyholders (merge on country+reg number, FKs renamed to entity_id, old tables dropped), roles COMPUTED via v_entity_roles (never assigned), pg_trgm dedup-on-entry (blocking reg match + fuzzy suggestions), /entities registry + card with conditional tabs, legacy /buyers & /policyholders redirects
- [x] Phase 3b: department roles + 2D authority matrix — user_role enum recreated (sales/commercial_underwriter/credit_underwriter/claims/information_manager/client + admin), multi-role users, RLS restated on has_role/is_staff, tci.authority_grants (stream × grade band × amount × validity), band-aware decide/revoke, /admin users & authorities screens, role-driven sidebar + route guards
- [x] Phase 3c-1: insurance requests + two-stage limit decisions — `tci.insurance_requests` pipeline (draft → submitted → entity_resolution → underwriting → commercial_review → sales_confirmation → client_review → accepted/declined → bound) with SQL-enforced role gates and content guards, buyer package with name-only buyers resolved onto companies, decisions gain `stage` (credit | commercial) with commercial adjusting ONLY amount and payment terms within its own band authority, lazy release with a sales window + silent consent (no cron) and an emergency bypass for reductions/revocations, append-only `tci.workflow_events` for the future Agenda, `/requests` queue + submission page, company card «Заявки на страхование» tab
- [x] User provisioning — admin creates staff, sales/commercial invite clients. Auth users are created by the FastAPI service (`services/analytics`), the only holder of `SUPABASE_SERVICE_ROLE_KEY`; the browser never sees that key. Temporary password shown on screen once (no SMTP), forced rotation via `tci.user_profiles.must_change_password`, self-service «Сменить пароль» for everyone. **Depends on deploying that service to the cloud** — until then provisioning works only while it runs locally, and the screens show a service-unavailable state (see below).
- [ ] Phase 3c-2: Agenda (single tasks table driving all queues) — consumes `tci.workflow_events`
- [ ] Phase 3 (operations): declarations, premium booking, overdues
- [ ] Phase 4: claims & recoveries
- [ ] Phase 5: Python analytics service (scoring/rating)
- [ ] Phase 6: policyholder portal

## Design notes (future phases — recorded, not built)

* ~~Phase 3b: role enum, multi-role users, 2D authority matrix~~ — **DONE** (migrations 0016–0018).
* ~~Phase 3c-1: insurance_request pipeline, two-stage decisions, sales window~~ — **DONE** (migrations 0019–0021).
* Phase 3c (SHIPPED as 3c-1, see above): insurance_request pipeline (client/sales/comm UW create → sales resolves entities, auto-task to information_manager for missing ones → parallel commercial (terms) + credit (ratings/limits, confirming engine auto-rating) → sales confirmation → client acceptance → bind). Two-stage limit decisions: credit stage (rating+limit) then optional commercial stage adjusting ONLY amount and credit period, both directions, within own authority; rating and conditions untouchable by commercial. In-force changes: credit → commercial → sales window (configurable, default 1 business day) with silent-consent release (lazy released_at, no cron), then visible to client; REDUCTIONS and REVOCATIONS bypass commercial and sales — visible to client immediately (emergency risk actions). Agenda: single tasks table (type, object ref, assignee role/user, due, status) driving all queues.
* Phase 3d: client portal — invitation-only (sales creates, system sends link + temp password, forced password change on first login; requires the password-change page and Supabase Site URL setup).

### Open items carried into Phase 3c-2

* **A submission cannot hold credit decisions before a policy exists.**
  `tci.credit_limit_requests.policy_id` is `not null` (migration 0013), so the
  limit requests a submission raises must point at an EXISTING policy. That
  works for renewals and extensions of a live policy; for genuinely new
  business the `underwriting → commercial_review` guard
  (`tci.request_credit_complete`) can only be satisfied after a policy exists.
  Fixing it properly is a 3c-2/bind concern, because `policy_id` is load-bearing
  in three places: the `(policy_id, entity_id)` one-open-request unique index,
  the `distinct on (policy_id, entity_id)` of `v_effective_limits`, and the
  client RLS path that joins decisions → requests → policies →
  policyholder_users. Options to weigh then: a provisional policy created at
  `underwriting` and activated at `bind`, or a nullable `policy_id` with the
  submission id as the alternate grouping key.
* **Bind is a status transition only.** `advance_insurance_request(…, 'bound')`
  sets the status and stamps `bound_policy_id` if something else filled it in;
  it does NOT create the policy from the proposed terms. The terms columns of
  `tci.insurance_requests` deliberately shadow `tci.policies` so that step is a
  straight projection when 3c-2 builds it.
* **Assignees are stored, not yet used.** `assigned_sales` / `assigned_commercial`
  / `assigned_credit` exist and are surfaced nowhere: the Agenda owns
  assignment, and inventing a second assignment UI now would compete with it.
* **`buyer_resolution_status` beyond `ready` is not advanced automatically.**
  `rating_done` / `limit_done` are set by hand today; the Agenda should move
  them off `limit.credit_decided` events.

### Workflow event catalogue (`tci.workflow_events`, migration 0019)

Append-only; nothing consumes it yet — the Agenda of 3c-2 is its first reader.
Each row carries `event_type`, `object_type`, `object_id`, `actor`,
`target_role` (the department the ball moves to) and a `payload` jsonb.

| event_type | object_type | payload | target_role |
|---|---|---|---|
| `request.created` | insurance_request | — | — |
| `request.status_changed` | insurance_request | from, to, comment | the owner of the new status |
| `request.assigned` | insurance_request | field, user | the assignee's role |
| `request.buyer_added` | insurance_request | buyer_row_id | `sales` |
| `request.buyer_resolved` | insurance_request | buyer_row_id, entity_id | `credit_underwriter` |
| `limit.credit_decided` | credit_limit_decision | outcome, amount, grade_band | `commercial_underwriter` |
| `limit.commercial_adjusted` | credit_limit_decision | credit_decision_id, from_amount, to_amount, grade_band, is_reduction | `sales`, or `client` on a reduction |
| `limit.released` | credit_limit_decision | release_kind, comment | `client` |
| `limit.held` | credit_limit_decision | comment | `commercial_underwriter` |
