/**
 * Browser tests (e2e/). The app runs against a stubbed Supabase
 * (e2e/support/stub.ts): no credentials, no network, nothing written.
 *
 *   npm run test:e2e
 *
 * Locally, point PW_CHROMIUM_PATH at an installed Chromium instead of
 * downloading one (in this repo's cloud sessions: /opt/pw-browsers/…/chrome).
 * CI installs Playwright's own (`npx playwright install --with-deps chromium`).
 */

import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const executablePath = process.env.PW_CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://stub.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'stub-anon-key',
      VITE_ANALYTICS_API_URL: '',
    },
  },
})
