/**
 * Part of npm run guide:check — type-checks the screenshot specs (e2e/guide)
 * with the e2e project (tsconfig.e2e.json); any error fails.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.e2e.json', '--noEmit', '--pretty', 'false'], { cwd: root, encoding: 'utf8' })
const errors = `${r.stdout}${r.stderr}`.split('\n').filter((l) => /\(\d+,\d+\): error/.test(l))
for (const e of errors) console.error(e)
console.log(`guide:typecheck: ${errors.length} error(s) in the e2e project`)
process.exit(errors.length ? 1 : 0)
