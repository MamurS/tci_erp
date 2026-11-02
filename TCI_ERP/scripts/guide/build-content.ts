/**
 * npm run guide:content — docs/guide/<lang>/** → src/features/help/content/<lang>.json + pages.json.
 * npm run guide:check   — the same checks without writing (exit 1 on an error).
 * Flags: --check (no writing), --quiet (no warnings), GUIDE_ALLOW_STALE=1 (old shots only warn).
 */
import path from 'node:path'
import { buildGuide, defaultPaths, writeBundles } from './content.ts'

const root = path.resolve(import.meta.dirname, '../..')
const check = process.argv.includes('--check')
const quiet = process.argv.includes('--quiet')
const p = defaultPaths(root)
const r = buildGuide(p, { allowStale: process.env.GUIDE_ALLOW_STALE === '1' })
if (!quiet) for (const w of r.problems.warnings) console.warn(`warning: ${w}`)
for (const e of r.problems.errors) console.error(`error: ${e}`)
const n = Object.keys(r.bundles.ru.topics).length
if (!check) {
  writeBundles(p, r)
  console.log(`guide: ${n} topics × 3 languages → ${path.relative(root, p.out)}/`)
}
console.log(`guide: ${r.problems.errors.length} error(s), ${r.problems.warnings.length} warning(s)`)
if (r.problems.errors.length) process.exit(1)
