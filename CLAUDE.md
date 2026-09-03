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

**Deployment: PREPARED, NOT DONE.** Phase 3d built everything the deploy
needs — `Dockerfile` + `render.yaml` at the repository root, CORS, rate
limits, the runbook in `services/analytics/README.md` — but the owner has
deferred hosting, so **the service runs nowhere**. Until it does, the
provisioning screens sit permanently in their «Сервис подготовки
пользователей недоступен» state and **no user can be created through the
UI**. See **Creating users while the service is unhosted** below.

Hosting options were assessed after Phase 3d, constrained to accounts we
already have (Supabase, Cloudflare, GitHub):

* **Cloudflare Containers** — runs the existing image unchanged next to
  Workers, deployed from this repo by Workers Builds, cold start 1–3s.
  Requires the **Workers Paid plan ($5/mo)** on the Cloudflare account that
  already serves Pages; there is no free tier for Containers. The image is
  ~200 MB against a 2 GB limit and the service measures **27 MiB RSS**, so
  the smallest `lite` instance fits with room to spare.
* **Porting off Python** (TS engine + Deno Edge Functions) was rejected.
  `credit_engine` has no numpy/pandas/scipy — only pydantic — so the port
  is not blocked, but it is ~2,900 lines across two new runtimes and the
  parity risk is real, not theoretical: Python's banker's rounding in
  `round_limit` makes `2500 -> 2000` where `Math.round` gives `3000`, on
  the recommended credit limit itself. It also contradicts the
  **Do NOT put analytics logic into Edge Functions** rule above and the
  Phase 5 plan for a Python analytics service.

### Creating users while the service is unhosted

`docs/create-user.sql` is the interim path: parameterised snippets to run
in the Supabase SQL editor of the canonical project that create a user
(staff or client), reset a password, and disable/enable an account. They
write exactly the rows `services/analytics/app/users.py` writes —
`auth.users` + `auth.identities` with a bcrypt hash, `tci.user_roles`,
`tci.user_profiles` with `must_change_password`, and
`tci.policyholder_users` for clients — and the auth column values were
taken from a row GoTrue itself created in this project, then verified
column-for-column against it (20/20) in a live smoke that cleaned up after
itself.

