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

Department roles (stored in `tci.user_roles`, enforced via RLS). **A user may hold SEVERAL roles** — one row per (user, role) — but since 0063 **acts in ONE at a time**: the acting role (the role of the active workspace, kept per sign-in session in `tci.acting_roles`) is what every gate answers for; access is NOT the union. See **Acting role and four-eyes rules** below.

- `admin` — **technical**: users, roles, authorities, reference data, contract templates and settings; read-only oversight of the business screens; makes **no business decisions** — on limits since 0063 (no decide, adjust, hold, release, revoke, validate, ADT or group limit, no authority), everywhere else since 0065 (no claims, declarations, premium, policy status or edits, submissions, bind, offers, contract drafts, companies, statements, ratings, data requests, relationships, nor another department's Agenda task)
- `sales` — companies and policies (read), raises limit requests
- `commercial_underwriter` — policy terms; the commercial stage of decisions (Phase 3c)
- `credit_underwriter` — ratings, limits and credit decisions within band authority (rates only in `combined` credit analysis mode, 0069)
- `credit_analyst` — rates buyers and confirms ratings, enters statements, proposes manual grades and sends grades for validation, sets buyers' ADT within their own authority grants (0073); a credit analyst marked SENIOR by admin sets group ratings (0074); never decides a limit (0068–0069, workspace «Кредитный анализ»). See **Credit analysis rules** and **Rating proposal rules** below
- `claims` — claims and recoveries
- `information_manager` — fills in company data and financial statements
- `client` — external portal user: sees ONLY own policies, own limit requests, own declarations. Design every policy with this role in mind even before the portal exists. **`client` is held alone** — a trigger on `tci.user_roles` refuses it next to any other role (`client_role_exclusive`, 0062), and the admin role editor greys the combination out.

SQL helpers: `tci.current_user_roles()` (setof — the ACTING role only since 0063), `tci.has_role(variadic)` and `tci.is_staff()` (= acting role is not `client`) answer for the acting role; `tci.held_roles()` lists every role held (the workspace switcher); `tci.acting_role()` / `tci.set_acting_role(role)`. There is **no `senior_underwriter`** any more — seniority is expressed by the authority matrix.

Underwriting authority is a **2D matrix** (`tci.authority_grants`): user × stream (`credit` | `commercial`) × grade band (`A`/`B`/`C`/`D`/`unrated`) × amount × currency × validity. `tci.my_authority_uzs(band)` = MAX over the caller's currently valid `credit` grants for that band, converted to UZS by the Phase 2b fx rule. **Nobody is unlimited** — since 0063 admin holds no authority and makes no limit decision. A decision above the deciding user's band authority is not recorded: since 0060 `decide_limit_request` answers `needs_validation`, and the author sends the PROPOSED decision up the **authority levels** of the stream (since 0071 — ranks 1–4 with band authority as the level's grants, rank 5 the committee; a person's authority is the larger of their personal grants and their level's): straight to the lowest rank that covers it (`direct`, the ranks in between told) or rank by rank (`sequential`). Nobody is named any more (`named_validator_retired`). The request sits as `escalated` (a workflow status, not just UI hiding) «на валидации» with that level; any eligible member approves, approves modified within their own authority, returns, rejects or forwards to the next rank; the committee decides by vote — see **Limit validation rules** and **Authority levels rules** below. A group-limit breach (0040) still escalates to the credit pool. The band comes from the grade FAMILY of the assessment the decision is based on (A1/A2→A …); no assessment ⇒ `unrated`. Band families are served by the analytics service (`GET /grade-scale` → `family`), never hardcoded outside the band names.

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
  mirrors them so it can grey out a button; the database is what enforces —
  and since Phase A that is a checked property, not a hope: every
  `SECURITY DEFINER` function executable by `authenticated` opens with a
  `tci.require_*()` gate or is allow-listed with a reason, and both the
  migration assertion and `tests/db/definer_gates.sql` fail otherwise. See
  **Security closure rules** below.
- `SECURITY INVOKER` by default. Reach for `SECURITY DEFINER` only when the
  function must read what the caller cannot (`tci.has_role` and the admin
  views) or when a policy would recurse into itself — and say why in a
  comment. **A `SECURITY DEFINER` function never starts without a gate**
  (`perform tci.require_staff()` / `require_role(...)` /
  `require_claim_access(id)` / `require_staff_or_internal()` /
  `require_internal_call()`), or an entry on `tci.definer_gate_allowlist()`
  with a one-line justification.
- Permission refusals raise `errcode = '42501'`; rule refusals `P0001`;
  not-found `P0002`. **Never `P0004`** — it is `assert_failure`, which
  `exception when others` does not catch (the audit's own probes aborted on
  it). `src/lib/securityContract.test.ts` fails on any later migration that
  uses it.
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
| non-qualifying loss | **Невозмещаемые убытки (NQL)**; «невозмещаемые убытки» in running text (NOT «Некредитуемый / Некомпенсируемый / Неквалифицируемый убыток») — owner-decided 2026-10-22 | **Qoplanmaydigan zarar (NQL)** |
| insured percentage (`insured_percentage`) | **Процент покрытия** (NOT «страховой процент», «доля покрытия», «Страховое покрытие») — owner-decided 2026-10-22 | — (not decided; uz unchanged) |
| aggregate first loss (AFL) | **Агрегатная франшиза** (NOT «Совокупная франшиза») — owner-decided 2026-10-22 | — (not decided; uz unchanged) |
| policy (the insurance policy object) | **Полис** (NOT «Договор» / «по договору TCI-…»); «договор» stays ONLY for the generated contract document and its templates («Договоры», «Шаблоны договоров», «Проект договора», `wording.*`) and for the buyer's supply contract («Договор поставки») — owner-decided 2026-10-22 | — (not decided; uz unchanged) |
| grade band (A/B/C/D/unrated, authority) | **Диапазон рейтинга** — «в диапазоне рейтинга B», «по диапазонам рейтинга» (NOT «рейтинговый класс», «класс B», bare «Диапазон», «грейд-бэнд»); en "rating band" — owner-decided 2026-10-22 | **reyting diapazoni** (NOT «reyting klassi», «reyting sinfi», bare «Diapazon») |
| engine-calculated credit limit | **Рекомендуемый лимит** (NOT «Расчётный лимит (модель)», «Расчётный лимит»); en "Recommended limit" — owner-decided 2026-10-22 | **Tavsiya etilgan limit** |
| engine-calculated grade (`engine_grade`) | **Рекомендуемый рейтинг** (NOT «Рейтинг модели»); en "Recommended grade" — owner-decided 2026-10-24 | **Tavsiya etilgan reyting** (NOT «Model reytingi») |
| grade in force (`rating_grade`, after confirmation) | **Рейтинг** (NOT «Действующий рейтинг»); en "Grade" — owner-decided 2026-10-24 | **Reyting** (NOT «Amaldagi reyting») |
| manual rating (`credit_assessments.source = 'manual'`, 0073) | **Ручной рейтинг** — owner-decided 2026-10-25 | **Qo‘lda belgilangan reyting** |
| rating proposal (0073) | **Предложение рейтинга** — owner-decided 2026-10-25 | **Reyting taklifi** |
| escalate (a proposal up the authority levels) | **Эскалировать** — owner-decided 2026-10-25 | **Yuqoriga yo‘naltirish** |
| group rating (0074) | **Рейтинг группы** — owner-decided 2026-10-25 | **Guruh reytingi** |
| senior credit analyst (0074) | **Старший кредитный аналитик** — owner-decided 2026-10-25 | **Katta kredit tahlilchi** |
| change a limit request (portal, 0075) | **Изменить запрос** — owner-decided 2026-10-25 | **So‘rovni o‘zgartirish** |
| withdraw a limit request (portal action, 0075) | **Отозвать запрос** — owner-decided 2026-10-25 | **So‘rovni qaytarib olish** |
| the policyholder's changes (staff section, 0075) | **Изменения страхователя** — owner-decided 2026-10-25 | **Sug‘urtalanuvchining o‘zgartirishlari** |
| overdue notification (NOA) | Уведомление о просрочке | **xabarnoma** in every form and suffix (NOT «bildirishnoma») — owner-decided 2026-10-22 |
| discretionary limit | Дискреционный лимит | **Diskretsion limit** |
| deductible | Франшиза | **Franshiza** |
| risk | Риск | **Qaltislik** |
| policy cancellation (расторжение) | Расторгнут | **Bekor qilish** / **Bekor qilingan** |
| policy annulment | Аннулирован | **Annulyatsiya** / **Annulyatsiya qilingan** |
| limit revocation (risk action) | Отозван | **Limitni bekor qilish** / **Bekor qilingan** |
| request withdrawal (by requester) | Отозвана | **Qaytarib olish** / **Qaytarib olingan** |
| claims (department / section / role / workspace) | **Претензии** (NOT «Убытки») — owner-decided 2026-10-22; «убыток / убытки» stays ONLY for the accounting loss (P&L, NQL, deductibles, incurred losses) | **Sug‘urta da’volari** |
| a claim (the object) | **Претензия** (NOT «Требование», «Требование о возмещении», «Убыток», «дело по убытку») — owner-decided 2026-10-22 | **da’vo** |
| insured event | Страховой случай | **Sug‘urta hodisasi** (the event itself — never for the department) |

The ru decisions of 2026-10-22 (and uz «xabarnoma») are enforced by `src/i18n/ruTerminology.test.ts`, which names every retired variant it finds and the key it sits on.

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

Department role names (uz, confirmed): `admin` — Administrator, `sales` — **Sotuv**, `commercial_underwriter` — **Tijorat anderrayteri**, `credit_underwriter` — **Kredit anderrayteri**, `credit_analyst` — **Kredit tahlilchi** (NOT «Kredit tahlilchisi»; ru «Кредитный аналитик») — owner-decided 2026-10-24, `claims` — **Sug‘urta da’volari**, `information_manager` — **Axborot menejeri**, `client` — **Mijoz**.

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
- ~~Phase 1e: credit limit requests/decisions modelled on the legacy system's screens~~ — **CLOSED by the owner 2026-10-22**: there are no screenshots of the legacy system's limit requests/decisions (the ten in `legacy/СКРИНЩОТЫ ИСКК/` show its financial analysis card, already covered by 1a/1d), and the limit workflow of Phase 2b (+ 3c-1, 0053) stays as it is
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
- [x] Audit (Prompt 19): `docs/AUDIT-2026-09.md` + `docs/UPGRADE-ROADMAP.md`
- [x] Audit Phase A — security closure (migration 0043): every `SECURITY
  DEFINER` function executable by `authenticated` carries a gate or sits on
  `tci.definer_gate_allowlist()` with a reason; an unforgeable per-transaction
  internal-call token marks trusted workflow code; permission refusals raise
  `42501` (P0004 is gone); `must_change_password` is enforced inside
  `has_role`/`is_staff`; residual PUBLIC grants revoked. Locked by
  `tests/db/definer_gates.sql` and `src/lib/securityContract.test.ts`
- [x] Audit Phase A2 — application security hardening (migrations 0044–0045):
  account lockout fed by the Supabase Auth password/MFA verification hooks
  (`tci.auth_attempts`, `tci.auth_lockouts`, hashed identifiers, admin
  unlock), TOTP MFA with the policy enforced INSIDE `has_role`/`is_staff`
  (`tci.mfa_satisfied`: admin mandatory, other staff from
  `mfa_staff_enforced_from`, clients optional, enrolled ⇒ step-up), an
  append-only `tci.auth_events` trail with admin views (events, lockouts,
  sessions, per-user state, alerts) and session revocation; Turnstile on
  sign-in, readable sign-in errors (`src/auth/signInErrors.ts`), staff
  `/account` (password, MFA, other devices), `/mfa/verify`, admin
  «Безопасность»; strict CSP/HSTS in `public/_headers` (verified headlessly);
  claim documents served as attachments; CI: npm-audit gate with a dated
  allow-list, pip-audit, gitleaks over the full history, SBOMs, Dependabot,
  ZAP baseline on the branch preview; `docs/SECURITY.md`,
  `docs/PENTEST-BRIEF.md`. Enabling the hooks, CAPTCHA, MFA and the
  rate-limit/session settings are DASHBOARD steps (listed in the PR).
- [x] Design upgrade (Delcreda style) — brand tokens measured from the
  reference reports (navy #005288, process blue #0093D0, orange #F7941E,
  PT Sans Narrow display face), restyled primitives + StatCard / SectionTitle /
  RatingGauge / RatingLegend, grouped collapsible navy sidebar, Ctrl/⌘ K
  command palette, split login, dashboard hero; the **risk report rebuilt to
  the Delcreda layout** online and as an A4 PDF (running header, gauge +
  factor bullets, ten-band legend, key figures, COMBINED group statements,
  ratio tables with % change, commentary, glossary, group structure, page
  x of y). The NAME on every screen and report is the neutral "TCI ERP"
  from `src/lib/brand.ts`, never an insurer's or Delcreda's. Second pass:
  Claude-style hideable sidebar (docked / hidden / hover-peek / drawer — since Prompt 24 one fixed toggle that never moves and no animation, `e2e/shell/sidebar.spec.ts`;
  Ctrl/⌘ B), lazily loaded pages and en/uz strings, SVG flags, a work-first
  dashboard (KPI strip + own Agenda + non-zero signals), and the company
  card's **Overview tab is the online risk report** (same `RiskReportBody`
  as the PDF). See DESIGN.md and **Risk report rules** below
- [x] Security audit 2026-10 (migrations 0046–0048): an ENFORCED sign-in
  lockout on the Free plan (`tci.login_begin` ticket counted as a failure
  until `tci.custom_access_token_hook` refunds it; 3 free attempts per
  e-mail + IP, then 30 s doubling to 60 min; distributed-guess and
  credential-stuffing locks; a ticketless correct password hard-locks once
  `login_gate_enforced` is on), countdown + last-attempt warning +
  «Забыли пароль?» on the sign-in page, the «было N неудачных попыток»
  notice after sign-in; `anon` executes ONLY `tci.login_begin` (since 0064
  also `tci.login_interrupted` — the registry is `tci.pre_auth_entry_points`); direct REST
  writes around the workflow functions closed (guard triggers + revoked
  grants, 0047); a temporary password must actually change (0048); claim
  documents registered from what Storage holds; CSP host narrowed; the
  analytics service applies the database's rotation/MFA/lockout gates to
  provisioning callers, trusts only CF-Connecting-IP / the right-most XFF
  hop, and caps the compute endpoints. **Canonical: 0046–0048 fully applied**
  (2026-10-20): sections 1–4, 6 and most of 5 of 0046 through the MCP
  tooling, the remainder of 0046 plus 0047 and 0048 by the owner running
  `docs/deploy/canonical-apply-0046-0048.sql` (since removed — in git history) in the SQL Editor; verified
  afterwards (ledger, guard triggers, `anon` executes only `login_begin`,
  `login_gate_enforced` still off, data counts unchanged)
- [x] National statement forms + policy wording (migrations 0049–0051):
  manual entry follows the BUYER'S COUNTRY — `tci.country_reporting_frameworks`
  → `tci.reporting_frameworks` → statement templates (Russia, Belarus,
  Kazakhstan, Ukraine, Uzbekistan with official line codes; Germany/Austria
  HGB, France PCG, UK/Ireland, the rest of Europe on the Directive 2013/34/EU
  layout, US GAAP, China CAS, Japan, India Schedule III, Turkey TDHP, Brazil,
  Vietnam VAS; IFRS-reporting countries such as Kyrgyzstan, Mongolia and
  Nepal entered on the IFRS form under their own label). Each form carries
  its own arithmetic, IFRS cross-checks, deduction flags and the caption in
  its own language AS DATA; analysis and display stay IFRS everywhere.
  Sources and the authoring validator in `supabase/frameworks/`. Policy
  wording: the insurer uploads its own .docx contract templates
  ({{placeholders}}, per jurisdiction × language × product, versioned, one
  active per key), and a draft contract is generated from a policy or a
  submission (merge data from `tci.wording_merge_data`, rendered in the
  browser with docxtemplater, stored and registered with a server-made
  snapshot); «Шаблоны договоров» page, insurer particulars, standard
  ru/en/uz templates. See **Statement framework rules** and **Policy
  wording rules** below. **Canonical: applied 2026-10-20** — 0050 whole;
  0049 sections 1–5 and every 0051 framework document through
  `execute_sql` (the 645 KB seed one call per framework), each ledger entry
  carrying the closing sections and assertions as with 0043; all 32 forms,
  19 frameworks and 95 country links verified md5-identical to a local
  replay, UZ NAS line ids and entered values unchanged, live smoke with
  role impersonation rolled back
- [x] Role workspaces, contracts and portfolios (migration 0052): the
  sidebar is grouped into ROLE WORKSPACES (`workspaces.ts`: commercial
  underwriting, credit underwriting, sales, claims, administration) under a
  switcher at its top, with the shared tools (dashboard, agenda, companies)
  in every one; a person sees the workspaces of the roles they hold, an
  admin sees all. «Договоры» generates the draft contract of a policy or a
  live submission from the active wording template and keeps the register
  of generated contracts — since the follow-up it is, with «Шаблоны
  договоров», a VIEW of «Полисы» (`/policies?view=contracts|templates`;
  `/contracts` and `/wording` redirect); «Портфель полисов»
  (`/portfolio/policies`) and «Портфель лимитов» (`/portfolio/credit`) read
  `tci.v_policy_portfolio` / `tci.v_credit_portfolio`. See **Workspace and
  portfolio rules** below. **Canonical: 0052 applied 2026-10-20**, live
  smoke with role impersonation rolled back
- [x] Credit underwriting workbench (migration 0053): «Кредитные лимиты» is
  the credit desk's hub — «Обзор» (the limit portfolio), «Очередь решений»
  (with the band each open request would be decided in and «в пределах моих
  полномочий» per request), «Действующие лимиты» (register with filters),
  «Мониторинг» (reviews ≤ 30 days and overdue, rating worse than at the
  decision, open NOAs, groups over / near their cap), «Рейтинги» (the rating
  worklist), «Группы» (groups against their caps) and «Мои полномочия»; sales
  and commercial underwriting see the queue and the register only. «Портфель
  полисов» is likewise the «Обзор» view of «Полисы»; `/portfolio/credit` and
  `/portfolio/policies` redirect. Views `tci.v_limit_request_queue`,
  `tci.v_rating_worklist`, `tci.v_group_limit_status`. See **Credit workbench
  rules** below. **Canonical: 0053 applied 2026-10-20**, live smoke with role
  impersonation (two credit underwriters, admin, client) rolled back, counts
  unchanged, no new advisor finding
- [x] UX/UI audit 2026-10 (`docs/UX-AUDIT-2026-10.md`): 82 screens across
  six roles captured with scrollbars shown and reviewed; nothing moves
  between views or sections (`scrollbar-gutter: stable`, one content width);
  side-by-side panels line up (`PanelGrid`/`Panel`, CSS subgrid); object
  pages composed from `DetailHeader` / `KeyFigures` / `DescriptionList` /
  `Callout` (claim with all six tabs, declaration, overdue notification,
  policy header and «Премия»); one date format (`formatDate` / `formatMoment`
  / `formatDue` / `formatPeriod`) and `formatRate` (the premium rate was shown
  100× too high); the policy overview's 19 cards became a per-currency table;
  raw `agenda.taskTypes.*` keys fixed with a contract test against the
  migrations; `layoutContract.test.ts` refuses a padding-less Card, a Table
  inside a Card and a sliced ISO date. No migration. Backlog in the audit
  document. See DESIGN.md
- [x] Data management workspace (migration 0054): the information
  manager's desk «Управление данными» (`/data`: «Запросы», «Свежесть
  данных», «Предложенные байеры»). A company search that finds nothing —
  the registry list or the Ctrl/⌘ K palette — offers «Запросить
  организацию»; any staff member files `tci.request_entity` (fuzzy duplicate
  warning first; a registration number we hold answers `exists`, an open
  request for the same name answers `already_requested`). The request
  (`tci.entity_requests`, DR-YYYY-NNNN) is routed to the LEAST-LOADED active
  information manager and opens `entity_requested` in their Agenda; the
  company card offers «Запросить отчётность» (`statements_requested`). The
  information manager takes, hands over, resolves (created / linked /
  updated) or rejects with a reason, and the requester gets
  `entity_request_resolved`. Registry lookup — GLEIF and UK Companies House
  through `services/analytics` (`/registry/search`) — prefills the company
  form; it waits for the service to be hosted, and manual entry is the path
  today. See **Data management rules** below. **Canonical: 0054 applied
  2026-10-21**, live smoke with role impersonation (two information
  managers + a banned one, credit, commercial, admin, client) rolled back,
  counts unchanged, no new advisor finding
