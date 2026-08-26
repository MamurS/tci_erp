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

Roles (stored in `tci.user_roles`, enforced via RLS):

- `admin` — full access, manages users and reference data
- `senior_underwriter` — approves above discretionary authority, manages authority limits
- `underwriter` — day-to-day credit & commercial underwriting within authority
- `policyholder` — future external portal user: sees ONLY own policies, own limit requests, own declarations. Design every policy with this role in mind even before the portal exists.

Underwriting authority: decisions above a user's authority limit must route to a senior underwriter for approval (workflow status, not just UI hiding).

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
| insured person | Застрахованное лицо | **Sug‘urtalanuvchi shaxs** |
| insurer | Страховщик | **Sug‘urtalovchi** |
| non-qualifying loss | NQL | **Qoplanmaydigan zarar (NQL)** |
| discretionary limit | Дискреционный лимит | **Diskretsion limit** |
| deductible | Франшиза | **Franshiza** |
| risk | Риск | **Qaltislik** |

## Infrastructure

- **Canonical Supabase project: `tci_erp`, ref `reunqrpeumokqgarknge`, org United Organics.**
  NEVER deploy TCI migrations or write TCI data to any other Supabase project,
  regardless of what MCP lists. The company ERP project `mosaic-erp-production`
  (org Mosaic APP) is out of bounds for TCI.

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
- [ ] Phase 3 (operations): declarations, premium booking, overdues
- [ ] Phase 4: claims & recoveries
- [ ] Phase 5: Python analytics service (scoring/rating)
- [ ] Phase 6: policyholder portal

## Design notes (future phases — recorded, not built)

* Phase 3b: role enum → sales, commercial_underwriter, credit_underwriter, claims, information_manager, admin, client; multi-role users; 2D authority matrix (user × grade-band × max amount × currency × validity), shared by credit and commercial UW.
* Phase 3c: insurance_request pipeline (client/sales/comm UW create → sales resolves entities, auto-task to information_manager for missing ones → parallel commercial (terms) + credit (ratings/limits, confirming engine auto-rating) → sales confirmation → client acceptance → bind). Two-stage limit decisions: credit stage (rating+limit) then optional commercial stage adjusting ONLY amount and credit period, both directions, within own authority; rating and conditions untouchable by commercial. In-force changes: credit → commercial → sales window (configurable, default 1 business day) with silent-consent release (lazy released_at, no cron), then visible to client; REDUCTIONS and REVOCATIONS bypass commercial and sales — visible to client immediately (emergency risk actions). Agenda: single tasks table (type, object ref, assignee role/user, due, status) driving all queues.
* Phase 3d: client portal — invitation-only (sales creates, system sends link + temp password, forced password change on first login; requires the password-change page and Supabase Site URL setup).