**The portal must not be opened to real policyholders until the service is
hosted.** Client sign-in and every portal screen work without it — those
go through the `tci.v_client_*` views and `tci.client_*` functions of
migration 0025, which never touch the service. What does not work is
everything around the account: sales and commercial underwriting cannot
invite their own clients from the company card, and a locked-out client
cannot be reset except by whoever holds database access. Onboarding and
lockout recovery both funnel through one person with a SQL editor, which
is fine for internal test accounts and not fine for customers.

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
- [x] User provisioning — admin creates staff, sales/commercial invite clients. Auth users are created by the FastAPI service (`services/analytics`), the only holder of `SUPABASE_SERVICE_ROLE_KEY`; the browser never sees that key. Temporary password shown on screen once (no SMTP), forced rotation via `tci.user_profiles.must_change_password`, self-service «Сменить пароль» for everyone. The service is BUILT but NOT HOSTED — hosting is deferred, so the screens sit in their service-unavailable state and users are created by hand via `docs/create-user.sql`.
- [x] Phase 3c-2: Agenda + policy binding — `tci.tasks` generated from `tci.workflow_events` by an AFTER INSERT mapping that also closes tasks when their object moves on (11 types, 10 auto / 1 manual), band-aware targeting, the two time-based kinds generated lazily by `tci.refresh_agenda()` with no cron; `/agenda` «Моя повестка» (grouped overdue → urgent → high → normal, type/object filters, deep links, bulk-open only) + sidebar badge with a separate overdue tone; `credit_limit_requests.policy_id` made nullable behind `tci.limit_scope(policy_id, insurance_request_id)` so new business can carry limits before a policy exists; `tci.bind_insurance_request` projects the agreed terms into a policy, adopts the package limits onto it and advances to `bound`
- [x] Phase 3d: analytics service made deployable + client portal — `Dockerfile` and `render.yaml` at the repo root (build context is the root: the service imports `credit_engine` as a path dependency), CORS allowlist + preview regex, 1 MB body cap, 30s deadline, opaque 500s, structured access log, per-IP **and** per-caller rate limits on provisioning (the IP bucket is a ROUTER dependency, so an unauthenticated flood is not free); `/portal` for users whose ONLY role is `client` — my policies, my credit limits (released decisions only), request a limit (registry picker + propose-by-name → `tci.client_buyer_proposals` → information_manager), my submissions (accept / request changes / decline), account. Every client read goes through a `tci.v_client_*` SECURITY DEFINER view and every write through a `tci.client_*` function; the base-table client policies are dropped
- [x] Phase 4 (operations): turnover declarations, premium, overdue notifications — `tci.declarations` + `declaration_lines` with the DL/uncovered-excess split (frozen on acceptance, computed live before it), corrections that supersede rather than overwrite; `premium_basis` + `tci.premium_instalments` generated when a policy is created + `tci.premium_entries` (rate recorded, never re-derived) + `tci.v_policy_premium` with the no-refund-below-minimum adjustment; `tci.overdue_notifications` (NOA) with derived lateness and an AUTOMATIC limit suspension through the existing emergency-release path; seven new Agenda task types behind a SECOND event trigger; `/declarations`, `/overdues`, the policy «Премия» tab, and portal screens for declaring, paying and reporting overdue accounts
- [x] Phase 5: claims, indemnity and subrogation — `tci.claims` (CL-YYYY-NNNN) with a SQL
  status machine and history, `claim_invoices` whose shipment date is what cover is judged
  on; **coverage verification** reconstructs the limit in force at each shipment date from
  the decision history (`tci.limit_in_force_at`) and records a per-invoice verdict with
  machine-readable reason codes, which a claims underwriter may override WITHOUT
  overwriting what the engine said; a deterministic traced indemnity
  (`tci.calculate_indemnity`, mirrored in `src/features/claims/indemnity.ts`) frozen onto
  the claim at approval (the NQL is a de-minimis THRESHOLD tested before the insured
  percentage, not a deduction — 0037); `claim_payments` capped by it and `recoveries`
  split pro rata on
  the loss each side bore; a private `claim-documents` Storage bucket with row-scoped RLS
  and a required-document checklist that refuses submission by name; seven Agenda types
  behind a THIRD event trigger; `/claims` queue + six-tab claim page, and the portal's own
  file-a-claim surface
- [x] Phase 6: corporate groups and group exposure — `tci.entity_relationships`
  (typed, time-bounded, directed edges) with CYCLE-SAFE resolution:
  `tci.entity_group` walks the live edges UNDIRECTED carrying a per-path
  visited set (the real guarantee) plus a configurable depth cap (a second
  belt, default 10), so a cross-holding terminates; the group has no record of
  its own — its identity IS `tci.ultimate_parent`. `tci.entity_relationship_suggestions`
  turns five cheap signals (shared corporate email domain, address, contact
  person, pg_trgm name similarity, registration prefix) into ADVISORY hints
  generated lazily on read, which never become an edge without a human stating
  the direction and the type. `tci.v_group_exposure` sums the in-force member
  limits in UZS by the standard fx rule with per-member and per-policyholder
  breakdowns and missing rates counted separately, and `tci.group_limits` caps
  it — enforced BLOCKING inside `decide_limit_request` (refuse, escalate, emit
  `limit.group_limit_breached`, return `result: 'group_limit_exceeded'`) and
  inside `adjust_limit_commercial` on INCREASES only, with admin exempt and the
  emergency path never consulted. Two lazily-generated Agenda types, a
  «Группа» tab, the «Возможные связи» panel, a preflight banner on both
  decision forms, a group chip on the limit and claim pages, and a group
  section in the printed risk report
- [ ] Phase 7: Python analytics service (scoring/rating)

## Design notes (future phases — recorded, not built)

* ~~Phase 3b: role enum, multi-role users, 2D authority matrix~~ — **DONE** (migrations 0016–0018).
* ~~Phase 3c-1: insurance_request pipeline, two-stage decisions, sales window~~ — **DONE** (migrations 0019–0021).
* Phase 3c (SHIPPED as 3c-1, see above): insurance_request pipeline (client/sales/comm UW create → sales resolves entities, auto-task to information_manager for missing ones → parallel commercial (terms) + credit (ratings/limits, confirming engine auto-rating) → sales confirmation → client acceptance → bind). Two-stage limit decisions: credit stage (rating+limit) then optional commercial stage adjusting ONLY amount and credit period, both directions, within own authority; rating and conditions untouchable by commercial. In-force changes: credit → commercial → sales window (configurable, default 1 business day) with silent-consent release (lazy released_at, no cron), then visible to client; REDUCTIONS and REVOCATIONS bypass commercial and sales — visible to client immediately (emergency risk actions). Agenda: single tasks table (type, object ref, assignee role/user, due, status) driving all queues.
* ~~Phase 3d: client portal~~ — **DONE** (migration 0025). See **Client visibility** below.

