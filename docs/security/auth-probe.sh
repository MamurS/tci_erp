#!/usr/bin/env bash
# Wrong-password probe against Supabase Auth (audit Phase A2, step 0).
#
# Signs in with a WRONG password N times and prints, for each attempt, the
# HTTP status, GoTrue's error_code and message, and the Retry-After header
# when the per-IP rate limit answers. Run it three times - 1, 3, 10 attempts -
# and read the last line of each run: that is what the login page maps to a
# message (src/auth/signInErrors.ts).
#
# Needs only the project URL and the anon key (public by design). Never run
# it against the canonical project with a REAL user's address during work
# hours: with the lockout hook enabled, ten wrong passwords lock that account
# for lockout_duration_minutes (default 30). Use a test account.
#
#   export SUPABASE_URL=https://<ref>.supabase.co
#   export SUPABASE_ANON_KEY=<anon key>
#   ./docs/security/auth-probe.sh test-user@example.com 10
#
# Expected answers (GoTrue, September 2026):
#   400 invalid_credentials      "Invalid login credentials"   - wrong password
#   429 over_request_rate_limit  "Request rate limit reached"  - the per-IP
#                                 sign-in limit (dashboard: Auth -> Rate Limits)
#   403 (hook reject)            "account_locked: ..."         - the 0044 lockout,
#                                 once the password-verification hook is enabled
#   400 captcha_failed           - CAPTCHA on and no/invalid token (this probe
#                                 sends none, so with CAPTCHA on every attempt
#                                 is refused before the password is checked)
set -euo pipefail

EMAIL="${1:?email}"
ATTEMPTS="${2:-3}"
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"

for i in $(seq 1 "$ATTEMPTS"); do
  body=$(printf '{"email":"%s","password":"definitely-wrong-%s"}' "$EMAIL" "$i")
  resp=$(curl -sS -o /tmp/auth-probe-body.json -w '%{http_code} %{time_total}s retry-after=%header{retry-after}' \
    -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
    --data "$body")
  code=$(python3 -c 'import json,sys; d=json.load(open("/tmp/auth-probe-body.json")); print(d.get("error_code") or d.get("code") or d.get("error") or "-")' 2>/dev/null || echo '-')
  msg=$(python3 -c 'import json; d=json.load(open("/tmp/auth-probe-body.json")); print((d.get("msg") or d.get("error_description") or d.get("message") or "")[:100])' 2>/dev/null || echo '')
  printf 'attempt %2d: HTTP %s  code=%s  msg=%s\n' "$i" "$resp" "$code" "$msg"
done
rm -f /tmp/auth-probe-body.json