- [x] Agenda redesign (Prompt 22, migration 0055): «Моя повестка» is a
  queue you WORK, in two views — List (one row per piece of work: tasks on
  one object merge, premium instalments collapse into one row with a
  sub-table; grouped by due date / company / type; family chips with live
  counts kept in the URL; hover or keyboard reveals «Решить / Отложить / ⋯»)
  and Triage (queue left, the selected task right with its comments, a
  three-figure strip, facts and history — a PREVIEW whose primary button
  deep-links to the screen where the task is done, e.g.
  `/limits/:id?focus=decision`, `/entities/:id?tab=rating&statement=…`,
  `/policies/:id?tab=premium&instalments=…`, `/overdues/:id?action=open-claim`).
  Snooze (`snooze_task` / `unsnooze_task`, per task), append-only
  `tci.task_comments`, a new lazily generated `rating_new_statements`, a
  fifth event trigger that records who escalated and their band authority and
  opens a task for a group-limit breach (it opened none), and the security
  fix: `tci.tasks` lost the column UPDATE grant that let a REST PATCH close
  any automatic task. J/K/Enter/O/C/E/S/T keyboard. See **Agenda rules**
  below. **Canonical: 0055 applied 2026-10-21** in chunks (the owner runs
  `docs/deploy/canonical-apply-0055.sql`, since removed, for the one held DROP POLICY),
  function bodies md5-identical to a local replay, live smoke with role
  impersonation rolled back, counts unchanged
- [x] Premium payments, instant UI, layout stability (Prompt 23, migration
  0056): instalments are PAYMENT RECORDS — append-only `tci.premium_payments`
  (payments and reversals, never edited), allocated OLDEST FIRST and DERIVED in
  `tci.v_premium_instalments` (paid / outstanding / derived status, nothing
  stored), an invoice step (`invoice_premium_instalment`), overpayment
  REFUSED, a bank-statement import (per-bank profiles, matching on policy /
  invoice number + amount + date, one-click confirm, the
  `premium_payment_unmatched` Agenda type) and a service-role
  `record_premium_payment_import(jsonb)` for a future accounting feed; a
  payment closes the instalment tasks it settles. Schedule bug D fixed (an
  anniversary policy counted «1 year 1 day» and got 13 monthly / 5 quarterly
  instalments; the mock schedules regenerated, money preserved). Optimistic
  writes with rollback across the app and a dev-only mutation timing log; a
  Playwright LAYOUT GUARD (`e2e/layout/`) over every list screen in en/ru/uz
  at 1280 and 1440, in CI, with the network to Supabase SEALED. See **Premium
  payments rules**, **Tools never write to canonical** below and DESIGN.md
  «No layout shift on interaction». **Canonical: 0056 applied 2026-10-22**
  (dry run of the schedule regeneration first), live smoke with role
  impersonation rolled back
- [x] Contract drafts in the app (Prompt 25, migration 0057) — «Проект договора» is an editable document with immutable
  versions. Generation turns the active wording template (the TEMPLATE, not a
  rendered file) into the editor document — headings, numbered sections and
  clauses, tables, lists, page breaks — in which every placeholder is a
  merge-field chip (path, row, printed value); TipTap (open source, lazy chunk
  on the editor route only) edits it; every save is a new
  `tci.contract_versions` row (author, note, source generated / manual /
  restored / refreshed, server-made merge-data snapshot); compare any two
  versions inline or side by side; restore = a new version; a field refresh
  changes field values only (DB-checked); regeneration over manual edits needs
  confirmation (DB-checked); draft → under review (Agenda `contract_review` for
  commercial underwriting, a SIXTH event trigger) → agreed → signed with the
  scan in the private `contract-scans` bucket, then locked forever; DOCX export
  in the browser (`docx`, lazy) and PDF through the print route; the portal
  reads the SHARED version and comments while under review
  (`v_client_contract_*`, `client_comment_contract_draft`). See **Contract
  drafts rules** below. **Canonical: 0057 applied 2026-10-22** — sections 1–9
  through the MCP tooling (fingerprints identical to a local replay), section
  10 (the three removal guards) by the owner with
  `docs/deploy/canonical-apply-0057.sql` (since removed); acceptance smoke (generate → edit →
  compare → restore → review → share → agree → sign → locked) with role
  impersonation rolled back, nothing left behind
- [x] Commercial offers (КП) and the TCI brochure (Prompt 26, migration
  0058): a commercial offer is generated from a submission at commercial
  review / sales confirmation / client review, in its own language (ru / en /
  uz), as versions whose TEXTS staff write in the Prompt 25 editor and whose
  DATA the database composes (`tci.offer_merge_data`: client, proposed terms,
  premium estimate and instalments, buyer limits marked approved / indicative
  / declined, insurer particulars, contact — never a grade, an engine limit,
  an authority or a comment). Draft → published → viewed → accepted /
  changes requested / declined, withdrawn; EXPIRED derived from
  `valid_until`. Publishing hands the submission to the client
  (sales_confirmation → client_review); accepting in the portal IS the 3c
  acceptance (`client_accept_offer` → `client_respond_to_submission`), and an
  expired offer refuses acceptance from every path. A seventh trigger keeps
  the offer in step with its submission and tells sales when the client first
  opens it; `offer_expiring` / `offer_expired` are lazy. Print route (A4,
  page x of y, brochure from a new page) → the browser's PDF; portal
  «Предложения»; offers on the company card. The versioned product brochure
  (`tci.brochure_versions`, current = latest published) and a licensed media
  library (`tci.media_assets`, private `media-assets` bucket, alt in three
  languages, source and licence required) are managed by admin and sales.
  FIX riding along: since 0043 a client's own answer to a submission was
  refused with 42501 (`begin_internal_call` refused every non-staff caller);
  the answer step now marks itself trusted. See **Commercial offer rules**
  below. **Canonical: 0058 applied 2026-10-22** in sections (refresh_agenda
  rebuilt server-side from its 0056 body + one call), every 0058 function,
  view, column and grant fingerprint-identical to a local replay; live smoke
  with role impersonation (prospect: generate ru → edit → brochure → publish →
  view → changes → republish → expiry refused twice → accept) rolled back,
  counts unchanged, offer sequence reset
- [x] Limit validation (migration 0060): a decision beyond the author's
  authority — or, voluntarily with a comment, within it — goes to a NAMED,
  more senior colleague of the same department before it exists.
  `tci.limit_validations` holds one immutable step per hop (the proposed
  decision, proposer, validator, outcome); the validator approves, approves
  modified within THEIR authority (commercial: amount and payment terms only),
  returns with a comment, rejects (= their own decline) or forwards — a chain
  of any length, four eyes across the whole chain. `user_profiles.manager_id`
  (admin, «Руководитель») is offered first. The credit request is parked as
  `escalated`; a commercial increase HOLDS the credit decision; nothing is in
  force or visible to the client, and the sales window starts only from the
  validated decision. Agenda `limit_validation` (validator, urgent if
  required) and `limit_validation_result` (author, manual) through a ninth
  trigger. «Отправить на валидацию», «На валидации у …» and the chain history
  on the limit request page; RLS: a step is read only by the people of its
  chain (and admin). **Canonical: 0060 applied 2026-10-22** in five
  `execute_sql` parts, every function, grant, column, policy, enum and
  trigger fingerprint-identical to a local replay; the whole
  `tests/db/limit_validation.sql` run on canonical with role impersonation
  and rolled back, counts unchanged
- [x] Auto decisions — ADT (migration 0061, Euler Hermes / Allianz Trade
  practice): a credit underwriter sets, at a buyer's review and within their
  own authority for the buyer's rating band, the buyer's AUTO DECISION
  THRESHOLD — the largest single auto decision and how many
  (`tci.buyer_adt`, one live row per buyer, replaced never edited; the
  counter is the BUYER's, shared across policyholders, one charged per
  decision whatever the amount). A SUBMITTED limit request is decided
  automatically only when ALL hold: the global switch
  (`workflow_settings.auto_decisions_enabled`, **OFF**) is on, the ADT is
  active with decisions left, the policy is active, the amount ≤ the ADT
  amount and ≤ the recommended limit, and no stop factor (open NOA, claim,
  revoked limit, manual ban, stale/missing financials, group limit). The
  auto decision is approved for the requested amount on the policy's maximum
  payment terms, released AT ONCE (no commercial stage, no sales window),
  system-made (`limits.auto.adt`, «Авторешение (ADT)»); anything else goes
  to an underwriter with the reasons recorded (`tci.auto_decision_attempts`).
  Used up, a downgrade below the ADT's band, a stop factor or stale
  financials suspend it and open `adt_review` («Пересмотр байера / обновить
  ADT») through a tenth trigger. Buyer card ADT block, «Авторешения» view
  of the credit workbench, the switch on Admin › Полномочия; credit desk and
  admin only — sales, commercial underwriting and clients never see an ADT.
  **Canonical: 0061 applied 2026-10-22** in four `execute_sql` parts
  (`refresh_agenda` rebuilt server-side from its 0058 body plus one call,
  md5-checked), every 0061 function, grant, column, constraint, index,
  policy, view and trigger fingerprint-identical to a local replay; the
  whole `tests/db/auto_decisions.sql` run on canonical with role
  impersonation and rolled back, counts unchanged, switch still OFF
- [x] Sign-in notice fix + `client` held alone (migration 0062): the
  «failed sign-in attempts» banner showed «11 failed attempts» on every
  login because the access-token hook is not enabled on canonical, so no
  sign-in ticket ever became 'succeeded' — the owner's five successful
  sign-ins counted with six real wrong passwords, and the throttle counted
  them too. The app now records its own sign-in (`tci.record_sign_in`: the
  caller's fresh ticket, same network, issued before the token), «Это я» /
  × and a password change write a server-side watermark
  (`user_profiles.sign_in_ack_at`), the banner shows the time range and a
  list (time, /24 network, browser and system), and a trigger keeps
  `client` alone. **Canonical: 0062 applied 2026-10-22** — everything but
  the one role cleanup through `execute_sql` (fingerprint-identical to a
  local replay, the whole `tests/db/sign_in_notice.sql` run with role
  impersonation and rolled back, counts unchanged); the cleanup of the
  owner's `client` role and the ledger row by the owner with
  `docs/deploy/canonical-apply-0062.sql` (2026-10-23, since removed — in
  git history); verified afterwards: the owner holds no `client` role, no
  account mixes `client` with another role, the ledger row and the trigger
  are present
- [x] Commercial offer «как в ДМС» (Prompt 27, NO migration): the offer is a
  FIXED, approved document — the TCI brochure (9 A4 pages in the app's
  colours and faces, three covers white / navy / blue, a geometric mosaic
  drawn in SVG — since 2026-10-23 of trade motifs: container, parcel, truck,
  ship, aircraft, pallet, port crane, warehouse, globe, route, barcode,
  exchange, anchor — ru / en / uz) with the offer letter after its cover — and
  staff choose only parameters (cover, validity, brochure on/off, a ≤ 600-char
  note; the language when the offer is prepared). The text editor for offers,
  the in-app brochure editor and the media library are retired (`/brochure`
  redirects to `/requests`); 0058's versions, publishing, viewing, expiry and
  acceptance are untouched. One pure renderer (`src/features/offers/kp`) for
  the staff screen (form + live preview), the print route, «Скачать PDF», the
  company card and the portal; the document is shown only in the sandboxed
  `OfferFrame`. See **Commercial offer rules** below and DESIGN.md
- [x] Acting role, four eyes, admin without business rights (Prompt 29 PR 1,
  migration 0063): a multi-role person acts in ONE role at a time — the
  workspace's — stored per sign-in session (`tci.acting_roles`) and answered
  by `has_role` / `is_staff` / `current_user_roles`; the header shows the
  acting role, the «no access» page offers to open the section in another
  held role. Four eyes on limits: the requester never reviews, decides,
  proposes, validates or adjusts; the credit decider never adjusts
  commercially. Admin is technical: no decide / adjust / hold / release /
  revoke / validate / ADT / group limit and no authority. See **Acting role
  and four-eyes rules** below. **Canonical: 0063 applied 2026-10-23 AT
  MERGE** (with it live and the old frontend still deployed, a multi-role
  account acts in no role and every gate closes): the 21 objects it replaces
  were first verified fingerprint-identical to a local replay of 0062, the
  whole file then went in one atomic `execute_sql` call with its ledger row,
  PR #48 was merged right after, all 27 objects verified identical to a
  local replay, the whole `tests/db/acting_role.sql` run on canonical with
  role impersonation (forced rollback, nothing left behind), no new advisor
  finding
- [x] Sign-in interruptions (migration 0064): an attempt stopped before the
  password check — anti-bot check, rate limit, network — is reported by the
  sign-in page with the attempt's own ticket (`tci.login_interrupted`, the
  second pre-sign-in entry point) and listed APART in the after-sign-in
  notice, never as a wrong password; the throttle still counts it. See
  **Sign-in notice rules** below. **Canonical: 0064 applied 2026-10-23**
  BEFORE merge (backward-compatible: the old page ignores the ticket and
  the new count): the 7 objects it replaces verified identical to a local
  replay of 0063 first, the whole file in one atomic `execute_sql` call
  with its ledger row, all 10 objects fingerprint-identical afterwards, the
  whole `tests/db/sign_in_interruptions.sql` run on canonical with role
  impersonation (forced rollback, nothing left behind); the advisor's only
  new entry is `login_interrupted` executable by `anon`, which is intended
