#!/usr/bin/env node
// The daily sanctions list feed (migration 0095): downloads the official
// lists from their publishers, reads them with the same parsers as the
// import screen, and imports each one that changed through the same
// functions, signed in as the FEED ACCOUNT — a sign-in with no role that may
// only import lists. Run by .github/workflows/sanctions-lists.yml; by hand:
//
//   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… \
//   SANCTIONS_FEED_EMAIL=… SANCTIONS_FEED_PASSWORD=… \
//   node --experimental-strip-types tools/sanctions-feed/run.mjs [--dry-run] [ofac_sdn un eu uk]
//
// --dry-run downloads and parses only; it signs in nowhere.
//
// A list whose file is the one in use, or older, is left alone. A list that
// shrank by more than a tenth is NOT imported: the database refuses the feed's
// confirmation, the job fails, and a credit analyst looks at the file.
// The exit code is non-zero when any list failed, so the run shows red.

import { createHash } from 'node:crypto'

import { FEED_SOURCES, feedPublishedAt, feedRefusal } from '../../src/features/sanctions/lists/feed.ts'
import { batches, parseEu, parseOfacSdn, parseUk, parseUn } from '../../src/features/sanctions/lists/parse.ts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const only = args.filter((a) => !a.startsWith('--'))
const sources = FEED_SOURCES.filter((s) => only.length === 0 || only.includes(s.list))

const PARSERS = {
  ofac_sdn: (text, alias) => parseOfacSdn(text, alias),
  un: (text) => parseUn(text),
  eu: (text) => parseEu(text),
  uk: (text) => parseUk(text),
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

async function download(url) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { 'user-agent': 'tci-erp-sanctions-feed' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      return { bytes, text: new TextDecoder('utf-8').decode(bytes), lastModified: res.headers.get('last-modified') }
    } catch (e) {
      lastError = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5_000))
    }
  }
  throw new Error(`download failed (${url}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

// --- the database --------------------------------------------------------

const BASE = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? ''
let accessToken = null

async function rpc(name, body, { anon = false } = {}) {
  const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      authorization: `Bearer ${anon ? KEY : accessToken}`,
      'content-type': 'application/json',
      'content-profile': 'tci',
      'accept-profile': 'tci',
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(300_000),
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 500)
    try {
      message = JSON.parse(text).message ?? message
    } catch {
      // not JSON: keep the text
    }
    throw new Error(`${name}: ${message}`)
  }
  return text ? JSON.parse(text) : null
}

async function signIn(email, password) {
  // The sign-in gate (0046): a ticket first, as the sign-in page does.
  const gate = await rpc('login_begin', { p_email: email }, { anon: true })
  if (!gate || gate.allowed !== true) {
    throw new Error(`sign-in is throttled for the feed account (retry in ${gate?.retry_after_seconds ?? '?'} s)`)
  }
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const session = await res.json().catch(() => ({}))
  if (!res.ok || !session.access_token) {
    throw new Error(`sign-in refused (${res.status}): ${session.error_description ?? session.msg ?? session.error ?? 'no detail'}`)
  }
  accessToken = session.access_token
  // Mark the ticket a success, as the sign-in notice does (0062).
  await rpc('record_sign_in', {})
}

async function signOut() {
  if (!accessToken) return
  await fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, authorization: `Bearer ${accessToken}` } }).catch(() => {})
  accessToken = null
}

// --- one list ------------------------------------------------------------

async function feedList(source, today) {
  const main = await download(source.url)
  const alias = source.aliasUrl ? await download(source.aliasUrl) : null
  const parsed = PARSERS[source.list](main.text, alias?.text ?? null)
  const publishedAt = feedPublishedAt(parsed.publishedAt, main.lastModified, today)
  if (!publishedAt) throw new Error('the publication date is neither in the file nor in its headers')
  const hash = createHash('sha256').update(main.bytes)
  if (alias) hash.update('\n').update(alias.bytes)
  const sha256 = hash.digest('hex')
  const parts = batches(parsed.entries)
  log(`${source.list}: published ${publishedAt}, ${parsed.entries.length} parties, ${parts.length} batches, sha256 ${sha256.slice(0, 12)}…`)
  if (dryRun) return 'parsed'

  let importId
  try {
    importId = await rpc('begin_sanctions_list_import', {
      p_list: source.list,
      p_list_name: null,
      p_published_at: publishedAt,
      p_file_name: source.file,
      p_sha256: sha256,
    })
  } catch (e) {
    const refusal = feedRefusal(e.message)
    if (refusal === 'unchanged' || refusal === 'older') {
      log(`${source.list}: ${refusal} — the list in use stays`)
      return refusal
    }
    throw e
  }
  for (const part of parts) {
    await rpc('add_sanctions_list_entries', { p_import: importId, p_rows: part })
  }
  let finished
  try {
    finished = await rpc('finish_sanctions_list_import', { p_import: importId, p_confirm_shrink: false })
  } catch (e) {
    if (feedRefusal(e.message) === 'shrunk') {
      throw new Error(`${e.message} — not imported; a credit analyst checks the file and imports it on the Sanctions screen`)
    }
    throw e
  }
  let screened = 0
  let remaining = finished.due
  while (remaining > 0) {
    const r = await rpc('rescreen_sanctions_due', { p_limit: 50 })
    screened += r.screened
    if (r.screened === 0) break
    remaining = r.remaining
  }
  log(`${source.list}: imported — ${finished.entries} parties, ${finished.delisted} delisted, ${screened} companies screened`)
  return 'imported'
}

// --- main ----------------------------------------------------------------

async function main() {
  if (sources.length === 0) {
    console.error(`unknown list; expected any of: ${FEED_SOURCES.map((s) => s.list).join(' ')}`)
    process.exit(2)
  }
  const today = new Date().toISOString().slice(0, 10)
  if (!dryRun) {
    const email = process.env.SANCTIONS_FEED_EMAIL
    const password = process.env.SANCTIONS_FEED_PASSWORD
    if (!BASE || !KEY || !email || !password) {
      console.error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SANCTIONS_FEED_EMAIL and SANCTIONS_FEED_PASSWORD are required')
      process.exit(2)
    }
    await signIn(email, password)
    log('signed in as the feed account')
  }
  const results = []
  try {
    for (const source of sources) {
      try {
        results.push({ list: source.list, outcome: await feedList(source, today) })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.log(`::error title=Sanctions list ${source.list}::${message}`)
        results.push({ list: source.list, outcome: 'failed', message })
      }
    }
  } finally {
    await signOut()
  }
  const summary = results.map((r) => `${r.list}: ${r.outcome}`).join(', ')
  log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs')
    const rows = results.map((r) => `| ${r.list} | ${r.outcome} | ${r.message ?? ''} |`).join('\n')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Sanctions lists\n\n| list | outcome | note |\n|---|---|---|\n${rows}\n`)
  }
  if (results.some((r) => r.outcome === 'failed')) process.exit(1)
}

await main()
