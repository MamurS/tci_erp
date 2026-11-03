/**
 * npm run guide:shots — takes the guide's screenshots (e2e/guide/shots.spec.ts,
 * Playwright against the stubbed backend, network sealed) and records them in
 * docs/guide/shots/manifest.json with the app version (package.json) they show.
 * Extra arguments go to Playwright. GUIDE_SHOT=<regex> / GUIDE_LANGS=ru,en limit
 * the run; a full run also removes screenshots whose spec is gone.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { LANGS, SHOT_EXT, defaultPaths, imageSize, readJson, shotSpecIds, type ShotManifest } from './content.ts'
import type { Lang } from './markdown.ts'

const root = path.resolve(import.meta.dirname, '../..')
const p = defaultPaths(root)
const metaDir = path.join(root, 'test-results/guide-shots')
fs.rmSync(metaDir, { recursive: true, force: true })

const run = spawnSync('npx', ['playwright', 'test', 'e2e/guide/shots.spec.ts', '--reporter=line', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, GUIDE_SHOTS: '1' },
})

const version = readJson<{ version: string }>(p.pkg, { version: '0.0.0' }).version
const manifest = readJson<ShotManifest>(p.manifest, { shots: {} })
const takenAt = new Date().toISOString().slice(0, 10)
let n = 0
for (const f of fs.existsSync(metaDir) ? fs.readdirSync(metaDir) : []) {
  const m = JSON.parse(fs.readFileSync(path.join(metaDir, f), 'utf8')) as { id: string; lang: Lang; alt: string }
  const size = imageSize(path.join(p.shotsDir, m.lang, `${m.id}${SHOT_EXT}`))
  if (!size) continue
  const e = (manifest.shots[m.id] ??= { alt: {}, langs: {} })
  e.alt[m.lang] = m.alt
  e.langs[m.lang] = { version, takenAt, ...size }
  n++
}

// a full run: drop what no spec defines any more
const full = !process.env.GUIDE_SHOT && !process.env.GUIDE_LANGS && process.argv.length <= 2
if (full && run.status === 0) {
  const ids = shotSpecIds(p.shotSpecs)
  for (const id of Object.keys(manifest.shots)) if (!ids.has(id)) delete manifest.shots[id]
  for (const l of LANGS) {
    const dir = path.join(p.shotsDir, l)
    if (fs.existsSync(dir))
      for (const f of fs.readdirSync(dir))
        if (f.endsWith('.png') || (f.endsWith(SHOT_EXT) && !ids.has(f.slice(0, -SHOT_EXT.length)))) fs.rmSync(path.join(dir, f))
  }
}

const sorted: ShotManifest = { shots: Object.fromEntries(Object.entries(manifest.shots).sort(([a], [b]) => a.localeCompare(b))) }
fs.mkdirSync(p.shotsDir, { recursive: true })
fs.writeFileSync(p.manifest, `${JSON.stringify(sorted, null, 1)}\n`)
console.log(`guide:shots: ${n} screenshot(s) recorded for v${version}`)
process.exit(run.status ?? 1)
