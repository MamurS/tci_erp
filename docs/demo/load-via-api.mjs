// Load the demo companies, statements and ratings through the API, as the
// demo users, exactly as the screens write them: the information manager
// enters companies and statements, the credit underwriter stores each rating
// the analytics service produced (RatingTab.tsx does the same insert).
//
// The alternative to the generated block of demo-seed.sql when the SQL file
// cannot be run in one piece (the MCP tooling carries ~60 KB at a time).
//
//   cd services/analytics && DATA_JSON=/tmp/demo-data.json DEMO_HASH=… \
//     uv run python ../../docs/demo/build_demo_seed.py
//   SUPABASE_ANON_KEY=… DEMO_PASSWORD=… node docs/demo/load-via-api.mjs /tmp/demo-data.json

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../TCI_ERP/', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const env = Object.fromEntries(
  readFileSync(new URL('../../TCI_ERP/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const URL_ = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
const PASSWORD = process.env.DEMO_PASSWORD
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'))

async function signIn(email) {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  await sb.schema('tci').rpc('login_begin', { p_email: email })
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`${email}: ${error.message}`)
  return sb.schema('tci')
}

async function insert(db, table, rows) {
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 50))
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

const ago = (days) => new Date(Date.now() - days * 864e5).toISOString()

const info = await signIn('demo.info@demo.invalid')
await insert(info, 'legal_entities', data.entities.map(({ days_ago, ...e }) => ({ ...e, created_at: ago(days_ago) })))
await insert(info, 'financial_statements', data.statements.map((s) => s.row))
await insert(info, 'balance_sheets', data.statements.map((s) => ({ statement_id: s.row.id, ...s.bs })))
await insert(info, 'income_statements', data.statements.map((s) => ({ statement_id: s.row.id, ...s.inc })))
console.log(`companies ${data.entities.length}, statements ${data.statements.length}`)

const credit = await signIn('demo.credit@demo.invalid')
await insert(credit, 'credit_assessments', data.assessments.map(({ days_ago, ...a }) => ({ ...a, created_at: ago(days_ago) })))
console.log(`ratings ${data.assessments.length}`)
