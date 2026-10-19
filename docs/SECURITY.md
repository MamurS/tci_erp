# Security policy

TCI ERP is the trade credit insurance system of Mosaic Insurance Group JSC
(Tashkent). It holds policyholder and buyer data, financial statements,
credit decisions and claims. We take reports about its security seriously
and we act on them quickly.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, never in a public
issue, pull request or social post.

* Email: **security@mosaic-insurance.uz** (monitored on business days,
  Asia/Tashkent).
* Put `TCI ERP` in the subject. Write in English, Russian or Uzbek.
* Include: what you found, where (URL, endpoint, function or file), how to
  reproduce it, and the impact you believe it has. A proof of concept is
  welcome; a working exploit against production data is not needed and
  must not be run (see *Rules of engagement*).
* If you want an encrypted channel, ask for our PGP key in a first
  plain-text message and we will send it.

What to expect from us:

| Step | Target |
|---|---|
| Acknowledgement | 2 business days |
| First assessment (severity, whether we can reproduce) | 5 business days |
| Fix or mitigation for a confirmed critical/high issue | 30 days |
| Fix for a confirmed medium/low issue | 90 days |
| Credit in the release notes, if you want it | at fix time |

We will keep you informed while we work on it and tell you when it is
fixed. We do not run a paid bug bounty at this time.

## Rules of engagement

You are welcome to test **your own account** on the **staging project** we
provision for security testers (see `docs/PENTEST-BRIEF.md` for how to get
one). On production:

* do not access, change or delete data that is not yours;
* do not run denial-of-service, brute-force or volumetric tests;
* do not use social engineering against staff or policyholders;
* stop and report as soon as you have enough to demonstrate the issue.

Good-faith research that follows these rules will not be met with legal
action from us.

## Scope

In scope:

* the web application at `tci-erp.pages.dev` and its Cloudflare Pages
  previews;
* the Supabase project behind it (PostgREST, Auth, Storage) — the schema is
  `tci`;
* the analytics service (`services/analytics`, FastAPI) when it is hosted;
* this repository: migrations, frontend, service, CI configuration.

Out of scope:

* Supabase's and Cloudflare's own platforms (report those to the vendor);
* the vendored `Fineye*` directories, which are not part of TCI ERP;
* findings that require a compromised staff device or credentials.

## Supported versions

TCI ERP is deployed continuously from the `main` branch; there is one
supported version, the one running. Security fixes land on `main` and are
deployed with the next build. Migrations are numbered
(`TCI_ERP/supabase/migrations/`) and the deployed schema is always the
latest one.

## What we already do

For a tester's orientation (details in `docs/PENTEST-BRIEF.md`):

* every table in `tci` has row-level security; clients reach data only
  through `SECURITY DEFINER` views and functions with their own tenancy
  gate; every `SECURITY DEFINER` function callable through the API opens
  with a gate or is on an explicit, justified allow-list, asserted in the
  migrations and in CI;
* sign-in is password + optional CAPTCHA (Cloudflare Turnstile) + TOTP
  second factor (mandatory for administrators, enforced in the database);
  every sign-in starts with `tci.login_begin`, which counts the attempt as a
  failure until the custom-access-token hook confirms a success: three free
  attempts per e-mail and address, then an exponential wait (30 s doubling
  to 60 min) shown as a countdown, plus distributed-guess and
  credential-stuffing locks; a correct password presented outside the form
  hard-locks the account once enforcement is switched on; the answer never
  says whether an account exists, and every authentication event is
  recorded;
* writes that bypass a workflow function are refused: decision, status and
  history tables are guarded by triggers that require the internal-call
  token, and the claims-money, group-limit, relationship and event tables
  have no direct write grant at all;
* a temporary password must really change before the rotation flag clears,
  and the provisioning service applies the same rotation, MFA and lockout
  gates as the database;
* strict CSP (API host named exactly, not `*.supabase.co`), HSTS with
  preload, no inline scripts; the browser holds only the public anon key;
* dependency audit, secret scanning over the full history, SBOMs and a
  DAST baseline run in CI.