- [x] Admin is technical everywhere (migration 0065): every admin branch
  left in the business functions outside limits (claims, declarations,
  premium and bank import, submissions and bind, offers, contract drafts and
  generated documents, data requests, buyer proposals, relationships, limit
  withdrawal, other departments' tasks) and admin in every write policy on
  the business tables and the claim / contract storage buckets are gone;
  admin keeps users, authority, reference data, templates, settings and READ
  oversight. The screens stop offering admin those actions, and the Agenda
  lists only what the person may work. See **Acting role and four-eyes
  rules** below. **Canonical: 0065 applied 2026-10-23** BEFORE merge
  (backward-compatible: the old screens only see admin's business actions
  refused): the 44 functions and 39 policies it replaces verified identical
  to a local replay of 0064 first; `delete_claim_document` as written, the
  other 42 functions rebuilt server-side from their own bodies by the same
  textual change (a local run of that procedure is fingerprint-identical to
  a replay of the file), sections 2–4 with the closing assertions and the
  ledger row; all 44 functions and every tci policy fingerprint-identical
  afterwards; `tests/db/admin_technical.sql` run on canonical with role
  impersonation (forced rollback, nothing left behind, counts unchanged)
- [x] Information gathering before a limit decision (Prompt 29 §2,
  migrations 0066–0067): a submitted limit request whose buyer lacks a
  registration number, an address, an industry, or statements for a period
  ending within `workflow_settings.information_statement_max_age_months`
  (18) is routed to `information_gathering` with a
  `limit_information_needed` task for the information desk; saving the
  missing data releases it by itself (back to `submitted`, the ordinary
  decision task and auto decision follow), «Проверить снова» re-tests it, and
  credit underwriting may waive it with a reason (never on its own request).
  See **Information gathering rules** below. **Canonical: 0066–0067 applied
  2026-10-23** BEFORE merge: the 3 functions, 3 views and the index they
  replace verified identical to a local replay of 0065 first; 0066 as
  written, then 0067 in one call (the new objects as written, the 3
  functions and 3 views rebuilt server-side from their own bodies by the
  same change — a local run of that procedure is fingerprint-identical to a
  replay of the file); every tci function, policy and index identical to the
  local replay afterwards; the whole `tests/db/information_gathering.sql` run
  on canonical with role impersonation (forced rollback, nothing left
  behind, counts unchanged)
- [x] Credit analyst and credit analysis mode (Prompt 29 §2a, migrations
  0068–0069): the role `credit_analyst` («Кредитный аналитик», workspace
  «Кредитный анализ»); `workflow_settings.credit_analysis_mode` —
  `combined` (default: credit underwriting rates and decides, analysts rate
  too) or `separate` (only analysts rate and confirm, underwriting decides
  and never on a rating it calculated or confirmed); `tci.has_capability`
  ('rate' / 'confirm_rating' / 'decide') behind the rating policy and the
  UI; the engine's grade kept apart (`engine_grade`) from the grade in force
  (`rating_grade`), which a person confirms once — another grade needs a
  reason, never by whoever calculated it; rating tasks and the worklist
  reason `unconfirmed` follow the mode; the switch on Admin › Полномочия.
  See **Credit analysis rules** below. **Canonical: 0068–0069 applied
  2026-10-23** BEFORE merge (backward-compatible: in the default `combined`
  mode the old screens rate and decide as before): the 9 objects 0069
  replaces verified identical to a local replay of 0067 first; 0068 in one
  call, then 0069 whole in one call with its ledger row; every 0069
  function, policy, column, trigger, grant and the view
  fingerprint-identical to the local replay afterwards (the 25 existing
  assessments kept their grade as `engine_grade`); the whole
  `tests/db/credit_analysis.sql` run on canonical with role impersonation
  (forced rollback, nothing left behind, counts unchanged, mode still
  `combined`); no new advisor finding
- [x] Authority levels and the committee (Prompt 29 §4a, migrations
  0070–0071): `tci.authority_levels` (credit / commercial × ranks 1–5,
  rank 5 the committee with a chair), band authority as the LEVEL's grants
  (`authority_level_grants`), members (`authority_level_members`, one rank
  1–4 per stream plus a committee seat); `workflow_settings.authority_routing`
  `direct` (to the lowest covering rank, the skipped ranks told —
  `limit_validation_fyi`, a sixth manual Agenda type) or `sequential` (rank
  by rank; an approval beyond the approver's own authority goes on); any
  eligible member of the level answers; the committee votes (immutable
  `committee_votes`, conflicts declared and barred, quorum ≥ half, simple
  majority, the chair's casting vote, no majority ⇒ back to the author);
  the named validator of 0060 is retired. Admin › Полномочия «Уровни
  полномочий», the route on «Отправить на валидацию», the committee panel on
  the request page. See **Authority levels rules** below. **Canonical: 0070
  applied 2026-10-23 before merge; 0071 applied 2026-10-24 AT MERGE** (it
  retires the named validator the old frontend still sent): every tci
  function, policy and column first verified identical to a local replay of
  0069 and no validation step pending, the whole file then in one atomic
  `execute_sql` call with its ledger row, PR #54 merged right after; every
  function, policy, column, trigger and the queue view fingerprint-identical
  to a local replay of 0071 afterwards; the whole
  `tests/db/authority_levels.sql` run on canonical with role impersonation
  (forced rollback, nothing left behind); no new advisor finding. The levels
  are empty until the owner sets them up in Admin › Полномочия
- [x] Manual ratings, rating validation and analyst ADT (migrations
  0072–0073): a credit analyst (or whoever rates under the mode) proposes a
  MANUAL grade — statements optional, reason required — or a grade for the
  buyer's current unconfirmed engine rating, and sends it to a colleague who
  confirms ratings or ESCALATES it up the credit authority levels (rank by
  rank, the committee voting by 0071's rules); it comes into force only when
  a second person approves it (`tci.rating_proposals` /
  `rating_proposal_steps` / `rating_votes` / `rating_conflicts`, Agenda
  `rating_proposal` and the seventh manual type `rating_proposal_result`). A
  manual rating is an assessment with `source = 'manual'`, no score and no
  recommended limit, so no auto decision rests on it
  (`no_recommended_limit`). Credit analysts set, disable and block ADTs
  within their own authority grants and see «Авторешения». Rating tab
  «Предложения рейтинга», null-safe report and limit page. See **Rating
  proposal rules** below. **Canonical: 0072–0073 applied 2026-10-24** BEFORE
  merge (backward-compatible: the deployed screens never write a manual
  rating): the objects 0073 replaces verified identical to a local replay of
  0071 first, 0072 then 0073 whole in one atomic `execute_sql` call each with
  its ledger row; every tci function (per-function hash), policy, the new
  tables' columns, constraints, indexes, grants and triggers identical to a
  local replay afterwards; the whole `tests/db/rating_proposals.sql` run on
  canonical with role impersonation (forced rollback, nothing left behind,
  counts unchanged, mode still `combined`); no new advisor finding
- [x] Group rating (migration 0074): a grade for a whole corporate group,
  keyed by its ultimate parent and set (with a reason) by a credit analyst
  admin has marked senior (`user_profiles.senior_credit_analyst`, Admin ›
  Пользователи и роли), that CAPS every member — setting or lowering it
  writes a capped rating row for each member whose grade is better
  (`group_rating_id`, the engine's own grade kept), every later rating is
  capped as it is written, and a confirmation, proposal or approval above
  it is refused (`rating_above_group_cap`); raising or ending it raises
  nobody. «Рейтинг группы» on the «Группа» tab, «Ограничен рейтингом группы»
  on the rating tab. See **Group rating rules** below. **Canonical: 0074
  applied 2026-10-24** BEFORE merge (backward-compatible: nothing is capped
  until a group rating exists): the five objects it replaces verified
  identical to a local replay of 0073 first, the whole file in one atomic
  call with its ledger row; every 0074 function, policy, column, grant and
  trigger identical to a local replay afterwards; the whole
  `tests/db/group_ratings.sql` run on canonical with role impersonation
  (forced rollback, nothing left behind, counts unchanged); no new advisor
  finding
- [x] Client changes to limit requests + DL note (migration 0075): both
  limit request forms say, as the amount is typed, whether it is within the
  policy's discretionary limit (equal included, as 0026's split), above it
  and by how much, or that the policy has none (`limits/discretionary.ts`,
  no migration). In the portal the policyholder WITHDRAWS any open request
  or buyer proposal, AMENDS amount / payment terms / justification while
  underwriting has not taken it (`submitted`, `information_gathering`,
  `pending_entity` — the request is submitted again, so the band-aware
  task, the information routing and the auto decision run on the new
  amount), and after that REPLACES it (withdraw + a new request in one
  transaction, `replaces_request_id`). Every change is an immutable row of
  `tci.limit_request_amendments`, shown to staff as «Изменения
  страхователя» on the request page; a withdrawal (either path) now cancels
  a pending validation step and its tasks at once. See **Client limit
  request change rules** below. **Canonical: 0075 applied 2026-10-24**
  BEFORE merge (backward-compatible: the old portal only gains view
  columns): the view, constraints and functions it touches verified
  identical to a local replay of 0074 first, the whole file in one atomic
  `execute_sql` call with its ledger row; every 0075 object
  fingerprint-identical afterwards; the whole
  `tests/db/client_limit_changes.sql` run on canonical with role
  impersonation (forced rollback, nothing left behind, counts unchanged);
  no new advisor finding
- [x] Interface text size (migration 0076, owner request 2026-10-25):
  each person picks «Размер текста» — 100 / 125 / 150 / 175 / 200 % —
  on the account page (staff and portal) or in the staff user menu; it is
  kept in `tci.user_profiles.ui_scale` (NULL = the default, **150 %**) and
  cached per browser only for the first paint. The whole interface scales:
  every size is rem (no `text-[Npx]` left; `uiScale.test.ts` refuses new
  ones), the root font size is the chosen per cent, and the Tailwind
  breakpoints are CONTAINER queries in rem on `<body>` so they move with
  it — at 200 % a 1440 px screen gets the 720 px layout, as browser zoom
  would. Print routes (risk report, contract, offer) and `@media print`
  hold 100 %. See **Interface text size rules** below. **Canonical: 0076
  applied 2026-10-25** before merge (additive), fingerprints identical to
  a local replay, `tests/db/ui_scale.sql` run on canonical with role
  impersonation and rolled back, nothing left behind, no new advisor
  finding
- [x] Person-addressed department tasks follow the acting role (migration
  0077): a credit analyst holding credit underwriting too saw «Decide the
  credit limit…» tasks — addressed to them by name as a covering
  underwriter — and found no decision form behind them. Such tasks now name
  their department (`target_role` next to `target_user`, from
  `tci.task_work_role`; the 39 existing rows filled in-migration) and
  `task_is_mine` / "tasks: read mine" show them only in that role;
  `board.ts isMine` mirrors it (contract-tested). **Canonical: 0077 applied
  2026-10-26** before merge (backward-compatible), the three objects it
  replaces verified identical to a local replay of 0076 first, the whole
  file in one call with its ledger row, all four objects identical
  afterwards, `tests/db/person_task_role.sql` run on canonical with role
  impersonation (forced rollback, nothing left behind)
- [x] Rating approval is the rater's choice (migration 0078, owner
  2026-10-26): `tci.submit_rating(entity, grade, reason, route, colleague?,
  assessment?, statement?)` — `self` puts the grade in force at once (a
  self-approved proposal, recorded and shown in the history; reason and the
  group cap still apply), `colleague` sends it to a NAMED colleague (only
  they get the task and may answer) or, with none named, to any colleague,
  `level` escalates as before; `tci.rating_send_options` shows whom each
  route reaches (the colleagues; the next authority level and its members)
  before anything is sent. The rating dialogs pick the grade from the scale
  with a description of each grade (`GradePicker`, `rating.grades.*` en/ru/uz,
  the scale mirrored from credit_engine and contract-tested). Same batch, no
  migration: key-figure cells share the row equally and draw their own
  dividers (`KeyFigures`), side-by-side cards start on one line, the offer
  page says why «send to the client» is unavailable; guarded by
  `e2e/layout/switches.spec.ts` (view switches move nothing) and
  `cardTops.spec.ts`. **Canonical: 0078 applied 2026-10-26** before merge
  (backward-compatible: `propose_rating` unchanged), the six functions it
  replaces verified identical to a local replay of 0077 first, the whole
  file in one call with its ledger row, all eleven functions identical
  afterwards, `tests/db/rating_self_approval.sql` run on canonical with role
  impersonation (forced rollback, nothing left behind)
- [x] Rating scorecard (migration 0079, owner 2026-10-26, after Allianz
  Trade's practice): every grade a person sets — approved alone, sent to a
  colleague or escalated — is built from four PILLARS (general / equity and
  debt / profit and loss / payment behaviour), each with a sub-grade (or «not
  assessed»), a weight in per cent and a standard reason, plus an optional
  comment; the database computes the weighted grade (scale position, a half
  to the worse grade), the overall grade follows it or is adjusted with an
  overall reason of the matching direction, and the free-text justification
  stays required. `tci.submit_rating_scorecard` is the entry point; a
  proposal without a scorecard is refused. Default weights 25 / 30 / 25 / 20
  on Admin › Полномочия; the engine's factors prefill equity-and-debt and
  P&L when the scale is served. See **Rating scorecard rules** below.
  **Canonical: 0079 applied 2026-10-26 AT MERGE** (the deployed screens
  sent no scorecard): the functions it calls verified identical to a local
  replay of 0078 first, the whole file in one call with its ledger row, PR
  #69 merged right after; all ten 0079 functions fingerprint-identical to a
  local replay afterwards; `tests/db/rating_scorecard.sql` run on canonical
  with role impersonation (forced rollback, nothing left behind)
- [x] Redesign (Prompt 30, NO migration, three commits): **phase 1** —
  OKLCH colour ramps with equal WCAG luminance per step (`src/design/`,
  generated `tokens.css`, Tailwind's own palettes off), type / spacing /
  motion tokens, reduced motion, Admin › Tokens, `contrast.test.ts` and
  `scale.test.ts` as guards, `docs/colour-audit-2026-10.md`; **phase 2** —
  Table v2 (density per person, sticky head, frozen column, column chooser,
  hover actions, highlight, skeleton rows, bulk bar with CSV export, quick
  view in a `SidePanel`), `KpiCard`, `GradeBadge` in grade colours,
  `HumanAmount`, pictogram empty states, inline success, ⌘K over records
  and actions in the acting role's sections, forms (labels above, blur
  validation, outcome-named buttons, fixed dialog footer); **phase 3** —
  «bold fintech» (the owner's choice after phase 1 looked too quiet): a navy
  `HeroBand` with the brochure's trade mosaic and white KPI tiles on the
  dashboard, Agenda, company card, decision page and portal home, the
  compact band on registries and queues, a full-height brand sign-in, the
  report masthead, and the tone-of-voice guide. See DESIGN.md «Tokens»,
  «Components v2», «Signature screens», «Tone of voice» and
  `docs/redesign-progress.md` (decisions and how to reverse each); **phase 4** (owner: «free to change layout, forms,
  structure») — one decision column with authority / group meters and a
  requested → decided bar, ONE search (the top-bar field filters every list
  page by comma-separated terms in order, exact values exactly; page search
  boxes and filter pickers removed), company card sections + «Open work» +
  quick facts, Agenda grade badges and «All caught up», book by grade as
  exposure, portal status timelines, sticky financial sheets, Table v2 on
  every registry, a WCAG 2.5.8 target-size guard (`e2e/layout/targets.spec.ts`);
  migration 0080 hides a staff DRAFT limit request from the portal.
  **Canonical: 0080 applied 2026-10-27** before merge (owner's yes; the
  deployed portal only stops listing drafts): the view it replaces verified
  identical to a local replay of 0079 first, the whole file in one call with
  its ledger row, identical to a replay of 0080 afterwards;
  `tests/db/client_no_staff_drafts.sql` run on canonical with role
  impersonation (forced rollback, nothing left behind, counts unchanged);
  the real portal accounts checked read-only — no draft listed; no new
  advisor finding
- [x] Text size apart from zoom + owner review (migration 0081, 2026-10-27):
  «Размер текста» (100 / 110 / 125 / 140 / 150 %, NULL = 100 %,
  `tci.user_profiles.ui_text_scale`) multiplies only the type tokens and the
  boxes and columns that hold text; «Масштаб» (0076) still scales everything.
  Same batch, no migration: «Кредитные лимиты» and «Полисы» carry their
  book's figures on the navy band on every view; English «in force» →
  «Active»; the company card's sections stick with a slim name bar; the
  financial sheets' sticky head no longer lets the body show between its
  rows, and switching sheets keeps the table in place. See **Interface
  text size rules** below and DESIGN.md «Zoom and text size».
  **Canonical: 0081 applied 2026-10-27** before merge (owner's yes;
  additive): `user_profiles` verified identical to a local replay of 0080
  first (columns, column and table grants, constraints), the whole file in
  one call with its ledger row (its text md5-identical to the committed
  file), identical to a replay of 0081 afterwards;
  `tests/db/ui_text_scale.sql` run on canonical with role impersonation
  (forced rollback, nothing left behind, counts unchanged); no new advisor
  finding
- [x] Rows, sticky sheet controls, colour themes and dark mode (migration
  0082, owner 2026-10-27): a list row opens its own object and every link in
  it opens its own (`LinkRow`, `linkRow.ts`, every list whose rows have a
  page; `e2e/shell/linkRow.spec.ts`); the financial sheets' period /
  currency row sticks with the sheet tabs; each person picks a colour theme
  (blue — default, salad green, teal, plum, graphite) and light / dark /
  auto (`tci.user_profiles.ui_theme`, `ui_mode`, NULL = blue, light). See
  **Colour theme rules** below and DESIGN.md «Colour themes and dark mode».
  **Canonical: 0082 applied 2026-10-27** before merge (owner's yes;
  additive): `user_profiles` verified identical to a local replay of 0081
  first (columns, column and table grants, constraints), the whole file in
  one call with its ledger row (its text md5-identical to the committed
  file), identical to a replay of 0082 afterwards; `tests/db/ui_theme.sql`
  run on canonical with role impersonation (forced rollback, nothing left
  behind, counts unchanged); no new advisor finding
- [x] ADT capped at five auto decisions (migration 0083, owner 2026-10-27):
  «Количество авторешений» is a 1–5 list instead of a free number field;
  the table refuses more than five. **Canonical: 0083 applied 2026-10-27**
  before merge (owner's yes; additive — the one ADT there has five): the
  `buyer_adt` constraints verified identical to a local replay of 0082
  first, the file in one call with its ledger row (md5-identical to the
  committed file), identical to a replay of 0083 afterwards; smoke with a
  forced rollback (six refused, five accepted, sales still refused), counts
  unchanged, no new advisor finding
- [ ] Audit Phase B — operational floor: replay harness `tools/db/` + PG17 CI (`db.yml`), nightly age-encrypted backup workflow + `docs/BACKUP-RESTORE.md`, schema fingerprint for the ledger check, `Fineye*`/samples/screenshots moved to `legacy/` — DONE; waiting for the owner: the two backup secrets and the first restore drill; later: the canonical diff and the ledger rewrite
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
* ~~`buyer_resolution_status` beyond `ready` is not advanced
  automatically~~ — **RESOLVED in 0059**. `tci.buyer_progress_status` derives
  the status from facts (an effective credit-stage approved/partial decision
  in the submission ⇒ `limit_done`, any rating ⇒ `rating_done`), and an
  eighth trigger on `tci.workflow_events` (`rating.created`,
  `limit.credit_decided`, `request.buyer_resolved`, `request.buyer_added`)
  moves rows of LIVE submissions forward only. A declined limit stays at
  `rating_done`. Canonical: applied 2026-10-22 after a rolled-back dry run
  (8 of 11 rows moved forward, none back), fingerprints identical.

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

### Security closure rules (migration 0043 — audit Phase A)

**The grant is load-bearing, so the gate must be inside.** Internal helpers
(`open_task`, `emit_workflow_event`, `suspend_limit_for_*`, …) are granted to
`authenticated` because their `SECURITY INVOKER` callers execute as the
caller and need the grant. The audit found 44 such functions with no check
inside them, and verified from a client-only login that they filed an NOA
and revoked a limit on a stranger's policy. Every one now opens with a
`tci.require_*()` line, and the catalog is asserted at the end of 0043,
by `tests/db/definer_gates.sql`, and by `src/lib/securityContract.test.ts`.

**The internal-call token.** Trusted code marks the transaction, and the
token-gated helpers refuse without it:

```sql
perform tci.begin_internal_call();  -- from SECURITY INVOKER workflow functions
                                    -- (decide_limit_request …): refuses non-staff
perform tci.begin_trusted_call();   -- from SECURITY DEFINER code (client_* entry
                                    -- points, trigger functions): NO grant to
                                    -- authenticated, reachable only as the owner
```

The token is `md5(current xid || a salt)` where the salt lives in
`tci.internal_secrets`, a table no API role may read. A caller cannot forge
it, cannot call `set_config` through PostgREST, and a REST call is a
single-statement transaction anyway. Two entry points exist because inside a
`SECURITY DEFINER` function `current_user` is the owner, so "am I being
called from trusted code?" cannot be detected from within — the GRANT is the
proof. `require_staff_or_internal()` accepts either a staff caller or the
token; `require_internal_call()` accepts the token only (the five Agenda /
event / suspension primitives).

**Impersonated smokes must clear the token when they switch actor.** The
token is transaction-scoped. A smoke that inserts fixtures (whose triggers
run trusted code) and then impersonates a client in the SAME transaction
still carries the token, and every `staff_or_internal` gate will pass.
Production never shares a transaction between trusted code and an API
caller; the smoke has to model that:

```sql
perform set_config('role', 'authenticated', true);
perform set_config('tci.internal_call', '', true);   -- a new REST call has no token
```

**Revoking the PUBLIC default takes `authenticated` with it.** Most tci
functions never had an explicit grant: `authenticated` reached them only
through the PUBLIC default. `revoke ... from public` on such a function
therefore closes it to the API roles entirely, and three `security_invoker`
views (`v_claims`, `v_claim_position`, `v_policy_liability`) call
`claim_eligible_from`, `claim_covered_totals` and `policy_*_consumed` as the
querying user — every claims screen would have failed with "permission denied
for function". 0043 restates `grant execute … to authenticated, service_role`
before each revoke, and `definer_gates.sql` asserts that every function a
`security_invoker` view calls stays executable by `authenticated`. The rule:
the gate inside the function is the control; the grant is reach, and a
revoke is never a substitute for a gate.

**A gated STABLE function under `unnest()` in a smoke is evaluated twice.**
The planner pre-evaluates a STABLE function that feeds a set-returning
function for its row estimate, with the snapshot from BEFORE the statement's
CommandCounterIncrement. In a smoke that opened the claim in the previous
statement of the same transaction, that first evaluation cannot see the
claim, `may_access_claim` is false and the gate raises `42501` during
planning. Committed rows (every REST call) are never affected. In a fixture,
assign the result to a variable first (`v_docs := tci.missing_claim_documents(id)`)
and `unnest(v_docs)`.

**`must_change_password` is enforced in `has_role` and `is_staff`.** While
the flag is set both return false, so every staff policy, every
`v_client_*` view and every gate closes. The change-password screen works
because it reads `user_profiles` and `user_roles` through their
`user_id = auth.uid()` policies and calls `complete_password_change`, none of
which consult `has_role`. Verified through the REST path, not the UI gate.

**Advisor warnings that remain, and why.** The Supabase advisor flags every
`SECURITY DEFINER` function executable by `authenticated` regardless of the
gate inside it; that list cannot reach zero without breaking the invoker
callers. The property that IS zero is "ungated", and `definer_gates.sql`
measures exactly that. `anon` executes no **tci** definer function at all;
the one `anon_security_definer_function_executable` hit left is
`public.rls_auto_enable`, an event-trigger function the Supabase MCP tooling
installs (not ours, and an event trigger cannot be called through SQL).

**0043 sits in the migration ledger in one entry that carries only its
sections 5–6.** The 191 KB file exceeds what one `apply_migration` call can
carry, so sections 1–4 went to canonical as six `execute_sql` chunks, each
an implicit transaction, cut at function boundaries and replayed the same
way locally first; the ledger entry named `0043_security_closure` then
applied sections 5–6 and ran the closing assertions over the whole result.
The committed file is the authoritative text.

**MFA position (decision, September 2026).** Staff MFA is a follow-up, not
part of Phase A: Supabase MFA needs enrolment screens and a recovery path,
and the two staff accounts today are the owner's own. Leaked-password
protection is a dashboard setting (Authentication → Providers → Email →
"Prevent use of leaked passwords"); it cannot be set through a migration or
the MCP tooling, so the owner switches it on by hand.

### Authentication hardening rules (migration 0044 — audit Phase A2)

**The lockout's facts come from GoTrue, never from the browser.** Only the
`password_verification_attempt` hook (called by GoTrue as
`supabase_auth_admin`, gated on `session_user`) records a failed password.
A client-reported failure could lock any account by name, so the login page
reports nothing and `tci.auth_attempts` has no API grant at all. The hook
is a Teams-plan feature and a dashboard toggle (Authentication → Hooks);
until it is enabled the tables stay empty and the lockout is inert, which
the admin screen says in so many words.

**MFA is enforced where every policy looks.** `tci.mfa_satisfied()` sits
inside `has_role()` and `is_staff()` next to the rotation predicate:
`aal2` passes; a verified factor at `aal1` must step up; no factor passes
only while the policy does not require one for the caller's roles (admin
always; other staff from `workflow_settings.mfa_staff_enforced_from`;
client never). The UI gate `RequireMfa` only decides WHERE to send the
person (`/mfa/verify` or `/account`); the database is what refuses.
`tci.my_auth_status()` answers while the gates are closed, which is why it
is allow-listed.

**Hashed, never plain.** `tci.security_hash(x)` = sha256(internal salt ||
x) and is closed to every API role; attempts carry hashed user ids and
hashed IPs (`tci.request_ip_hash()` from `request.headers`). Lockouts and
events carry the user id because an admin must be able to find and unlock
a person. The sessions view shows a /24 (v4) or /48 (v6), not the address.

**A view's function calls run as the querying user.** Table reads in a
`SECURITY DEFINER` view run as the owner, but EXECUTE on a function it
calls is checked against the caller. `v_admin_user_security` therefore
calls the admin-gated `tci.admin_user_failures(uid)`, not `security_hash`
directly — a view that called a closed function would fail for everyone.

**Stub search_path.** The replay harness sets the database `search_path`
to `public, extensions` like Supabase does; pgcrypto lives in
`extensions`, and unqualified `gen_random_bytes()` in 0043 depends on it.

**Two password floors, on purpose.** A person chooses ≥ 12 characters
(`password.ts`, the Supabase minimum-length setting); a temporary password
is machine-made and ≥ 16 (`provisioning_rules.py`, `create-user.sql`).

**The CSP is verified, not assumed.** `public/_headers` ships
`script-src 'self' + Turnstile`; `style-src` needs `'unsafe-inline'`
(Recharts/React inline style ATTRIBUTES). When the analytics service is
hosted, its origin goes into `connect-src` or every rating call is blocked
— the headless check reports exactly those blocks today as "expected".

**Unlock refuses unless a lockout is ACTIVE (0045).** `tci.auth_lockouts`
keeps one row per user as history after it is cleared or expires, so a
lookup by user alone "unlocks" the same account any number of times, each
time writing a `lockout.cleared` event and forgiving the failures again.
`unlock_account` therefore matches `cleared_at is null and locked_until >
now()` and raises `P0002` otherwise. The canonical smoke caught it; the
local test had only tried a user who was never locked, and now tries the
same user twice.

### Sign-in gate rules (migrations 0046–0048, security audit 2026-10)

**The Free plan has no failure hook, so failures are counted up front.**
`tci.login_begin(email)` (with 0064's `login_interrupted`, the only functions `anon` may execute — `tci.pre_auth_entry_points`) refuses
while locked and otherwise inserts a `pending` ticket that COUNTS AS A
FAILURE. `tci.custom_access_token_hook` — GoTrue's own token issuance, on
the Free plan — marks the latest pending ticket `succeeded` and forgives
that e-mail + IP's other pending rows. A wrong password never reaches the
hook, so its ticket simply stays pending. The schedule
(`tci.login_lock_seconds`) is mirrored in `src/auth/loginGate.ts` and
locked by a contract test.

**Enforcement is a switch, flipped only after the new sign-in page is
live.** With `workflow_settings.login_gate_enforced = false` a ticketless
password sign-in is allowed and logged `sign_in.no_ticket`; with it on,
the account is hard-locked (`reason = 'bypass'`, 10 years) until an admin
unlocks it, which also forces `must_change_password`. Turning it on while
an old bundle is cached would lock out every user of that bundle.

**What the gate cannot see.** Within a ticket's 90 s a direct
`/auth/v1/token` guess is bounded only by GoTrue's per-IP limit and
CAPTCHA; that is why Turnstile and a low sign-in rate limit are dashboard
steps, not optional extras.

**Every new tci function revokes PUBLIC and anon explicitly.** Since 0046
`anon` holds USAGE on `tci`, so the PUBLIC default execute would reach it.
A per-schema default privilege cannot remove the global PUBLIC grant, so
the rule is written down instead and `tests/db/definer_gates.sql` (check 3,
over ALL tci functions) fails the first migration that forgets.

**Workflow-written tables refuse direct writes (0047).**
`tci.guard_workflow_write()` on `credit_limit_decisions`,
`decision_conditions`, `policy_status_history` and
`insurance_request_history` requires the internal-call token, so every
SECURITY INVOKER function that writes them calls
`tci.begin_internal_call()` first (asserted on the catalog in 0047).
`policies` may only be inserted as `draft` and its status changes only
through `change_policy_status`. Claims money, group limits, relationships,
events and settings lost INSERT/UPDATE/DELETE for `authenticated`
altogether — their writers are all SECURITY DEFINER.

**Rotation is verified, not declared (0048).** A BEFORE trigger stores
`security_hash(auth.users.encrypted_password)` whenever
`must_change_password` is written true (both reset paths re-write it
AFTER the new password), and `complete_password_change` raises
`password_unchanged` (P0001) while the password still hashes to it. The
column is closed to every API role — a column revoke means nothing next
to a table-level SELECT, so 0048 replaces that grant with column grants.

**Storage bytes are removed through the Storage API, never SQL.**
Supabase's `storage.protect_delete` refuses DELETE on `storage.objects`,
and a row deleted there would orphan the bytes anyway.
`delete_claim_document` returns the path and the client removes the
object; the uploader may remove their own UNREGISTERED object
(`tci.may_remove_claim_object`).

**The MCP tooling cannot apply a statement containing DELETE/DROP here.**
It holds such a query for an approval prompt this environment never shows
and times out after 60 s — even when the words are only inside a function
body (a quoted string literal is fine). Split a migration at section
boundaries, apply the clean sections with `execute_sql`, and hand the rest
to the owner as one transactional SQL Editor script that ends with the
closing assertions and the ledger insert
(the template is `docs/deploy/canonical-apply-0057.sql` in git history,
commit 05d4381; owner scripts are deleted once run and verified). Do not
disguise the keywords to get past the check.

*Update 2026-10-20:* the hold has moved. `alter … drop not null` and a
JSON note containing «deleted» now pass, while an `UPDATE` with **no
`WHERE` clause** is held (timed out; with `where id` the same statement
runs). Write every UPDATE in a canonical script or smoke with an explicit
`WHERE` — `tests/db/wording.sql` does — and when a call times out, first
check that nothing reached the database (it never does), then find the
statement the check objects to; still never disguise it.

### Sign-in notice rules (migration 0062)

**A success must be recorded, or every success is a failure.** `login_begin`
writes a ticket that counts as a failure until something marks it
'succeeded'. That is the access-token hook's job, and the hook is a
dashboard toggle; where it is off, nothing did, so the notice and the
throttle both counted the owner's own sign-ins. The notice now calls
`tci.record_sign_in()` FIRST (idempotent, and a no-op on a restored session):
it marks the caller's latest pending ticket from the same network, within
its 90 seconds and written before the token was issued. With the hook on,
the hook gets there first and the call finds nothing to do.

**What counts** (`tci.my_counted_failures`, internal): pending and forgiven
tickets of the caller's e-mail after BOTH the previous successful sign-in
and `user_profiles.sign_in_ack_at`, and before this sign-in. The watermark is
written only by `acknowledge_sign_in_failures` («Это я» and ×) and
`complete_password_change`; no API role may update the column, and the
browser stores nothing.

**Where an attempt came from, but never the address.** `login_attempts`
keeps `ip_masked` (/24 for IPv4, /48 for IPv6) and the user agent (≤ 200
characters) next to the salted hashes; `my_failed_sign_ins` lists at most 50.

**The probe never shows here.** `docs/security/auth-probe.sh` calls
`/auth/v1/token` directly and never `login_begin`, so it leaves no ticket:
a wrong password counted by the notice always came through the sign-in page.

**A tab opened before a deploy runs the old code** — a single-page app never
reloads by itself — and on 2026-10-23 two correct sign-ins from such a tab
were left `pending` because the old code never called `record_sign_in`. The
build stamps its id (Cloudflare's `CF_PAGES_COMMIT_SHA`, else git) into the
bundle and into `/version.json` (`vite.config.ts`, never cached:
`public/_headers`); `src/lib/appVersion.ts` compares. A stale staff or
portal tab gets the corner notice «Доступна новая версия TCI ERP» with a
reload button (never an automatic reload — the page may hold unsaved
input); the sign-in page reloads itself while its form is untouched; a page
chunk that fails to load reloads once into the new build. An unknown answer
(dev server, network down, an old deploy without the file) is never
"stale". The real closure is the access-token hook, which marks a success
on the server whatever code the tab runs.

**What the server cannot see, and what the page says instead (0064).**
Without the Teams-plan verification hook the server cannot tell why GoTrue
refused, so the sign-in page REPORTS an attempt that never reached the
password check — a captcha refusal, a rate-limit refusal, no answer at all
(`signInErrors.ts` kind `network`) — with that attempt's ticket:
`tci.login_begin` hands out a 64-character token (stored only as a salted
hash), and `tci.login_interrupted(ticket, reason)` labels THAT attempt, only
while it is pending and inside its 90 seconds, only once, and answers the
same whatever happened. The notice then counts wrong passwords
(`my_counted_failures`, now unlabelled attempts only) and interruptions
(`my_interrupted_sign_ins`, `interrupted_since_previous_sign_in`) APART —
a labelled attempt is never hidden, only named. **The throttle ignores the
label** (`login_locked_until` is untouched, asserted in 0064): the label is
the browser's word, and trusting it would let anyone reset their guessing
allowance by reporting "network error". A wrong password is never reported
(`interruptionReason` returns null for it).

### Statement framework rules (migrations 0049, 0051)

**The country chooses the form, the statement keeps it.** A new statement
opens on the form of the buyer's country (`country_reporting_frameworks`);
a statement already saved keeps the forms it was ENTERED on
(`financial_statements.template_id` → its framework), whatever the country
points at later. A country with no row, or a framework of kind `ifrs`, is
entered on the IFRS form, with the national standard named above it.

**A form is data, never code.** The subtotal arithmetic
(`statement_template_lines.formula`), the cross-checks against the computed
IFRS totals (`crosscheck_column`), the deduction flag (`is_deduction`: typed
positive, subtracted) and the original caption (`name_local`) all live on
the template line. `mapping.ts` takes them as `TemplateRules`; there are no
per-country constants left in TypeScript, and none may be added.

**Every seeded form must reconcile.** `frameworkSeeds.test.ts` (and
`supabase/frameworks/validate.py`, which the authors ran) fills the leaf
lines with arbitrary amounts, lets the form compute its own totals, maps to
IFRS, and requires every cross-checked total to agree. That is what finds
double counting, a missing mapping or a wrong sign; it found one in the
original UZ NAS data (line 770 vs IFRS total liabilities, which line 470's
reclassification makes differ by design — the check was a false warning
and is gone). A total that genuinely cannot reconcile is left UNCHECKED
with a note saying why, never checked against something it does not equal.

**The loader never removes or re-keys a line.** `tci.seed_statement_framework`
upserts by (template, line code): values already entered keep their line
ids. Fix a form by editing its JSON in `supabase/frameworks/`, validating,
and loading it again in a new migration (`build_migration.py`); the sync
test fails if the JSON and the migrations disagree.

**Judgement calls recorded on the lines, to review as one rule later.**
Share premium sits in share capital in UZ NAS and in other reserves in most
European forms; reserves built from appropriated profit (Turkey 54, Brazil
reservas de lucros, Vietnam 418–420) map to retained earnings. Total equity
is the same either way; ratios that use retained earnings (Altman X2) are
not. Unsplit receivables / payables lines map wholly to trade. By-nature
P&Ls (HGB, Directive, France) put material costs in cost of sales, so their
"gross profit" means revenue less materials.

### Policy wording rules (migration 0050)

**The database says WHAT, the template says HOW, the browser only renders.**
`tci.wording_merge_data(policy | submission)` is the single source of a
contract's data (SECURITY INVOKER: a caller sees only what RLS shows them;
raw numbers, ISO dates, enum codes). `src/features/wording/context.ts`
formats it in the TEMPLATE's language (format.ts, never the UI language),
and docxtemplater fills the .docx. There is no server to render on, and no
business logic in the rendering.

**What a document said is recorded by the server.** `register_policy_document`
re-derives the merge data itself and stores it as the document's
`merge_data`; the browser's copy is never trusted. Documents and templates
are immutable: no table write grant, no storage UPDATE or remove policy; a
template is replaced by uploading a new version and retired, never edited.

**One active template per (country, language, product).** NULL means "any"
and is compared NOT DISTINCT. Activation refuses a template whose recorded
placeholders are not all in `tci.wording_placeholder_catalogue()`, which
`catalogue.ts` mirrors (contract-tested). Placeholders are `{{dotted.path}}`,
`{{#limits}}…{{/limits}}` repeats per credit limit (around a table row it
yields a row per buyer), and any other `{{#x}}…{{/x}}` is a condition.

**A literal `{{…}}` in a translation is eaten by i18next.** Every sentence
that shows template syntax takes it as a value (`WORDING_SYNTAX`), never as
literal text in the locale file.

**InspectModule pulls lodash.** Template inspection uses
`Docxtemplater#getTags()` (present at runtime, missing from the typings)
instead; docxtemplater lives in its own lazy chunk.

### Workspace and portfolio rules (migration 0052)

**A workspace groups, it never grants.** `navigation.ts` (`NAV_ITEMS` +
`canAccessPath`) is still the only map of what a role may open, and the
database is still what refuses. `workspaces.ts` only decides where a screen
sits in the sidebar; `workspaces.test.ts` asserts every screen belongs to
the shared set or to a workspace, and that every screen a role may open is
reachable from that role's own workspaces. Since 0063 a workspace IS a
role: switching it switches the acting role (`set_acting_role`), and
opening a screen the acting role does not cover shows «no access» with an
offer to open it in another role the person holds (`rolesOpening`) — it
never switches by itself. The choice is remembered per browser
(`tci-erp-workspace`) and only seeds the acting role of a new sign-in.
Admin's workspace is admin's own (users, authorities, settings, plus
read-only oversight screens), no longer every workspace. Since 0054 the information manager has a workspace
of their own, «Управление данными» (`/data`); a client has none.

**The definitions live in the views.** premium base = greatest(earned,
minimum premium); incurred = indemnity paid + approved-but-unpaid − the
insurer's recoveries; loss ratio = incurred ÷ premium base; in force =
effective approved/partial decision on a bound policy; amount in UZS =
amount × `latest_uzs_rate`, NULL (and COUNTED) when there is no rate.
`portfolio/aggregate.ts` only adds rows up — per currency, never across
currencies — and its contract test reads those definitions from the
migration text.

**Contracts and templates are views of «Полисы», not sections.** One
sidebar item, three tabs synced to `?view=` (`policies/views.ts`:
registry | contracts | templates, unknown → registry). The old paths
`/contracts` and `/wording` redirect there (`LEGACY_POLICY_VIEW_PATHS`), so
a bookmark or a link inside a locale string still lands. Route access is
`/policies`'s.

**The contracts page offers live work only.** Every policy, and every
submission except draft / declined / withdrawn (`wording/contracts.ts`).
Generation needs an ACTIVE template; with none, the page says so and offers
the standard templates to whoever may manage them.

### Data management rules (migration 0054)

**A search that finds nothing becomes work in a named person's Agenda.**
`tci.request_entity` is open to every staff role and refuses clients
(`42501`); a client's own path stays `client_request_limit` → proposal.
Before anything is filed the modal shows `similar_entities` for what was
typed, and the function itself answers `exists` for a registration number we
hold and `already_requested` for an open request with the same (country,
name) — one open request per company, enforced by a partial unique index.

**Distribution is least-loaded, decided in SQL.** `tci.pick_information_manager`
(closed to every API role; it reads other people's `user_roles` and
`auth.users`) orders active information managers — role held, not banned,
not deleted — by open requests, then by the oldest last assignment, then by
id, so the choice is stable. Nobody active ⇒ the task goes to the ROLE and
whoever takes it becomes its holder; it is never lost.

**The request row is current state; history is the event stream.**
`data.entity_requested`, `data.entity_request_assigned` and
`data.entity_request_resolved` drive a FOURTH trigger on
`tci.workflow_events` (`tci.handle_data_event`): a reassignment CANCELS the
previous holder's task and opens one for the new holder; a resolution closes
it as done and tells the requester (`entity_request_resolved`, the fourth
manual type — skipped when the requester resolved it themselves). Its title
key carries the outcome (`agenda.tasks.entity_request_resolved_<status>`);
`taskKeys.test.ts` expands it to the four outcomes.

**Outcomes are typed.** A company request ends `created` or `linked` (both
NAME the company) or `rejected` (a reason the requester will read); a
statements request ends `updated` or `rejected`. The screen saves the company
through the ordinary `EntityFormModal` and only then resolves — the request
never writes `legal_entities` itself, so dedup-on-entry still applies.

**Registry connectors are prefill, never truth.** `/registry/search`
normalises GLEIF and Companies House records into one shape; «Взять эту
запись» opens the company form pre-filled for a human to check and save.
Companies House needs `COMPANIES_HOUSE_API_KEY` (service env only, 503
without it); upstream failures are opaque 502s. While the service is
unhosted the panel says so and manual entry is the path.

**Freshness is a view, not a job.** `tci.v_data_freshness`
(security_invoker) lists companies with LIVE business — an open limit
request, an in-force limit, a buyer in a live submission, an active or
suspended policy — whose first problem is `no_statements`,
`stale_statements` (latest period ends more than 15 months ago) or
`missing_registry` (registration number, address or industry). No cron, no
tasks generated from it: it is the information manager's worklist.

### Agenda rules (migration 0055)

**The Agenda never performs a task.** Its primary button goes to the screen
where the task is done (`destinations.ts`, a Record over every task type,
contract-tested), with the context in the URL; the destination screens
honour it and render exactly as before without it (`src/lib/useDeepLinkFocus.ts`
scrolls and rings the target). Triage shows, never edits.

**One row per piece of work** (`board.ts`, tested): merge first — the same
type on one object (per-person copies), and MERGE_SETS (an overdue notice
seen by claims and by the policyholder; a request and its escalation; the
three rating tasks), first type leads — then group, then collapse inside the
group (premium instalments, across policies; the sub-table names the
policy). Undated urgent/high work sits in «Сегодня», undated normal in «На
этой неделе»; nothing undated hides in «Позже».

**Snooze is per task and decided on read.** `snoozed_until` is never cleared
by a job: `activeTasks()` (catalogue.ts) drops a task while the moment is in
the future, and every list, chip, count, the sidebar badge and the dashboard
read through it. A department task snoozed by one person is snoozed for the
department (`snoozed_by` says who).

**Comments are shown where they live.** `ORIGIN_SOURCES` (notes.ts) maps each
task type to the human text on its source object (a limit request's
justification — the policyholder's when it came from the portal — a hold
comment, a decline reason, a data request's note); `tci.task_comments` holds
only what people add on the task, append-only. The system note of an
automatic task (no source event, ⚡) is an i18n key over params, rendered by
`renderNote` — never stored text.

**Every write on a task is a function.** `complete_task`, `snooze_task`,
`unsnooze_task`, `add_task_comment` are SECURITY DEFINER with
`require_staff()` and the `task_is_mine` predicate (the tasks read policies);
`authenticated` holds no write grant on `tci.tasks` or `tci.task_comments`.
`direct_writes.sql` and `agenda.sql` prove it.

**Amber is not a text colour.** `--color-warn-500` is about 3.4:1 on white;
the «Сегодня» label, the due label and the «Эскалация» tag carry amber as a
stripe, a dot, a fill or a ring, with dark text.

### Premium payments rules (migration 0056)

**Money is a list of payments; everything else is derived.** An instalment
stores only its BILLING state (`pending` / `invoiced` / `cancelled`; a check
forbids `paid`). `tci.v_premium_instalments` lets the policy's net payments
(payments − reversals) fill the instalments OLDEST FIRST — by `due_date`, then
`sequence`; a cancelled instalment takes nothing — and derives `paid_amount`,
`outstanding` and the status, in this precedence: cancelled > paid > overdue
(outstanding and past due) > partially_paid > invoiced > pending. `premium.ts`
mirrors the allocation cent-exact and the precedence order, contract-tested
against the migration text, so a payment paints before the server answers.

**Corrections are reversals, never edits.** `tci.premium_payments` has no
UPDATE or DELETE for any API role; `reverse_premium_payment` writes a
`reversal` row pointing at the payment (`reverses_id` is unique: a payment is
reversed once, a reversal never). **An overpayment is refused**
(`payment_exceeds_outstanding`, P0001): money beyond what the schedule owes is
not premium, and a credit balance has no home until accounting exists.

**Every write answers with the schedule.** `record_premium_payment`,
`reverse_premium_payment` and `invoice_premium_instalment` return `setof
v_premium_instalments` for the policy, so the screen takes the answer instead
of refetching. A payment that settles an instalment closes its
`instalment_due` / `instalment_overdue` tasks; a reversal reopens them through
`refresh_agenda`, which reads the view.

**The bank import matches, a person confirms.** Lines are matched on a policy
or invoice number found in the payment text (`payment_text_key`), the amount
and the date; a matched line still needs one click (`confirm_bank_lines`), an
unmatched one is assigned or ignored by hand, and while any line is unmatched
the import carries one `premium_payment_unmatched` task.
`record_premium_payment_import(jsonb)` is `require_service_role()` only — the
door for a future accounting feed; no connector exists.

**The instalment count steps from inception** (bug D). 0027 measured
`age(expiry + 1, inception)`, so an anniversary policy read as one year and
one day and got 13 monthly / 5 quarterly instalments, the last two clamped
onto the expiry date. Periods now start at inception + k months and count
while the start is before the last day of cover; 0056 asserts the invariants
on every schedule (the count, sum = minimum premium, no two instalments on
one date) and the anniversary cases on fixtures.

### Tools never write to canonical (incident 2026-10-22)

A latency harness measured clicks against the canonical project with
Playwright route stubs, and `unrouteAll()` released stubbed writes that were
still inside their injected delay: a premium payment, three snoozes, eight
escalating decisions and a declaration acceptance reached the owner's data
and were undone by hand. The rules since:

* **E2E, layout and latency runs never touch `*.supabase.co`.**
  `e2e/support/network.ts` `sealNetwork(context)` aborts every request no stub
  answers — never `continue()`, never `fetch()` — and fails the test on any
  response from a real host. Slow networks are SIMULATED with an injected
  delay.
* **The only reader of canonical is `tools/layout-fixtures/record.mjs`**, run
  by hand: GET/HEAD and STABLE functions only, writes answered locally,
  output sanitised (`@demo.invalid` e-mails, no names or phones).
* **A canonical smoke is one transaction ending in a forced rollback**, as
  before. Anything else that writes is a bug.

### Commercial offer rules (migration 0058)

**The browser writes parameters; the database writes facts.** Since Prompt
27 («как в ДМС») a version's `texts` hold only the document's PARAMETERS —
`{ kind: 'kp', template: 'tci', template_version, cover, note }`
(`src/features/offers/kp/params.ts`; 0058 checks only that it is an object of
at most 256 KB) — and the words are the fixed, approved template's; a version
of the retired editor renders with the default parameters. Its `data` is
composed by `tci.offer_merge_data`
on EVERY save, so terms, premium and limits always print what the submission
says now. A buyer limit is `approved` only for an effective approved/partial
decision that is not held, `declined` for a declined/revoked one, and
`indicative` (the requested amount) otherwise. `offer_merge_data` is granted
to no API role, and 0058 plus `tests/db/commercial_offers.sql` assert that
the client view carries no internal column and the data no internal field.
The offer's LANGUAGE is set when it is prepared (`create_commercial_offer`);
`save_offer_version` takes none, so the screen shows it fixed.

**One renderer, one sandboxed frame.** `renderOffer(params, data, ctx)` is
pure and THE page order (cover, letter pages, brochure pages 2…9); every
dynamic value is escaped where it enters the markup, and the HTML reaches
the screen only inside `OfferFrame` (`sandbox="allow-same-origin
allow-modals"`, no scripts) — ESLint refuses `srcDoc` and
`dangerouslySetInnerHTML` anywhere else. The PDF is the frame's own print.

**One source of truth for acceptance.** The offer FOLLOWS its submission:
`client_accept_offer` and `client_request_offer_changes` call
`client_respond_to_submission`, and the seventh trigger
(`handle_offer_event`) settles the live offer from `request.status_changed`
whichever screen answered. «Request changes» reuses the existing reopen of
`submission_sales_confirmation` with the client's comment — no second sales
task. Publishing is sales' step (sales_confirmation → client_review);
withdrawing a published offer hands the submission back with the reason.

**Expiry is derived and binding.** `tci.offer_effective_status` reads
`expired` for a published/viewed offer past `valid_until` (the day in
Tashkent, `tci.offer_today`); nothing is rewritten when the date passes.
`client_respond_to_submission` itself refuses to accept a submission whose
offer has expired, so the older «Мои заявки» page is not a way around it.
Asking for changes stays possible after expiry ("renew it").

**Versions are immutable.** An offer version is never updated (trigger,
owner included). `tci.brochure_versions` and `tci.media_assets` (0058) stay
in the database but no screen writes or reads them since Prompt 27: the
brochure is the fixed template, and a version's `brochure_version_id` is
simply null.

**The client answer path is trusted code.** `advance_insurance_request`
opens with `begin_internal_call()`, which refuses non-staff. A client
reaches it only through `client_respond_to_submission`, which now calls
`begin_trusted_call()` first, and `begin_internal_call()` accepts a
transaction that already carries the token. A client calling it directly is
still refused (asserted). This was broken from 0043 to 0058: no DB test had
exercised the client's own answer.

**The brochure's words are the approved ones, pinned.** The template
(`kp/templates/tciTexts.ts`) quotes `src/features/brochure/defaultContent.ts`
verbatim — `tciTexts.test.ts` proves it statement by statement — and the
SHA-256 of the words and of the rendered brochure pages is pinned in
`kp/templates/tci.test.ts`: a change is deliberate (bump
`TCI_BROCHURE_VERSION`, update the hash, say why). Statistics, partner names,
ratings, awards and contacts are never invented; the insurer's particulars
come from the offer's data. The two ⚠ statements of `docs/BROCHURE-CLAIMS.md`
(collection support, disputed debts) are `pending` in `BROCHURE_CLAIMS` and
NOT printed until the owner confirms them.

### Contract drafts rules (migration 0057)

**The template is converted, not the rendered file.** `contracts/fromDocx.ts`
reads the wording template's own .docx parts with its `{{placeholders}}`,
evaluates the sections against the printable context of `wording/context.ts`
(a list repeats — in a paragraph, over paragraphs, over table rows; a value
shows or hides; a paragraph emptied by a hidden section disappears) and emits
the editor document, in which each placeholder is a `mergeField` chip carrying
its catalogue path, its row index inside `limits`, and the value it printed.
The mapping table is the file header; what is not carried (images, text
boxes, headers/footers, run fonts and spacing, multi-level lists, column
widths) comes back as conversion warnings shown on the viewer once.

**Numbers are derived, never text.** A numbered section heading carries
`numbered: true`, a clause paragraph `clause: true`; `numbering.ts` is the
one rule (N. / N.M., a clause before any section is M.) used by the viewer,
the editor (ProseMirror decorations), the print route, the comparison and
the DOCX export. The template's typed «2.1.» is stripped at conversion, so a
hidden conditional clause closes its gap.

**Versions are never changed.** No INSERT/UPDATE grant for `authenticated`
on the four tables, SELECT + INSERT only for `service_role`, a BEFORE UPDATE
trigger for everyone, and (section 10, an owner step) a BEFORE DELETE
trigger. Every write is a gated SECURITY DEFINER function;
`save_contract_version` takes the BASE version number and refuses a save on
top of a newer one (`contract_version_conflict`), refuses an identical
document (`contract_version_unchanged`), refuses `generated` over manual
edits without `p_confirm_replace` (`contract_has_manual_edits`, mirrored by
`machine.ts hasManualEdits`), and refuses a `refreshed` version whose
`tci.contract_skeleton` (the document with every merge-field VALUE removed)
differs from its base — a field refresh cannot touch the words. A restore is
copied server-side from the old version, never taken from the browser.

**The machine** (`contract_transition_allowed`, mirrored and contract-tested
in `machine.ts`): draft → under_review → agreed → signed; under_review and
agreed go back to draft, agreed only with a reason and only by commercial
underwriting or admin, who alone agree; writers are admin, commercial
underwriting and sales; editing in draft and under_review only; signed is
reached only by `sign_contract_draft` with the signer's own PDF at
`contract-scans/<draft>/<file>.pdf`, and a trigger keeps a signed row final.
A change to a signed contract will be an endorsement (not built).

**The client sees what was shared, never more.** `share_contract_draft` pins
the CURRENT version; a later save does not move what the client sees. The
portal reads `v_client_contract_drafts` (definer view over base tables,
`has_role('client')` + `my_client_entities()`, status under review / agreed
/ signed) and its own side of the comments; staff comments, authors and the
merge-data snapshot never reach it. The client comments only while the draft
is under review, and the comment rides on the open review task as
`client_comment` (shown by the Agenda as the policyholder's origin comment).

**Nothing leaves our infrastructure.** No viewer or editor service: the
editor is TipTap in a lazy chunk; .docx is built in the browser with `docx`
(lazy); PDF is the print route (`/policies/contracts/:id/print`, @page from
the template's page size and margins, «page x of y» in the document's
language) and the browser's own «Save as PDF».

**The local working copy is not a version.** The editor writes
`tci-contract-wc:<draft>:<user>` to localStorage on change (guarded; the page
works without it), offers it back on return, and asks before leaving with
unsaved changes (beforeunload + in-app link capture — the BrowserRouter has
no blocker). Only «Сохранить версию» (⌘S, with an optional change note)
makes a version.

### Limit validation rules (migration 0060)

**Beyond authority records nothing.** `decide_limit_request` and
`adjust_limit_commercial` answer `{result: 'needs_validation'}` above the
caller's band authority instead of escalating to an anonymous pool. The
proposal is stored only by `submit_limit_for_validation` /
`submit_adjustment_for_validation`, with a named validator; the decision row
is written later, BY THE VALIDATOR, through the same decide / adjust
functions (the GUC `tci.resolving_validation` marks that call), so every
guard — group limit, supersede, sales window — still applies, and
`credit_limit_decisions.validation_id` links the result to its step.

**Who may validate** (`tci.check_validator`, offered by
`tci.validation_candidates`): the same department (`credit_underwriter` for
credit, `commercial_underwriter` for commercial) or admin; band authority in
UZS covering the amount (`tci.user_authority_uzs`, admin = Infinity); never
anyone who proposed or validated an earlier step of the same chain. Nobody
qualifies ⇒ the screen says so by name; the database refuses
`validator_lacks_authority` / `validator_wrong_department` /
`validator_four_eyes`. A voluntary validation (within authority) needs a
comment (`validation_comment_required`).

**One pending step per request.** While a step is pending nobody but its
validator decides or adjusts that request (`limit_validation_pending`,
checked through the token-gated DEFINER `pending_validation_of`, because an
invoker query under RLS would not see someone else's chain). Reject is the
validator's own decline; return reopens the request (`under_review`) for the
author; forward closes the step as `forwarded` and opens the next one with
`forwarded_by`.

**Reductions never need validation.** A commercial REDUCTION is no longer
authority-checked at all (as revocations never were); the emergency path is
untouched.

**Visibility.** `tci.limit_validations` RLS = admin or
`is_validation_participant(chain)`; the request page reads the chain through
`limit_validation_history` (same rule) and anyone on staff may see THAT a
request is on validation and with whom (`limit_request_validation_state`).
No API role writes the table; a BEFORE UPDATE trigger lets only the
resolution columns of a pending step change, once.

### Authority levels rules (migrations 0070–0071)

**A proposal goes to a level, never to a person.** `submit_limit_for_validation`
and `submit_adjustment_for_validation` refuse a validator
(`named_validator_retired`) and route with `tci.route_validation_level`:
above the author's rank (`tci.user_rank`, 0 without one), ranks nobody
eligible can answer are skipped; `required` + `direct` → the lowest rank whose
level authority (`tci.level_authority_uzs`; the committee is `Infinity`)
covers the amount, else the committee; voluntary, `sequential` or a forward →
the next rank up. Nothing qualifies ⇒ `authority_level_missing`. In `direct`
mode the eligible members of the skipped ranks get `limit_validation_fyi`
(manual close). A 0060 step still pending with a named validator is answered
as before.

**Who answers** (`tci.level_eligible_members`): an active member of the
level holding the stream's department role, not banned, four eyes clear
(`limit_four_eyes_refusal` — so not the requester, nor in separate credit
analysis the rater), not anywhere in the chain (proposer, validator,
forwarder, resolver) and not conflicted on the step. Every eligible member
gets the `limit_validation` task; the first answer closes them all. A
member approving AS IS beyond their own authority passes it to the next rank
(`v_action := 'forward'`); approve-modified beyond it is refused.

**Authority counts the level.** `my_authority_uzs`, `user_authority_uzs`,
`underwriters_covering`, the queue's `decide_alone` and
`adjust_limit_commercial` (`my_stream_authority_uzs`) take the larger of
the personal grants and the level grants (`tci.level_authority_of`).

**The committee votes.** `cast_committee_vote` (approve / reject with a
reason / abstain, once), `declare_committee_conflict` (a reason, recorded,
bars the member), `close_committee_vote`: the chair closes — or, when the
chair is barred or unset, any eligible member — once at least half of the
electorate (eligible members plus those who voted) has voted; more
approvals approve, more rejections reject, a tie goes the chair's way, and
without the chair's vote the proposal returns to the author; reject / return
need minutes. The close runs `resolve_limit_validation` under the
`tci.committee_resolution` marker, which lets decide / adjust take the
committee's unlimited authority, and records the decision with the closer
as `decided_by`. Votes and conflicts are rows nobody updates (trigger, owner
included) and no API role writes. `committeeOutcome` / `quorumMet` in
`validation.ts` mirror the rule (contract-tested).

**Set up by admin, a technical setting.** `set_authority_routing`,
`save_authority_level_grant` (replaces the band's live grant; refused on the
committee), `end_authority_level_grant`, `add_authority_level_member` (the
department, one rank 1–4 per stream), `end_authority_level_member` (ends a
chair's chair), `set_committee_chair`. Admin is never a member (no
department role) and votes on nothing.

### Acting role and four-eyes rules (migration 0063)

**One role at a time, decided by the server.** `tci.acting_role()` = the
row of `tci.acting_roles` for (`auth.uid()`, the JWT `session_id` claim) if
that role is still held; otherwise the ONLY role held; otherwise NULL — and
NULL closes every gate. `has_role`, `is_staff` and `current_user_roles`
answer for it, so reads are as strict as writes: a person acting as sales
sees what a sales-only user sees. Department tasks follow the acting role;
a task addressed to a PERSON for their department's work (a band-aware
limit decision, a data request, a validation step) also names that role
since 0077 (`tci.task_work_role`, filled by `open_task`) and shows only
while the person acts in it; a task addressed to the person alone (a result
notice, a client's task) stays visible in every workspace. A single-role
user never sets anything. `set_acting_role` refuses a role not held
(`acting_role_not_held`, 42501) and a token with no session
(`acting_role_no_session`); the switch is logged `session.acting_role`.
Rows are per session and are not cleaned up (one small row per sign-in of a
multi-role person).

**The browser asks, the server decides.** `AuthContext` loads `held_roles`
and `acting_role`, picks with `chooseActingRole` (server's choice while
held, else the remembered workspace's role) and calls `set_acting_role`
before the screen renders; `roles` in the context is `[actingRole]`,
`heldRoles` feeds the switcher. A switch resets the query cache and is
announced to other tabs (`tci-erp-acting-role`), which share the session.

**Four eyes** (`tci.limit_four_eyes_refusal(request, user, stream)`, mirrored
by `src/features/limits/fourEyes.ts`): whoever RAISED a limit request never
takes it into review, decides it, proposes a decision on it, validates it or
adjusts it; on the commercial stage whoever made a CREDIT decision on it
does not adjust it. Callers raise the returned text (`four_eyes_own_request`
/ `four_eyes_own_credit_decision`, 42501); for a named validator or
forward-to it comes back as `validator_four_eyes_…` (P0001). The queue view
carries `own_request`, and the request page shows a notice instead of the
form.

**Admin decides nothing.** The 16 limit functions of 0063 contain no
`'admin'` (asserted in the migration); `user_authority_uzs` is no longer
Infinity for admin; `start_limit_review` requires credit underwriting. Admin
keeps READ oversight (queue, ADT report, validation chains) and the
technical settings (`set_auto_decision_settings`, authority grants, users).

**Admin is technical everywhere (0065).** No business function names
`'admin'` any more, and no WRITE policy on a business table lets admin in;
the assertion at the end of 0065 lists exactly the tci functions and the
write policies that still may (users and sign-in, the ADT switch and two
read-only oversight functions, contract templates, bank-statement profiles,
the retired brochure/media functions; reference data, authority grants,
settings, the insurer's particulars) — a new one must be added there on
purpose. Every SELECT policy is untouched: admin still READS everything.
`change_policy_status` names its rule (`policy_status_commercial_only`,
42501) instead of answering "not found". An admin refusal may arrive as
P0002 rather than 42501 where a function locks its row before its own role
check (the write policy no longer lets admin lock it). The Agenda shows a
person only what they may work (`isMine`, the mirror of `task_is_mine`), so
admin's «Моя повестка» holds admin's own tasks; the UI mirrors the rest
(`entities/access.ts`, `policies/statusMachine.ts mayWritePolicies`,
`declarations/machine.ts mayMoveAs`, and the role lists of every feature
machine). `tests/db/admin_technical.sql` proves it.

### Information gathering rules (migrations 0066–0067)

**Routed in one place.** `tci.handle_information_routing` is an AFTER INSERT
trigger on `tci.workflow_events` named `workflow_events_zy_…` so it fires
after the Agenda mapping (it cancels the `limit_needs_decision` that mapping
just opened) and before `workflow_events_zz_auto_decisions` (which then finds
the request no longer `submitted` and does nothing). It acts on
`limit.request_submitted` whichever path submitted — the staff form, the
client portal, a resolved buyer proposal — so no submit function decides.

**What counts as missing** is `tci.buyer_information_gaps(entity)`, in a
fixed order: `registration_number`, `address`, `industry`, `no_statements`,
`stale_statements` (latest `period_end_date` older than the setting, 18
months by default). `information.ts` mirrors the order (contract-tested).

**Released by the data, not by a job.** AFTER triggers on
`financial_statements` (insert/update) and `legal_entities` (update) call
`release_limit_information` for that buyer's requests in gathering; it moves
a request back to `submitted` only when nothing is missing and emits
`limit.request_submitted` again, so the decision task and the auto decision
follow as for any submission. «Проверить снова» (`recheck_limit_information`,
staff) does the same on demand and answers what is still missing.

**The waiver is credit's, with a reason, four eyes.**
`waive_limit_information` (credit underwriting, never on its own request,
comment required) writes a row of `tci.limit_information_waivers` (no API
write grant) and sends the request on; the routing then lets it pass.
`information_gathering` is an OPEN status everywhere the open ones are named
(the one-open-request index, withdraw, the client duplicate checks, the
queue, freshness and rating views). Withdrawing now emits
`limit.request_withdrawn`, which closes the request's open limit tasks.

### Credit analysis rules (migrations 0068–0069)

**Capabilities, not roles, decide who rates.** `tci.has_capability(cap)`
answers for the acting role under `workflow_settings.credit_analysis_mode`:
'rate' and 'confirm_rating' = credit analyst, plus credit underwriting in
`combined`; 'decide' = credit underwriting in every mode (never admin). The
"credit_assessments: credit write" policy asks `has_capability('rate')`;
`src/lib/creditAnalysis.ts` mirrors it (contract-tested) and the screens ask
the mode through `tci.credit_analysis_mode()`, assuming `combined` until it
answers — the database still refuses what it must.

**`rating_grade` is the grade IN FORCE.** The engine's grade is frozen in
`engine_grade` by a BEFORE INSERT trigger; `tci.confirm_rating(assessment,
grade?, comment?)` stamps the one confirmation (who, when, why) and may set
another grade of the scale (`^[A-D][0-9]{0,2}$`) only with a comment. Every
reader of `rating_grade` — the band of a decision, the queue, ADT, the
report — therefore follows the confirmation without being rewritten.
Unconfirmed, the engine's grade is in force, as before 0069. Only the
buyer's CURRENT rating is confirmed (`rating_not_latest`), once
(`rating_already_confirmed`); `rating.confirmed` is emitted and rechecks the
ADT. The API may only INSERT an assessment (UPDATE and DELETE revoked), and a
trigger refuses any change but the confirmation, owner included
(`rating_immutable`).

**Four eyes on the rating.** Whoever calculated a rating never confirms it
(`four_eyes_own_rating`, 42501; `created_by` is forced to the signed-in user
on insert). In `separate` mode `tci.limit_four_eyes_refusal` also refuses a
CREDIT decision, proposal or validation by whoever calculated or confirmed
the buyer's current rating — a person holding both roles rates as an analyst
and is still kept off the decision on that rating. In `combined` mode the
same underwriter may rate and decide (that is what combined means).

**Rating tasks follow the mode.** `tci.open_task` sends `buyer_needs_rating`,
`rating_stale` and `rating_new_statements` to `tci.rating_task_role()`
(credit analysts in `separate`), and `set_credit_analysis_mode` (admin) moves
the open, department-addressed ones. In `separate` mode the rating worklist
names a current rating nobody has confirmed (`unconfirmed`, tested last —
`RATING_REASONS` mirrors the order from 0069's text).

### Rating proposal rules (migrations 0072–0073)

**A suggested grade is never in force on its proposer's word.**
`tci.propose_rating(entity, grade, reason, assessment?, statement?, escalate)`
needs `has_capability('rate')` and a reason; one pending proposal per buyer
(partial unique index), and a pending proposal holds `confirm_rating`
(`rating_proposal_pending`). With an assessment it proposes a grade for the
buyer's CURRENT, UNCONFIRMED engine rating; without one it is a manual
rating. Approval writes the grade: a manual proposal becomes a confirmed
assessment (`source = 'manual'`, `created_by` = the proposer, `confirmed_by`
= the approver, no score, no recommended limit, `engine_grade` null), an
engine proposal stamps that assessment's one confirmation. A manual
assessment can only be inserted by trusted code — the guard trigger (SECURITY
DEFINER since 0073, it asks `internal_call_ok`) refuses
`rating_manual_direct` otherwise.

**Who answers.** The colleague route: anyone who confirms ratings under the
mode (`rating_colleagues`: credit analysts; credit underwriting too in
`combined`), acting in that role. The level route: the members of the credit
authority level the step sits with (`rating_level_members`: credit
underwriting, as 0071 seats them). Never anyone in the chain — the proposer,
the author of the engine rating, whoever opened or answered a step
(`rating_proposal_chain`) — nor a member who declared a conflict. A rating has
no amount, so escalation is always rank by rank from the proposer's rank
(`user_rank`, 0 for an analyst), skipping ranks nobody eligible can answer;
a colleague may forward it to the levels; nothing goes above the committee
(`rating_top_of_chain`). Each eligible answerer gets their own
`rating_proposal` task; the first answer closes them all.

**Answers**: approve (the proposed grade), approve another grade (reason
required, not the proposed one — `rating_modified_same`), return and reject
(reason required), forward. The proposer may withdraw while pending. The
committee votes (`cast_rating_vote`, `declare_rating_conflict`,
`close_rating_vote`) under exactly 0071's rules; the close runs the answer
under the `tci.rating_committee_resolution` marker. Steps are resolved once
(trigger), proposals, votes and conflicts never change, and no API role
writes any of the four tables (credit desk + admin read).

**ADT by analysts.** `set_buyer_adt` / `disable_buyer_adt` /
`set_buyer_adt_block` accept credit analysts, still capped by
`my_authority_uzs(band)` — an analyst needs authority grants of their own
(Admin › Полномочия; `underwriters_covering` still names credit underwriters
only, so a grant never routes limit decisions to an analyst). The ADT tables
and «Авторешения» are the analysts' to read too.

### Rating approval routes (migration 0078)

**The rater chooses; the limit keeps its four eyes.** `submit_rating` is the
entry point; `propose_rating` keeps its 0073 signature and serves the
colleague and level routes (submit_rating sets the transaction-local
`tci.rating_target` for a named colleague, and `open_rating_step` stores it
as `rating_proposal_steps.target_user`, refusing `rating_colleague_not_eligible`
when that person may not answer). `self` needs both 'rate' and
'confirm_rating'; it inserts a `rating_proposals` row with `self_approved`
and applies it at once — `apply_rating_proposal` skips `four_eyes_own_rating`
for that proposal only; the plain `confirm_rating` still refuses the
calculator. A self-approver is the rating's confirmer, so in `separate` mode
0069 keeps them off the limit decision on it. The history lists
self-approved grades (`status = 'self_approved'`, `route = 'self'`);
`SUBMIT_ROUTES` and the status mirror the 0078 text (contract-tested).
No DROP anywhere: the MCP tooling still holds any statement containing it
(probed 2026-10-26), so signatures are kept and columns only added.

### Rating scorecard rules (migration 0079)

**A grade is composed, not typed.** `rating_proposals.scorecard` holds four
pillars in a fixed order (`tci.rating_scorecard_pillars()`: general,
balance_sheet, profit_loss, payment), each `{grade | null, weight, reason,
comment}`. A graded pillar has a weight > 0 and a reason of ITS pillar from
`tci.rating_scorecard_reasons()`; an ungraded one has weight 0 and the reason
`not_assessed` (set by the database). The graded weights sum to 100.
`tci.rating_scorecard_normalised` is the one checker — called by
`submit_rating_scorecard` before anything is written and again by the BEFORE
INSERT trigger on `rating_proposals`, which takes the scorecard from the
transaction-local `tci.rating_scorecard` once and refuses a proposal without
one (`rating_scorecard_required`). `scorecard.ts` mirrors the lists and the
rules (contract-tested against the 0079 text).

**The weighted grade is arithmetic on the scale position** (A1 = 1 … D = 7,
`tci.rating_scale_codes()`), a half rounding to the WORSE grade. The overall
grade is the proposal's grade; its reason is `consistent_with_subgrades`
exactly when it equals the weighted grade, an `up` reason only when better, a
`down` reason only when worse, `analyst_judgement` either way
(`rating_scorecard_adjustment_reason`). The group cap (0074) applies to the
overall grade as before. An answerer's «approve another grade» carries no
scorecard — the history shows the proposer's scorecard and the answerer's
grade side by side.

**Where it is read.** The credit desk reads `rating_proposals.scorecard`
through its RLS (pending proposal, history); `tci.rating_scorecard_of(assessment)`
(security invoker) finds the scorecard behind a grade in force — the step that
wrote that assessment first, else a proposal its rater approved alone on it.
Default weights are `workflow_settings.rating_pillar_weights` (admin,
`set_rating_pillar_weights`); the form spreads them over the graded pillars
(largest remainder) and the rater may change them per rating. The engine's
factors suggest equity-and-debt, P&L and (size, age) general sub-grades only
when the analytics service serves the scale — zone boundaries are never
hardcoded; the payment pillar has no engine factor. `confirm_rating` (the
engine's grade as is, 0069) carries no scorecard.

### Group rating rules (migration 0074)

**The cap lives in the guard trigger.** `tci.guard_credit_assessment` (SECURITY
DEFINER) lowers every new engine or manual grade to the live group rating
over the buyer (`tci.group_rating_cap` = the active `group_ratings` row of
`tci.ultimate_parent(entity)`) and stamps `group_rating_id`; the engine's own
grade stays in `engine_grade`. On UPDATE (the one confirmation) it refuses a
grade better than the cap. `propose_rating` and `apply_rating_proposal`
refuse the same up front; `confirm_rating` now defaults to the grade in force
(the capped one), which needs no reason. "Worse" is one function,
`tci.grade_worse` = the larger in byte order (A1 < A2 < B1 < … < D),
mirrored by `groups/groupRating.ts gradeWorse` (contract-tested).

**Setting writes rows; history is not rewritten.** `set_group_rating(member,
grade, reason)` (credit analyst acting, `is_senior_credit_analyst`, else
`group_rating_senior_only` 42501) replaces the live row and runs
`apply_group_cap`: each member whose current grade is better gets a NEW
assessment that copies the row it caps (source, statement, score,
recommended limit, trace) at the group's grade, confirmed by the setter, with
`group_rating_id` — only trusted code may insert such a row
(`rating_group_cap_direct`). `rating.created` follows, so the rating tasks
close and the ADT is rechecked (a downgrade suspends it). Raising or ending
(`end_group_rating`, reason required) writes nothing on the members: a capped
member goes up only by being rated again. A company joining the group later
is capped at its next rating.

**Seniority is admin's flag.** `set_senior_credit_analyst(user, on)`
(admin; refused for anyone not holding `credit_analyst` —
`senior_requires_analyst`); no API role writes the column. The group rating
is read by the credit desk and admin (`group_rating_state`), never by sales
or clients.

### Client limit request change rules (migration 0075)

**Amend before underwriting, replace after.** `tci.client_request_amendable`
(`submitted`, `information_gathering`, `pending_entity`) is when the
policyholder may change a request in place; `tci.client_request_open` (those
plus `under_review`, `escalated`) is when they may withdraw it.
`requestChanges.ts` mirrors both (contract-tested) and the portal view
answers per row (`may_amend`, `may_withdraw`). The amount drives the band,
the authority, the validation level and the auto decision, so it never
changes under an underwriter's hands: once taken, `client_replace_limit_request`
withdraws the old request and raises a new one IN ONE TRANSACTION (a refused
new request withdraws nothing), and the new one names the old
(`replaces_request_id`).

**An amended request is submitted again.** `client_amend_limit_request`
cancels the request's open limit tasks and emits `limit.request_amended`
then `limit.request_submitted`, so the decision task is re-addressed to the
underwriters covering the NEW amount, the information routing (0067) and
the auto decision (0061) run as for any submission. A proposal (not yet a
company) is simply updated — resolving it copies what it says then.
Unchanged values are refused (`amendment_unchanged`).

**The record never changes.** `tci.limit_request_amendments`: one row per
change (`amended` in place, `replaced` on the replacing request), staff read
(`limit_request_changes(request)` includes the proposal's rows), no API
write, a trigger refuses UPDATE/DELETE for everyone.

**A withdrawal closes everything, whichever path.**
`handle_limit_withdrawal` (an AFTER INSERT trigger on
`limit.request_withdrawn`) stamps `withdrawn_by` / `withdrawn_via` (`portal`
from the client function's payload, else `staff`) and cancels any pending
validation step with its tasks (`emit_validation_resolved … 'cancelled'`).
Before 0075 the step stayed pending until a validator happened to answer.
A withdrawn proposal is `withdrawn` (new status) and its `buyer_needs_entity`
task is cancelled; `resolve_buyer_proposal` refuses it.

### Interface text size rules (migration 0076)

**One number scales everything.** `document.documentElement.style.fontSize`
is the person's size in per cent (`src/lib/uiScale.ts`); every text size,
spacing, column reservation and box in the app is rem, so it all follows.
Never size text or a box in px (`text-[13px]`, `size-[18px]`, `max-w-[220px]`):
`uiScale.test.ts` fails on it. Hairlines (borders, 1–3 px bars, radii) stay
px on purpose.

**Breakpoints are container queries.** A media query's rem is the browser's
initial font size and would not move with the scale; a container query's
rem is the root's. `index.css` therefore redefines `sm` / `md` / `lg` /
`xl` / `2xl` as `@container app (width >= …rem)` with `<body>` as the `app`
container (every portal and modal is inside it). JS that needs a breakpoint
computes it from the root font size (AppShell's `lg` for the docked
sidebar; DateInput's popup size) — never a px media query.

**Paper is 100 %.** `usePrintScale()` pins the scale while a print route is
open (risk report, contract print, offer print), and `@media print` forces
100 %, so a PDF is the same whatever the screen uses. `report.css` is in rem
(mm converted at 96/25.4 px) for the same reason: identical at 100 %,
scaled on the Overview tab.

**The server is the truth.** `useUiScaleSync` reads `ui_scale` once a
session exists (NULL ⇒ 150 %) and applies it; the picker applies at once
and saves through the column grant (`update (ui_scale)` on
`user_profiles`, own row by the existing policy). The browser cache only
seeds the sign-in page and the first paint.

**The text size is a second number (0081).** `--ui-text` on `<html>`
(`ui_text_scale` / 100, NULL ⇒ 1) multiplies the seven type tokens
(`textSized` in `src/design/palette.ts`), the `h-text-*` / `leading-text-*`
utilities (badges, counters, one-line hints), every table column and min
width (the Table primitive), the Agenda's tag and due tracks, the sidebar
width and the hero tiles' least width — nothing else: spacing, breakpoints
and other boxes keep the zoom's geometry. Inline SVG labels read
`useUiTextScaleValue()`. It is read in its OWN query (`useUiTextScaleSync`),
so a database without the column leaves the text at 100 % and the zoom
working. Print routes pin it to 100 % with the zoom.

### Colour theme rules (migration 0082)

**A theme is a hue, never a luminance.** `THEMES` in `src/design/palette.ts`
re-hues `accent` and `sky` only; every step keeps its luminance, so the
contrast rules hold in every theme. Add a theme there, to `UI_THEMES`
(`uiTheme.ts`) and to a migration's check together — `themes.test.ts` fails
while the three disagree.

**Dark mode is computed, not designed per screen.** `darkCounterpart`
mirrors each colour's contrast with white as contrast with the dark card
surface (stretched ^1.02 against 8-bit rounding), so any two colours keep
their contrast; `contrast.test.ts` audits every class in use in every theme
and mode. Black stays black and the `scrim` (the veil under dialogs) stays
the theme's navy. A brand surface (`data-brand-surface`) and a document on
screen (`data-paper`) keep their light colours; a new navy surface or a
document view must carry one of them, and a new hex colour in a screen
component is a bug (use a token, or `var(--color-…)` for Recharts / SVG).

**Paper is the house colours.** Print routes pin blue / light while open
(`pinPaperColours`, through `usePrintScale`) and the dark rules are
`@media screen`, so a report or an offer looks the same whoever prints it.

**The server is the truth, as for the sizes.** `useUiThemeSync` reads
`ui_theme, ui_mode` in their own query (a database without 0082 leaves the
default), the picker applies at once and saves through the column grants;
the browser cache only seeds the first paint.

### Auto decision (ADT) rules (migration 0061)

**Off until the owner switches it on.** `try_auto_decision` returns
`disabled` and records nothing while `auto_decisions_enabled` is false;
switch it on (`set_auto_decision_settings`, admin) only after the rating
engine is calibrated and the analytics service is hosted. Every save sends
the switch explicitly: the function reads a missing value as OFF.

**All conditions or nothing.** The rule (`tci.try_auto_decision`, called by
`handle_adt_event` on `limit.request_submitted`, a trigger named to fire
AFTER the Agenda mapping) collects EVERY failing reason
(`limits.auto.reasons.*`) instead of stopping at the first, writes them to
`auto_decision_attempts`, and leaves the request `submitted` for an
underwriter. There is no partial auto decision: above the ADT amount or the
recommended limit is a reason, never a reduction. Amounts are compared in
UZS; a missing rate is `fx_missing`, never a pass.

**At most five auto decisions per ADT (0083, owner 2026-10-27).** The form
offers 1–5 from a list; `buyer_adt_total_count_max` bounds every insert,
next to 0061's 1–1000 check. `ADT_COUNT_BOUNDS` mirrors it (contract-tested).

**The ADT is set within authority and replaced, never edited.**
`set_buyer_adt` takes the band from the buyer's latest rating and refuses
`adt_beyond_authority` above the setter's `my_authority_uzs(band)` (admin
unlimited); the previous live row becomes `replaced`. `disable_buyer_adt`
ends it; `set_buyer_adt_block` bans auto decisions with a reason and
suspends the live ADT. Used = decisions with that `adt_id`, counted, never
a stored counter.

**Suspension is decided from facts.** `recheck_buyer_adt` runs on
`rating.created`, `noa.filed`, `claim.created`, before every evaluation,
and lazily from `refresh_agenda` (stale financials are a matter of time —
no cron); a band WORSE than the one it was set at, or any stop factor,
suspends it with the first reason and opens `adt_review`, which closes on
`adt.set` / `adt.disabled`.

**The auto decision is an ordinary decision row.** Approved, the policy's
`max_payment_terms_days`, valid `adt_limit_validity_months`,
`decided_by = null`, `system_generated`, `system_reason_key =
'limits.auto.adt'`, `released_at = now()`, `release_kind = 'immediate'`,
`adt_id`; it supersedes the scope's effective decisions like
`decide_limit_request` and closes the request's Agenda tasks. Staff see the
mark «Авторешение (ADT)»; the parameters, attempts and report
(`v_auto_decisions`, security invoker) are RLS-limited to admin and credit
underwriting, and every ADT function refuses other roles with `42501`.

### Sector, country and sanctions rules (migrations 0084–0085)

**A sector grade is a version, never an edit.** `tci.sectors` has one row per
industry (a trigger adds one for a new industry) with the credit analyst admin
made responsible. `tci.sector_reviews` holds every review: grade A–D, outlook,
the seven factors (`tci.sector_factor_keys()`, each favourable / neutral /
adverse with a note), the narrative and the sources. The grade in force is the
latest APPROVED review (`decided_at`, stamped with `clock_timestamp()` so two
reviews in one transaction still order). With `sector_review_four_eyes` (off by
default) a review is `pending` until another analyst approves it; one pending
per sector; nothing is changed once decided and nothing is deleted. An ad hoc
review supersedes at once. A review of an earlier quarter is STALE
(`v_sector_grades.stale`); no review of this quarter past the due day
(`sector_review_due_day`, 15) is OVERDUE.

**The quarterly task is lazy.** `tci.refresh_sector_tasks()` (called by
`refresh_agenda`, no cron) opens `sector_review_due` for each sector with a
responsible analyst and no review of this quarter, addressed to that person as
a credit analyst (0077's `target_role`), due on the due day at 23:59 Tashkent,
and cancels an earlier quarter's. The industry's names ride on the task in the
three languages (`industry_names`); the Agenda renders the reader's.

**A downgrade to C or D tells credit underwriting.** `sector_review_in_force`
opens `sector_downgrade_review` (manual close) when the grade worsens into C or
D and buyers in the sector hold in-force limits, listing up to 25 of them.

**Country risk: the OECD list as published, an override with four eyes.**
`import_country_risk` (admin) stores one immutable import per file; the latest
(effective date, then import time) is in use; a country absent from it is NOT
CLASSIFIED — never category 0. `propose_country_override` (a credit analyst,
justification required) waits for the head of credit analysis — a SENIOR credit
analyst (0074's flag), never the proposer — who approves, rejects or later
ends it. Decisions use the internal category while it is approved; both values
are shown. `v_country_risk.import_stale` is true past `oecd_stale_months` (6)
or when no list exists.

**Sanctions mean no cover, in SQL, on every path.** A live flag (effective,
not lifted) on a country or a company makes `tci.cover_block_internal` answer
`company` or `country`. Triggers refuse a new limit request, an approving or
partial decision, a submission, a buyer in a package and a policy for a
flagged buyer or policyholder (`cover_not_available: company|country`, P0001)
— whoever writes, the owner's scripts and the committee included; a decline, a
reduction to nothing and a revocation stay possible. The refusal names no
regime: the portal shows the client only «cover is not available for this
country / buyer». `set_sanction_flag` (admin today; `tci.may_manage_sanctions`
is the one place a compliance role will be added) opens an urgent
`sanctions_limit_review` per in-force limit and returns the count; nothing is
revoked automatically. Flags are lifted with a reason, never deleted.

**The cover matrix is a rank floor.** `tci.cover_required_rank_internal`
= the country key's `rank_floor` (internal category first, then OECD, else
`unclassified`) + the sector grade's `rank_add`, at most 5 (the committee).
Defaults: 0–3 → 0, 4–5 → 3, 6 → 4, 7 and not classified → 5, sector D +1.
`decide_limit_request` answers `needs_validation` (with `required_rank`) when
the decider's `user_rank` is below it, and `submit_limit_for_validation`
routes from `greatest(rank, required − 1)`, so the step lands at that rank or
above. **The country part is silent until the first OECD import** (or an
approved override for that country): an empty list would make every country
«not classified» and send every decision to the committee. It applies to
credit decisions, not to commercial adjustments. An auto decision is refused
(`cover_restricted`) whenever a block or a rank above 0 applies.

**The engine takes the context, the screens build it.** The rating sends
`risk_context` (`engineRiskContext` in `src/features/risk/rules.ts`): the
sector grade, the country category (silent as above) and the admin's notches
and caps from `risk_adjustment_settings`. credit_engine 0.2.0 notches along
A1…D (clamped), applies the worst cap (categories 6–7 cap at C1), moves the
score into the adjusted band so the limit follows the grade, and writes each
step as a trace line; without a context the output is byte-identical.

**Concentration is a hint, never a price.** `tci.cover_concentration(policy |
submission)` splits the book by sector grade and country category, warns
above `concentration_warn_pct` (40) for the C/D or the 5–7 share or when every
buyer sits in one C/D sector, lists blocked parties, and computes an
exposure-weighted premium loading hint from the table. Staff only, like every
0085 table and view (RLS `is_staff()`, no API write).

### Credit workbench rules (migration 0053)

**A section is a set of views, and the roles choose which.** «Полисы» and
«Кредитные лимиты» are one sidebar item each, with tabs synced to `?view=`
(`policies/views.ts`, `limits/workbench/views.ts`). The overview (and, for
limits, monitoring, ratings, groups and authority) belongs to the owning desk
— commercial resp. credit underwriting, and admin; everyone else who may open
the route gets the rest, and an unknown or forbidden view falls back to the
first allowed one. The old `/limits?tab=…` deep link still opens the queue.

**"Can I decide this?" is the database's answer.** `v_limit_request_queue`
computes the band from the buyer's latest assessment (`unrated` without one)
and `decide_alone = admin or amount_uzs <= the caller's credit authority for
that band` — the rule of `decide_limit_request`, with one difference stated in
the view comment: a grant in a currency with no rate is SKIPPED there instead
of raising, so one bad grant cannot empty the list. The screen only shows it.

**The rating worklist reasons are ordered and exclusive**: `no_statements`
(nothing to rate on — the information manager's work), `no_rating`,
`new_statement` (a LATER period than the rated statement, compared by
`period_end_date`, not by when it was typed in), `stale` (older than twelve
months — the same threshold as `refresh_agenda`'s `rating_stale`, asserted in
0053). `RATING_REASONS` mirrors the order and a contract test reads it from
the migration.

**A standalone buyer is not a group.** Every buyer with a limit is its own
ultimate parent in `v_group_exposure`; `v_group_limit_status` keeps only
`tci.entity_group` sizes above one, or a live group limit. `over_limit` is the
database's comparison; "near" (≥ 90%) is presentation only.

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

### Risk report rules (design upgrade)

**Normalise units before adding anything.** Statements are stored as entered
(units / thousands / millions). `report/model.ts` multiplies every amount to
whole units first; the group view `v_group_member_financials` does NOT, so
never sum members from it.

**The COMBINED group is a sum, not a consolidation.** It adds the members'
own annual statements in the company's currency (members in another currency
are left out and counted), with no intra-group eliminations; the report says
so under the table. The subject company is part of the sum but is left out of
the key-companies RANKINGS (it would crowd its affiliates out); its share
stays in the totals.

**Changes come from the original currency.** With `?ccy=` the amounts are
converted for display, but every arrow, % change and commentary move is
computed on the original statement-currency series, and two years in
different currencies are never compared.

**Commentary is structured, never generated.** `report/commentary.ts` emits
(metric, subject, move, strength, from, to) and the page renders it through
`report.commentary.*` templates. Strength: < 5% slight, < 20% moderate,
< 50% strong, otherwise sharp; a move is n/m across a sign change, from a
zero base or beyond ±1 000%. "Loss narrowed / deepened" applies only to
result metrics (profit, margins) — a negative cash conversion cycle is not
a loss.

**The page footer lives in the `@page` margin boxes.** Only they can print
"page x of y", and their `content` must be a literal, so `PrintPageRules`
generates the rule in the report language (`report/printRules.ts`). The
running header is the `thead` of the one-cell layout table.

**One document, two faces.** `useRiskReport` (data) + `RiskReportBody`
(content) serve both the A4 route and the Overview tab; never fork the
sections. The tab passes `reportType: 'auto'` (the latest annual
statement's type) and the original currency; the A4 route takes `?type=`
and `?ccy=`. A report in a language other than the UI's must wait for
`useFixedT(lang).ready` — en / uz are not bundled.

**Headless check.** Render `/entities/:id/report` with Supabase stubbed in
the browser (Playwright `context.route` on `/rest/v1/**` + a fake session in
localStorage) and `page.pdf({ format: 'A4', preferCSSPageSize: true })`; the
reference Internet Resheniya figures produce 6 pages in en and uz, 7 in ru.

### Replaying the migration chain locally

The harness is committed in **`TCI_ERP/tools/db/`** (audit Phase B):
`bootstrap.sql` is the Supabase stub (API roles, `auth.users` + `auth.uid()`,
`storage.buckets`/`objects`, pgcrypto and `pg_trgm` in schema `extensions`,
database `search_path = public, extensions`), and

```sh
createdb tci_replay                     # a FRESH, empty database
TCI_ERP/tools/db/replay.sh tci_replay   # name or URL; stub + 0001…latest + tests/db/*.sql
```

applies every migration with `psql -v ON_ERROR_STOP=1 --single-transaction`,
one transaction per file, then runs every `tests/db/*.sql`, stopping at the
first failure (`--no-tests`, `--tests-only` for a restored backup). It needs
a superuser connection and takes seconds. CI runs it on a **Postgres 17**
service container (`.github/workflows/db.yml`, on changes to migrations,
`tests/db` or `tools/db`); run it locally before applying a migration to
canonical. A new `tests/db/*.sql` must roll back and print one
`<name>: OK — …` notice, which is how `replay.sh` knows it passed.
`tools/db/schema-fingerprint.sql` + `ledger-check.md` compare a replay with
canonical; `docs/BACKUP-RESTORE.md` restores a nightly backup into it.

It has paid for itself: it caught defects that typecheck, lint and the unit
tests all missed — four staff views shipped with **no `select` grant** (every
claims screen would have rendered "permission denied"), and the
`text[] || 'literal'` crash above. Two things to know: use
`--single-transaction`, because `apply_migration` is transactional and 0015
relies on a temp table surviving between statements; and `pg_trgm` lives in
`extensions`, not `public`.

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

**Not hosted yet — the deploy is prepared and waits for the owner's
dashboard steps.** Host: **Cloudflare Containers** on the existing account
($5/mo Workers Paid). `deploy/cloudflare-analytics/` holds the Worker that
fronts one `lite` container built from the repo-root `Dockerfile` (build
context = the root, because the service imports `credit_engine` as a path
dependency); it overwrites the client-IP headers from the edge's
`CF-Connecting-IP` and passes the service's env from Worker vars/secrets.
Owner steps, secrets and the follow-up CSP change:
[`services/analytics/README.md` → Cloudflare Containers](services/analytics/README.md#cloudflare-containers).
`render.yaml` stays as a fallback. Until the steps are done, users are
created by hand: `docs/create-user.sql`.

Hardening that must not regress: CORS allowlist + an ANCHORED preview regex
(never `*`), 1 MB body cap, 30s request deadline, opaque 500s with a request
id, one structured JSON access line per request with no header values, and
rate limits on provisioning where the **per-IP bucket is a router
dependency** — inside the endpoint body it would never run for an
unauthenticated request, making a 401 flood free.