### Open items (carried into Phase 3c-2, and what is left after it)

* ~~A submission cannot hold credit decisions before a policy exists~~ —
  **RESOLVED in 3c-2** (migration 0023). `policy_id` is nullable, and the
  grouping key everywhere is `tci.limit_scope(policy_id, insurance_request_id)`
  = `coalesce(policy_id, insurance_request_id)`. A submission scopes its own
  limits until bind, then they are adopted onto the policy and re-scope
  automatically. See **The limit scope key** below.
* ~~Bind is a status transition only~~ — **RESOLVED in 3c-2** (migration 0023).
  `tci.bind_insurance_request(request_id, policy_number, inception, expiry)`
  projects the agreed terms into a policy, adopts the package's limit requests
  onto it, stamps `bound_policy_id` and drives the `bound` transition itself.
  The bare `accepted → bound` transition is still legal SQL (bind uses it) but
  is deliberately NOT offered as a button — `NOT_OFFERED_DIRECTLY` in
  `src/features/requests/machine.ts` — because it would strand a submission as
  `bound` with no policy behind it.
* **Assignees are stored, not yet used.** `assigned_sales` / `assigned_commercial`
  / `assigned_credit` exist and are surfaced nowhere: the Agenda owns
  assignment, and inventing a second assignment UI now would compete with it.
* **`buyer_resolution_status` beyond `ready` is still not advanced
  automatically.** `rating_done` / `limit_done` are set by hand. The Agenda now
  consumes `rating.created` and `limit.credit_decided` to CLOSE its own tasks,
  but it does not write back to `insurance_request_buyers`; doing so is a small
  follow-up in the same mapping.

### Workflow event catalogue (`tci.workflow_events`, migration 0019)

Append-only. The Agenda mapping (`tci.handle_workflow_event`, migration 0024)
is its reader: an AFTER INSERT trigger on this table.
Each row carries `event_type`, `object_type`, `object_id`, `actor`,
`target_role` (the department the ball moves to) and a `payload` jsonb.

| event_type | object_type | payload | target_role |
|---|---|---|---|
| `request.created` | insurance_request | — | — |
| `request.status_changed` | insurance_request | from, to, comment | the owner of the new status |
| `request.assigned` | insurance_request | field, user | the assignee's role |
| `request.buyer_added` | insurance_request | buyer_row_id, name, entity_id, request_number | `sales` |
| `request.buyer_resolved` | insurance_request | buyer_row_id, entity_id | `credit_underwriter` |
| `limit.credit_decided` | credit_limit_decision | outcome, amount, grade_band | `commercial_underwriter` |
| `limit.commercial_adjusted` | credit_limit_decision | credit_decision_id, from_amount, to_amount, grade_band, is_reduction | `sales`, or `client` on a reduction |
| `limit.released` | credit_limit_decision | release_kind, comment | `client` |
| `limit.held` | credit_limit_decision | comment, request_id | `commercial_underwriter` |
| `limit.request_submitted` | credit_limit_request | entity_id, amount, currency | `credit_underwriter` |
| `limit.request_escalated` | credit_limit_request | entity_id, amount, currency, grade_band, amount_uzs | `credit_underwriter` |
| `rating.created` | credit_assessment | entity_id, grade | `credit_underwriter` |
| `request.bound` | insurance_request | policy_id, policy_number, limits_adopted | `sales` |

### The limit scope key (migration 0023)

`tci.credit_limit_requests.policy_id` is **nullable**: new business raises
limit requests inside a submission, before any policy exists. Everything that
used to group by `policy_id` now groups by

```sql
tci.limit_scope(policy_id, insurance_request_id)  -- coalesce(policy, submission)
```

an `immutable` SQL function, so it can key an index. A `check` constraint
guarantees at least one of the two is set, so the key is never null.

