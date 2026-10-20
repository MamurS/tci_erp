# MVP demo dataset

`demo-seed.sql` wipes every business row in schema `tci` and loads a coherent
demo book. It does not touch existing accounts, which keep their roles and
authorities, or reference data (countries, currencies, rates, statement forms,
workflow settings, insurer particulars, uploaded contract templates).

## Run it

1. **Seed.** In the Supabase SQL editor of the **canonical** project
   (`reunqrpeumokqgarknge`), run `demo-seed.sql` whole. It is one transaction
   that ends with assertions: if any case is missing, nothing is committed.
2. **After the seed** (Storage and the browser):

   ```sh
   cd TCI_ERP && npx vite --port 5173 &
   DEMO_PASSWORD=… node ../docs/demo/after-seed.mjs
   ```

   This step does what SQL cannot:
   - uploads the claim documents and files the three claims;
   - works the claims: coverage, approval, payment, recovery, an information request;
   - generates two draft contracts through the «Договоры» screen.

**When the SQL editor is not the route** — the MCP tooling cannot run the
wipe (TRUNCATE / DELETE are held for a confirmation it never shows) nor
carry the whole file — the same result comes in three steps:

1. the owner runs only the wipe section (`truncate …` + the sequence
   restarts + the demo-account cleanup) in the SQL editor;
2. the demo users and the workflow section go through `execute_sql` (each
   part is self-contained: ids are `md5('demo:' || key)`), while companies,
   statements and ratings are loaded through the API as the demo users:
   `DATA_JSON=… uv run python ../../docs/demo/build_demo_seed.py` then
   `node docs/demo/load-via-api.mjs <data.json>`;
3. `after-seed.mjs` as above.

The scripts read `SUPABASE_ANON_KEY` (the project's publishable key) from
the environment when `.env.local` holds a local placeholder; the dev server
for the contracts step must be started with `VITE_SUPABASE_ANON_KEY` set to
the same key.

Re-running is safe: the seed wipes and rebuilds the demo, and numbering
starts again at CL-YYYY-0001. Files that an earlier `after-seed.mjs` put in
Storage stay there, unreferenced.

To rebuild the SQL after changing the dataset:

```sh
cd services/analytics && DEMO_HASH='<bcrypt>' uv run python ../../docs/demo/build_demo_seed.py
```

`build_demo_seed.py` holds the people, companies and financials, and rates
every statement with the analytics service's own handlers. The ratings are
real engine output. `demo-workflow.sql` holds the workflow, written by hand.

## Cast

All demo users share one password, given out of band. Only its bcrypt hash
is in the repository.

| Login | Role | Notes |
|---|---|---|
| demo.sales@demo.invalid | Продажи | raises limits, files overdue notifications, holds a decision |
| demo.commercial@demo.invalid | Коммерческий андеррайтер | commercial authority A–D |
| demo.credit@demo.invalid | Кредитный андеррайтер | authority A 2M · B 1M · C 300k · D 50k · unrated 25k USD |
| demo.credit.junior@demo.invalid | Кредитный андеррайтер | small authority, so his decision escalated |
| demo.claims@demo.invalid | Убытки | |
| demo.info@demo.invalid | Информационный менеджер | entered the companies and statements |
| demo.client@demo.invalid | Клиент (портал) | user of Samarkand Textile MChJ |

## What is where

**Companies**
- 6 policyholders (Samarkand Textile, Fergana Cotton, Navoi Copper, Tashkent Pharma, Andijan Auto, Bukhara Food).
- 4 prospects.
- 17 buyers in RU, DE, KZ, TR, CN, AE, PL, IT, KR and UZ.
- 2 group parents.
- Three years of IFRS statements; ratings range from A2 (Shanghai Huamei) to D (Seoul Auto Parts).

**Policies**
- TCI-2026-0001…0005 are active: whole turnover, key buyers, single buyer; USD, EUR and UZS.
- TCI-2025-0014 expires in 45 days, which feeds the renewals list.
- TCI-2026-0007 is a draft renewal.
- TCI-2026-0005 was bound from a submission.

**Submissions:** one at each stage — entity resolution, underwriting, commercial review, client review, bound, and declined by the client.

**Credit limits**
- approved, partial (with conditions), and declined;
- escalated: Almaty, decided by the junior underwriter;
- under review and submitted;
- a draft for Samarkand Retail, which has no financials yet;
- one inside the sales window, one held by sales, one commercially reduced;
- reviews coming due, and one overdue (Milano Moda, PL3).

**Monitoring**
- Ozon Volga is rated C now; its limit was decided on a B.
- The Ozon group has 850k USD in force against an 800k cap.
- The Koç group has no cap.

**Ratings worklist:** one buyer for each reason — no financials, not rated, newer statements, older than a year.

**Declarations**
- Six months on TCI-2026-0001; the last one is awaiting acceptance.
- One uncovered excess (Samarkand Retail, above the DL).
- Navoi Copper has not declared yet.

**Premium:** instalments paid; Fergana Cotton is overdue.

**Overdue notifications:** Berliner and Seoul (limits suspended); Istanbul (matured into a claim); Almaty (resolved, paid).

**Claims**
- Istanbul Tekstil: partially covered (one invoice was shipped before inception) and paid.
- Tashkent Supermarket Chain: insolvency, paid, with a recovery.
- Seoul Auto Parts: information requested.

**Portal (demo.client):** the policy, the limits, the declarations, the overdue notifications, the claims, and a buyer proposed by name (Bishkek Market Group) waiting for the information manager.

**Agenda:** about 30 open tasks of 17 types, generated by the workflow itself.
