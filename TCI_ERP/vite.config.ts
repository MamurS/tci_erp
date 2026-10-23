import { execSync } from 'node:child_process'

import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The build's identity, so a tab left open across a deploy can tell that it
 * runs old code (src/lib/appVersion.ts). Cloudflare Pages gives the commit;
 * a local build asks git; `vite dev` is always "dev" and emits no file.
 */
function buildId(command: 'build' | 'serve'): string {
  if (command === 'serve') return 'dev'
  const fromPages = process.env.CF_PAGES_COMMIT_SHA
  if (fromPages) return fromPages
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return `local-${Date.now()}`
  }
}

/** Stamps the build id into the bundle (`__APP_BUILD__`) and next to it
 * (`/version.json`), which a running tab re-reads to compare. */
function appVersion(): Plugin {
  let id = 'dev'
  return {
    name: 'tci-app-version',
    config(_config, { command }) {
      id = buildId(command)
      return { define: { __APP_BUILD__: JSON.stringify(id) } }
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: id }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), appVersion()],
  // The standard wording templates ship as .docx assets (src/features/wording/defaults).
  assetsInclude: ['**/*.docx'],
})