**Why coalesce and not a three-column key.** A composite
`(policy_id, insurance_request_id, entity_id)` index would let the SAME buyer
hold one open request under the submission and another under the policy the
moment bind adopted the first — two open requests for one buyer, which is
exactly what the one-open-request rule exists to prevent. `DISTINCT ON` has
the mirror-image problem: it treats NULL keys as EQUAL, so every pre-bind
limit across every submission would collapse into one row. Coalescing makes
the scope a single value that MOVES with the limit when bind adopts it,
instead of a pair that can disagree.

Touchpoints (all in 0023):

| what | how it is keyed |
|---|---|
| `credit_limit_requests_open_uq` | `(tci.limit_scope(…), entity_id)` where status is open |
| `v_effective_limits` | `distinct on (tci.limit_scope(…), r.entity_id)`, exposing `scope_id` and `pre_bind` |
| `v_buyer_exposure` | `and v.policy_id is not null` — a pre-bind limit is not exposure |
| `decide_limit_request` supersede | scope-to-scope comparison |
| `apply_emergency_release` | same |
| client RLS (requests + decisions) | resolves through the policy OR the submission's applicant |
| `submit_limit_request` | policy path needs an ACTIVE policy; submission path refuses declined/withdrawn/bound |
| `bind_insurance_request` | adopts `policy_id` onto the package, which re-scopes it |

### Agenda task catalogue (`tci.tasks`, migration 0024)

Tasks are **generated, never hand-maintained**: the mapping opens them for the
department the ball moved to and closes them when the condition resolves. Ten
of the eleven types therefore close themselves; `tci.complete_task` REFUSES
every type but `submission_declined`, and `src/features/agenda/catalogue.ts`
mirrors that so the «Готово» button is only ever offered where the database
will accept it.

| task_type | target | priority | closes |
|---|---|---|---|
| `buyer_needs_entity` | information_manager | high | AUTO `request.buyer_resolved` |
| `buyer_needs_rating` | credit_underwriter | normal | AUTO `rating.created` |
| `limit_needs_decision` | credit_underwriter * | normal | AUTO `limit.credit_decided` |
| `limit_escalated` | credit_underwriter * | urgent | AUTO `limit.credit_decided` |
| `submission_commercial_review` | commercial_underwriter | normal | AUTO status leaves `commercial_review` |
| `submission_sales_confirmation` | sales | high | AUTO status leaves `sales_confirmation` |
| `limit_held` | the decider (user) | high | AUTO `limit.released` / `limit.commercial_adjusted` |
| `submission_accepted` | sales | high | AUTO `request.bound` |
| `submission_declined` | sales | normal | **MANUAL — the only one** |
| `limit_review_due` | credit_underwriter | high ≤7d, else normal | AUTO lazily, once no longer near expiry |
| `rating_stale` | credit_underwriter | normal | AUTO `rating.created`, or lazily |

`*` **band-aware**: addressed to the individual underwriters whose `credit`
authority covers the amount (`tci.underwriters_covering`), falling back to the
role when that cannot be resolved — no grants, or no fx rate for the currency.

`submission_declined` is manual because nothing downstream happens once the
client says no: a human decides the file is closed. Every other type has an
objective signal, so none of them can linger.

**`due_at` is the silent-consent clock made visible.** On
`→ sales_confirmation` it is set to the EARLIEST moment one of the package's
decisions would reach the client on its own (`min(decided_at) + sales window`),
so an overdue row means the window has run out.

**No cron anywhere.** `limit_review_due` and `rating_stale` are generated AND
retired by `tci.refresh_agenda()`, which the screen calls on read; the set is
recomputed rather than accumulated, so repeating it is a no-op. The badge and
the board share one React Query key so the two can never disagree, and
`staleTime` is what keeps the generation to roughly once a minute.

**Nothing is backfilled.** The table starts empty on purpose — replaying
months of the event stream would open tasks for work already done.

**Rendered text never reaches the database.** A task stores `title_key` +
`params`; the UI renders it in the viewer's language. The same rule is why
`bind_insurance_request` writes no note on the policy and no comment on the
`bound` history row: provenance is structural (`bound_policy_id`), and the UI
renders «Создан из заявки …» translated.

### Phase 4 rules that are easy to get wrong

**The DL / uncovered-excess split** (`tci.classify_declaration_line`, 0026).
Deliberately asymmetric:

