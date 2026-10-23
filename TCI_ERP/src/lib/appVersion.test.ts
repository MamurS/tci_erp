/**
 * "Is this tab running the deployed build?" — the decision, and the build
 * side that produces what it reads.
 */
import { describe, expect, it } from 'vitest'

import VITE_CONFIG from '../../vite.config.ts?raw'
import HEADERS from '../../public/_headers?raw'
import LAZY_PAGE from './lazyPage.ts?raw'
import LOGIN_PAGE from '../pages/LoginPage.tsx?raw'
import { CURRENT_BUILD, VERSION_FILE, isStaleBuild, parseVersionFile } from './appVersion'

describe('parseVersionFile', () => {
  it('reads the build id', () => {
    expect(parseVersionFile({ build: 'abc123' })).toBe('abc123')
  })

  it('anything else is unknown, never a build', () => {
    // the SPA fallback answers an old deploy with index.html; the JSON parse
    // fails before this, but a wrong shape must not count either
    expect(parseVersionFile(null)).toBeNull()
    expect(parseVersionFile('abc')).toBeNull()
    expect(parseVersionFile({})).toBeNull()
    expect(parseVersionFile({ build: '' })).toBeNull()
    expect(parseVersionFile({ build: 42 })).toBeNull()
  })
})

describe('isStaleBuild', () => {
  it('stale only when the server names a different build', () => {
    expect(isStaleBuild('abc', 'def')).toBe(true)
    expect(isStaleBuild('abc', 'abc')).toBe(false)
  })

  it('an unknown answer never asks for a reload', () => {
    expect(isStaleBuild('abc', null)).toBe(false)
  })


  it('unit tests run as the dev build', () => {
    expect(CURRENT_BUILD).toBe('dev')
  })
})

describe('the build and the server side', () => {
  it('the build stamps one id into the bundle and into /version.json', () => {
    expect(VITE_CONFIG).toContain("define: { __APP_BUILD__: JSON.stringify(id) }")
    expect(VITE_CONFIG).toContain(`fileName: '${VERSION_FILE.slice(1)}'`)
    expect(VITE_CONFIG).toContain('process.env.CF_PAGES_COMMIT_SHA')
  })

  it('the version file is never cached', () => {
    expect(HEADERS).toMatch(/\/version\.json\n\s+Cache-Control: no-store/)
  })

  it('a failed page chunk reloads into the new build only when one is served', () => {
    expect(LAZY_PAGE).toContain('if (await reloadIntoNewBuild())')
    expect(LAZY_PAGE).toContain('throw error')
  })

  it('the sign-in page reloads by itself only while the form is untouched', () => {
    expect(LOGIN_PAGE).toContain("const pristine = email === '' && password === '' && !submitting")
    expect(LOGIN_PAGE).toContain('if (!newVersion || !pristine) return')
    expect(LOGIN_PAGE).toContain('const offerReload = newVersion && (!pristine || reloadDeclined)')
  })
})
