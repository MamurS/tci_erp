// After docs/demo/demo-seed.sql: the steps SQL cannot do, done the way the
// application does them, as the demo users, against the project in
// TCI_ERP/.env.local (the canonical one).
//
//   1. Claims. A claim is filed only with its documents, and a document is
//      registered only from what Storage holds. The claims user uploads a
//      PDF per required document type into the claim's folder, registers
//      it, files the claim, and the claims department works it: coverage
//      verification, approval, payment, a recovery, an information request.
//   2. Contracts. The «Договоры» screen renders a draft contract in the
//      browser from the active template. Playwright drives that screen on
//      the local dev server (which talks to the same project) as the
//      commercial underwriter.
//
//   cd TCI_ERP && npx vite --port 5173 &   # for step 2
//   DEMO_PASSWORD=… node ../docs/demo/after-seed.mjs
//
// It refuses to run twice: a claim that is no longer a draft is skipped.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../../TCI_ERP/', import.meta.url)
const require = createRequire(ROOT)
const { createClient } = require('@supabase/supabase-js')

const env = Object.fromEntries(
  readFileSync(new URL('.env.local', ROOT), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
const PASSWORD = process.env.DEMO_PASSWORD
if (!URL_ || !KEY || !PASSWORD) throw new Error('need VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local and DEMO_PASSWORD')

async function signIn(email) {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  // the sign-in page asks the gate first; do the same
  await sb.schema('tci').rpc('login_begin', { p_email: email })
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`${email}: ${error.message}`)
  return { sb, tci: sb.schema('tci'), session: data.session }
}

async function call(db, fn, args) {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data
}

/** A small, valid one-page PDF carrying a line of text. */
function pdf(lines) {
  const text = lines.map((l, i) => `BT /F1 11 Tf 56 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

const DOC_TITLES = {
  invoice: 'Commercial invoices',
  shipping: 'CMR / bill of lading',
  dunning: 'Payment reminders and demand letter',
  insolvency_evidence: 'Court ruling on insolvency proceedings',
  contract: 'Supply contract',
}

// ---------------------------------------------------------------------------
// 1. Claims
// ---------------------------------------------------------------------------
async function claims() {
  const { sb, tci } = await signIn('demo.claims@demo.invalid')
  const { data: rows, error } = await tci
    .from('v_claims')
    .select('id, claim_number, status, cause_of_loss, buyer_name, policy_number')
    .order('claim_number')
  if (error) throw error
  const plan = {
    'Istanbul Tekstil A.Ş.': 'pay',
    'Tashkent Supermarket Chain MChJ': 'pay_and_recover',
    'Seoul Auto Parts Co., Ltd.': 'ask',
  }
  for (const c of rows) {
    if (c.status !== 'draft') {
      console.log(`claim ${c.claim_number}: already ${c.status}, skipped`)
      continue
    }
    const required = await call(tci, 'missing_claim_documents', { p_claim_id: c.id })
    for (const type of required) {
      const name = `${type}-${c.claim_number}.pdf`
      const path = `claims/${c.id}/${randomUUID()}-${name}`
      const bytes = pdf([DOC_TITLES[type] ?? type, `Claim ${c.claim_number}`, `Buyer: ${c.buyer_name}`, `Policy: ${c.policy_number}`])
      const up = await sb.storage.from('claim-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
      if (up.error) throw new Error(`upload ${name}: ${up.error.message}`)
      await call(tci, 'register_claim_document', {
        p_claim_id: c.id, p_storage_path: path, p_document_type: type, p_filename: name,
        p_size_bytes: bytes.length, p_content_type: 'application/pdf', p_note: null,
      })
    }
    await call(tci, 'change_claim_status', { p_claim_id: c.id, p_to: 'submitted', p_comment: 'Filed with the documents attached.' })
    await call(tci, 'change_claim_status', { p_claim_id: c.id, p_to: 'under_assessment', p_comment: null })
    await call(tci, 'verify_claim_coverage', { p_claim_id: c.id })
    const what = plan[c.buyer_name]
    if (what === 'ask') {
      await call(tci, 'change_claim_status', {
        p_claim_id: c.id, p_to: 'info_requested',
        p_comment: 'Please send the buyer’s written acknowledgement of the debt and the latest reconciliation statement.',
      })
    } else {
      const approved = await call(tci, 'approve_claim', { p_claim_id: c.id, p_comment: 'Cover confirmed on every invoice.' })
      const amount = Number(approved.approved_indemnity)
      const paidAt = new Date(Date.now() - 12 * 864e5).toISOString().slice(0, 10)
      await call(tci, 'record_claim_payment', { p_claim_id: c.id, p_amount: amount, p_paid_at: paidAt, p_reference: `PAY-${c.claim_number}` })
      if (what === 'pay_and_recover') {
        const recAt = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)
        await call(tci, 'record_recovery', { p_claim_id: c.id, p_gross: 600000000, p_costs: 45000000, p_received_at: recAt, p_note: 'First distribution from the insolvency estate.' })
      }
    }
    console.log(`claim ${c.claim_number} (${c.buyer_name}): ${what}`)
  }
}

// ---------------------------------------------------------------------------
// 2. Contracts through the «Договоры» screen
// ---------------------------------------------------------------------------
async function contracts() {
  let chromium
  try {
    ;({ chromium } = require('playwright'))
  } catch {
    console.log('contracts: playwright not installed in TCI_ERP, skipped')
    return
  }
  const { session } = await signIn('demo.commercial@demo.invalid')
  const ref = new URL(URL_).hostname.split('.')[0]
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(([r, s]) => {
    localStorage.setItem(`sb-${r}-auth-token`, s)
    localStorage.setItem('i18nextLng', 'ru')
  }, [ref, JSON.stringify(session)])
  const page = await ctx.newPage()
  await page.goto('http://localhost:5173/policies?view=contracts', { waitUntil: 'networkidle' })
  for (const number of ['TCI-2026-0001', 'TCI-2026-0005']) {
    const row = page.locator('tr', { hasText: number }).first()
    await row.getByRole('button', { name: 'Сформировать договор' }).click()
    const modal = page.getByRole('dialog')
    await modal.getByRole('button', { name: 'Сформировать', exact: true }).click()
    await modal.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500)
    console.log(`contract for ${number}: generated`)
  }
  await browser.close()
}

await claims()
await contracts()