* buyer WITH an approved, released limit → the whole turnover is covered,
  however large. A credit limit caps the outstanding BALANCE, not the flow of
  sales through a period, so capping declared turnover at the limit would
  understate cover and therefore premium.
* buyer WITHOUT one → cover stops at the policy's discretionary limit, and the
  rest is **uncovered excess**: not insured, never folded into the covered
  figure, and reported as its own Agenda task for commercial review.

The split is computed live while the declaration is open and **frozen onto the
lines when it is accepted**, because premium is earned from it: revoking a
limit next week must not restate last month's premium.

**Premium** (0027). Earned = COVERED turnover x the rate, recorded per
declaration with `rate_used`, so a mid-term rate change applies forward only.
`adjustment_amount` is `greatest(earned - minimum, 0)` — **there is no refund
below the minimum premium**, stated in the view comment and on both screens.
Instalments are generated by an AFTER INSERT trigger on `tci.policies`, so both
`bind_insurance_request` and a hand-created policy get a schedule; the last
instalment absorbs the rounding remainder so the schedule sums to the minimum
exactly. A policy created before 0027 has no schedule until someone presses
«Создать график» (`tci.generate_premium_instalments`).

**The NOA suspension chain** (0028). Filing an NOA writes a `revoked` decision
on the buyer's limit request. `tci.apply_emergency_release` already stamps
`released_at = now()` and `release_kind = 'immediate'` on any revocation, so it
bypasses commercial review and the sales window and reaches the policyholder at
once — which is the point. Two things that are NOT optional:

* the suspension **supersedes** the prior effective decisions for the scope,
  exactly as `decide_limit_request` does. Without it `v_effective_limits`,
  which ranks a commercial-stage row above a credit one, keeps serving the old
  commercially adjusted limit and the suspension is invisible where it matters.
* `credit_limit_decisions.decided_by` is now **nullable**, with
  `system_generated` + `system_reason_key`. The filer may be the CLIENT, who
  must never appear as the author of an underwriting decision. The reason is an
  i18n KEY, never rendered text.

Resolving an NOA does **not** reinstate the limit: the buyer paid this invoice,
and whether they are good for the next one is a fresh credit decision.

**`security_invoker` propagates** (0029 → fixed in 0030). A client view that
does not set the option runs as its owner — but when it selects from a view
that DOES set it, permission checks on that inner view's base tables fall back
to the session user, and staff-only RLS returns nothing. Four Phase 4 client
views were silently empty until the live smoke caught it. **A client view must
read base tables, or read through a SECURITY DEFINER FUNCTION** (inside one the
current user really is the owner). The 0025 views were always base-table-only
and were never affected.

### Phase 5 rules that are easy to get wrong

**Coverage is judged at SHIPMENT, from history, not from current state.**
`tci.credit_limit_decisions` records `lifecycle` but never WHEN a decision was
superseded, so the supersede chain cannot be read backwards. The in-force
decision is therefore RECONSTRUCTED by `tci.limit_in_force_at(policy, buyer,
date)`, which orders by

```sql
tci.decision_effective_from(released_at, decided_at, held)
  -- released_at, or decided_at + the sales window when silent consent released it,
  -- and NULL while the decision is held: the policyholder was never told.
```

and takes the last one at or before that date (commercial stage wins a tie,
mirroring `v_effective_limits`). A limit revoked today does not retract cover
for goods shipped last month, and an increase granted today does not
retroactively cover them.

**The running balance is the DEBT, not the covered part.** Invoices are walked
in shipment order and each is tested against the limit in force at its own
shipment date, with `headroom = cap - balance_before`. The balance then
accumulates the whole claimable amount, covered or not: an uninsured shipment
still fills the buyer's limit.

**Shortfalls and breaches are different things.** `limit_exceeded` /
`dl_exceeded` cap an amount and produce `partial`. Everything else in
`BREACH_REASONS` — payment terms past the policy maximum, a shipment outside
the policy period, a revoked or declined limit, and the notification duty —
sets the covered amount to ZERO. A late or missing NOA is prejudicial on every
line of the claim, and is flagged at claim level as well.

