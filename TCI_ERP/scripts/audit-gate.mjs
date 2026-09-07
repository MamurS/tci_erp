#!/usr/bin/env node
/** npm audit gate with a justified allow-list (audit Phase A2).
 *
 * `npm audit --audit-level=high` has no way to accept a finding, and a gate
 * that cannot accept anything gets switched off the first time a package
 * has an advisory with no fix on npm. This runs `npm audit --json`, fails
 * on every high/critical advisory NOT listed in .audit-allowlist.json, and
 * refuses an allow-list entry without a reason or past its expiry - so an
 * exception is a dated decision, never a permanent hole.
 *
 *   node scripts/audit-gate.mjs            # in CI and locally
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BLOCKING = new Set(['high', 'critical'])

let report
try {
  report = JSON.parse(execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
} catch (e) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  const out = e.stdout?.toString() ?? ''
  if (!out.trim()) {
    console.error('npm audit produced no JSON:', e.stderr?.toString() ?? e.message)
    process.exit(2)
  }
  report = JSON.parse(out)
}

let allow = {}
try {
  allow = JSON.parse(readFileSync(new URL('../.audit-allowlist.json', import.meta.url), 'utf8'))
} catch {
  allow = {}
}

const today = new Date().toISOString().slice(0, 10)
const failures = []
const accepted = []

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCKING.has(vuln.severity)) continue
  for (const via of vuln.via) {
    if (typeof via !== 'object') continue // a transitive pointer, reported on its own package
    const id = String(via.source)
    const entry = allow[id]
    const label = `${name} ${vuln.range}: ${via.title} (${via.url})`
    if (!entry) {
      failures.push(label)
    } else if (!entry.reason || entry.reason.length < 20) {
      failures.push(`${label} - allow-list entry ${id} has no usable reason`)
    } else if (!entry.expires || entry.expires < today) {
      failures.push(`${label} - allow-list entry ${id} expired on ${entry.expires ?? '(unset)'}`)
    } else {
      accepted.push(`${label}\n    accepted until ${entry.expires}: ${entry.reason}`)
    }
  }
}

for (const a of accepted) console.log(`ACCEPTED ${a}`)
if (failures.length) {
  console.error('\nnpm audit gate: blocking advisories\n  ' + failures.join('\n  '))
  process.exit(1)
}
console.log(`npm audit gate: OK (${accepted.length} accepted with a dated reason, 0 blocking)`)