**An override never overwrites.** `system_verdict`/`system_covered_amount` and
`override_verdict`/`override_covered_amount` are separate columns of the same
row, with `effective_*` generated from `coalesce(override, system)`.
`tci.verify_claim_coverage` rewrites only the system half — the upsert's
update list deliberately omits the override columns, and 0033 asserts on its
own source text that it still does.

**The NQL is a THRESHOLD, not a deduction** (0037, correcting 0034). The
non-qualifying loss is a DE MINIMIS: the size below which a loss does not
qualify to be claimed at all. So it is a gate, and three things follow.

* It is tested on the **confirmed covered loss, per buyer, BEFORE the insured
  percentage** — the question is about the loss, not about the insurer's share
  of it. (A claim is already per buyer, so the claim's covered debt IS the
  per-buyer figure.)
* It is **all or nothing**. Below it the claim is not indemnifiable and nothing
  is payable — not "payable less the NQL". At or above it the FULL covered loss
  proceeds with **no subtraction at all**.
* **EQUAL QUALIFIES.** The comparison is `>=`, never `>`; the boundary is
  asserted in the migration on its own source text, in the TypeScript contract
  test, and in the live smoke.

`tci.approve_claim` refuses a below-threshold claim BY NAME, separately from
"nothing was covered": they are different facts and the policyholder is owed
the second one plainly. The refusal carries the i18n key
`claims.indemnity.belowNql`.

**The indemnity order is the contract** (`tci.calculate_indemnity`, 0034,
replaced by 0037):

```
covered debt (effective, i.e. after overrides)
  NQL THRESHOLD: covered debt >= nql_amount, or nothing is payable
  x insured_percentage
  - deductible_each_loss
  - what is LEFT of aggregate_first_loss after earlier claims
  capped at max_liability_amount less what earlier claims consumed
```

The two deductions come AFTER the percentage on purpose: the retained
percentage is a share of the loss, the deductibles are amounts of money, and a
deduction taken first would be silently scaled down by the percentage. The
threshold is the opposite and comes BEFORE, because it is a test on the loss
itself. Every step floors at zero. `approved_indemnity`, `afl_consumed` and the whole trace
are FROZEN onto the claim at approval, for the same reason the declaration
coverage split is frozen on acceptance: money moved on those numbers. Whether
a claim is `approved` or `partially_approved` is DERIVED from uncovered debt,
never chosen.

**Recovery distribution** (`tci.record_recovery`): costs off the top, then the
net splits in the ratio of the loss each side bore — insurer = indemnity paid
to date, policyholder = claimable debt less that (uncovered lines, the retained
percentage, the NQL, the deductible, the AFL). The policyholder takes the
REMAINDER rather than a second rounded product, so the two shares always add
back to the net exactly. The split is stored per recovery, not derived: the
borne shares move as more indemnity is paid, and a distribution already made
must not change afterwards.

**A client-facing Agenda task is addressed to a PERSON, never to the role.**
The `tasks: read mine` policy lets anyone holding a role read every task
targeted at that role. That is right for a department and catastrophic for
`client`, which every policyholder holds. `claim_ready_to_file` and
`claim_info_requested` therefore target the individual users from
`tci.policyholder_users` (`tci.policyholder_user_ids`); 0036 asserts no client
type is ever role-targeted.

**`text[] || 'literal'` is ambiguous and will crash.** Postgres resolves the
unknown literal as an ARRAY, so appending a plain string to a `text[]` raises
"malformed array literal" the first time that branch actually fires — it
type-checks and passes any test where the branch is not taken.
`tci.claim_submission_blockers` casts every key `::text` for exactly this
reason. It cost a debugging round twice: once in the migration, once in the
smoke script itself.

### Phase 6 rules that are easy to get wrong

**Cycle safety is the visited set, not the depth cap.** Companies really do own
each other, so `tci.entity_group` carries the path as a `uuid[]` and refuses to
re-enter a node already on it (`not (e.b = any (w.path))`). That is what
guarantees termination: the graph is finite and no path repeats a node.
`tci.group_depth_cap()` (default 10, a `workflow_settings` column) is a second
belt for a pathologically wide graph, and a group deeper than it is TRUNCATED
rather than wrong-but-unbounded. Migration 0038 proves both on a live
`A→B→C→A + sister D` fixture that cleans itself up.

**The walk is UNDIRECTED, the ultimate parent is not.** Membership is the
undirected closure over the edges valid TODAY — two subsidiaries of one parent
share a group although no edge runs between them, so each edge is traversed
both ways. `tci.ultimate_parent` then picks the member no other MEMBER owns or
controls (`affiliate` and `common_owner` are not "being owned by"), ties broken
by lowest id so the group's identity is STABLE across calls. In a pure cycle
nobody qualifies, so the lowest id is used — arbitrary, documented, and
consistent, which is what callers actually need.

**A suggestion is a hint and never an edge.** Every signal has an innocent
explanation — two unrelated companies share a serviced office — so
`refresh_entity_suggestions` only ever writes a suggestion row, and
`accept_relationship_suggestion` is the ONLY path to an edge, still going
through `save_entity_relationship` so a human states the direction, the type
and the percentage. Free-mail domains (`gmail.com`, `mail.ru`, …) are excluded
outright: they say a company is small, not that it is related, and including
them buries the real signals. A rejected pair is remembered and never proposed
again. Generation is lazy on read, candidate-narrowed by a cheap shared
attribute first — the registry is never scanned pairwise — and there is no cron.

**The exposure formula.** Per ultimate parent, over `v_effective_limits` with
`outcome in ('approved','partial')` and `policy_id is not null` (a pre-bind
limit is not exposure, same rule as `v_buyer_exposure`):

```
exposure_uzs = Σ tci.to_uzs(approved_amount, currency)   -- rows WITH a rate
missing_rates = count of rows whose currency has no rate today
```

Rows without a rate are **counted separately, never treated as zero**: a group
with missing rates is incomplete, not small.

**The enforcement rule.** `tci.group_exposure_preflight(entity, amount,
currency, exclude_scope)` computes

```
after = max(exposure_uzs - what this (scope, buyer) already contributes, 0) + to_uzs(amount)
over_limit = group_limit_uzs is not null and after > group_limit_uzs
```

Netting off the superseded scope is what makes raising a limit from 100 to 120
add 20 and not 120. **The UI preflight and the SQL enforcement call the SAME
function** — there is no second implementation to drift, which is why this one
mirror is not restated in TypeScript the way authority is.

Over the limit, `decide_limit_request` behaves exactly like the personal
authority path: it sets the request to `escalated`, emits
`limit.group_limit_breached` and returns `result: 'group_limit_exceeded'` —
refused, but in front of someone who can weigh the whole group.
`adjust_limit_commercial` has no escalated state, so it raises instead, and
**only on an increase**. Three exemptions, all deliberate: **admin may
proceed** (an underwriting control, not a security boundary — and the override
is still an authored decision row); **reductions** are never blocked; and
`apply_emergency_release` never consults a group limit at all, asserted on its
own source text in 0040. Blocking a revocation because the group is over its
limit would trap the insurer at the higher number.

**Closing a control must stop it TODAY.** `valid_to` is inclusive, so
`end_group_limit` defaults to `current_date - 1` and the window constraint
permits `valid_to >= valid_from - 1` precisely so a limit set and lifted the
same day can be closed. Without that an underwriter removing a control would
find it still blocking them for the rest of the day — caught by the Agenda
assertion, not by any type checker.

**The combined figures are a SUM, not a consolidation.** `v_group_financials`
adds the latest statements of the members we hold statements for, with no
intra-group eliminations: inter-company revenue and balances are counted twice
and the currencies are added as reported. The view comment says so, 0041
asserts the comment still says so, and the screen repeats it — a number
labelled "group revenue" that quietly means something else is worse than no
number. `members_missing_statements` is part of the answer, not a footnote.

**A default PUBLIC grant is not a revoke.** 0039 granted execute on the writing
functions and revoked them from `public`, but left `tci.relationship_signals`
with its default PUBLIC grant. It is `SECURITY DEFINER` and reads
`tci.legal_entities`, so `anon` could have read an address, a contact person
and an email domain through `/rest/v1/rpc/`. The Supabase **security advisor**
caught it after the apply; 0042 closes it and asserts that no Phase 6
`SECURITY DEFINER` function is anon-executable. Run `get_advisors` after every
phase — the local replay cannot see PostgREST exposure.

### Replaying the migration chain locally

Phase 5 was developed against a **local Postgres 16** with a small Supabase
stub (roles, `auth.users` + `auth.uid()`, `storage.buckets`/`objects`,
`pg_trgm` in schema `extensions`), replaying `0001` … `latest` with
`psql --single-transaction` per file. It is worth rebuilding when a phase gets
large: it caught two real defects that typecheck, lint and the unit tests all
missed — four staff views shipped with **no `select` grant** (every claims
screen would have rendered "permission denied"), and the `text[] || 'literal'`
crash above. Two things to know: use `--single-transaction`, because
`apply_migration` is transactional and 0015 relies on a temp table surviving
between statements; and install `pg_trgm` into `extensions`, not `public`.

### Client visibility (migration 0025)

A row policy decides WHICH ROWS, never WHICH COLUMNS, and staff and clients
share the `authenticated` database role, so a column grant cannot separate
them. Every client-facing surface is therefore a **SECURITY DEFINER view**
carrying its own `has_role('client')` + `policyholder_users` gate and
selecting only safe columns, and the base-table client policies are DROPPED.
A client selecting from a base table gets nothing at all — a far easier
property to keep true than "every column of every table is safe".

| what a client can read | through | predicate |
|---|---|---|
| own policies + wording terms | `v_client_policies` | `entity_id in my_client_entities()` |
| released limits per buyer | `v_client_limits` | + `decision_is_released(...)` |
| their conditions | `v_client_limit_conditions` | + `decision_is_released(...)` |
| superseded/expired limits | `v_client_limit_history` | + `released_at is not null` |
| own limit requests + proposals | `v_client_limit_requests` | union of both, same gate |
| own submissions | `v_client_submissions` | terms NULL until `submission_terms_visible(status)` |
| the buyer package | `v_client_submission_buyers` | same gate |
| status history | `v_client_submission_history` | statuses + timestamps only, **no `comment`** |
| countries, currencies, industries | base tables | all authenticated (reference data) |
| own profile / roles / mapping | base tables | `user_id = auth.uid()` |

**Never visible to a client**: `legal_entities` (the registry — reachable only
through the capped `client_search_entities`), `credit_assessments`,
`financial_statements`, `balance_sheets`, `income_statements`,
`local_statement_values`, `fx_rates`, `policy_status_history`,
`workflow_events`, `tasks`, `authority_grants`, `workflow_settings`,
`client_buyer_proposals`, and — on every view above — the underwriter's
`comment`, `hold_comment`, `decided_by` and `based_on_assessment_id`.

**Three actions**, all SECURITY DEFINER: `client_search_entities` (min 3
chars, capped, four columns), `client_request_limit` (known buyer → a
submitted limit request; unknown → a proposal for information_manager, and a
client NEVER writes `legal_entities`), `client_respond_to_submission`
(accept / decline / request_changes, and it only ever writes the status).

**Two column-level holes the audit found and 0025 closed**: the client UPDATE
policy on `insurance_requests` was not column-restricted, so a raw PATCH could
rewrite `premium_rate_pct` while the submission sat in `client_review`; and
`user_profiles: update own` let any user PATCH `must_change_password = false`
and walk past the forced rotation. The first is now a function, the second a
column grant (`full_name`, `phone` only) — which works there because the
distinction needed is not staff-versus-client but "nobody, by hand".

**`client_review → sales_confirmation`** is new in 0025: "request changes"
means the cover is wanted and the terms are not. It re-opens sales' existing
Agenda task, now carrying the client's comment.

### The analytics service in production (Phase 3d)

**Not hosted yet — hosting is deferred.** The Render blueprint
(`Dockerfile` + `render.yaml` at the repository root — the build context
must be the root, because the service imports `credit_engine` as an
editable path dependency) is ready to use, and its free tier sleeps after
~15 min idle (~1 min cold start) with $7/mo Starter removing that. The
current preferred option is **Cloudflare Containers on the existing
account** ($5/mo Workers Paid, 1–3s cold start) — see **The service-role
key** above for the comparison. Until one is chosen and set up, users are
created by hand: `docs/create-user.sql`. Full runbook, env vars and key
rotation: `services/analytics/README.md`.

Hardening that must not regress: CORS allowlist + an ANCHORED preview regex
(never `*`), 1 MB body cap, 30s request deadline, opaque 500s with a request
id, one structured JSON access line per request with no header values, and
rate limits on provisioning where the **per-IP bucket is a router
dependency** — inside the endpoint body it would never run for an
unauthenticated request, making a 401 flood free.
