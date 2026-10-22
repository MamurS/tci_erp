/**
 * The PasswordInput toggle: its state, its labels in three languages, and
 * the rule that it is the ONLY password control in the app.
 */
import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import {
  CAPS_LOCK_HINT_KEY,
  REVEAL_LABEL_KEYS,
  initialReveal,
  isRevealed,
  revealView,
  showCapsLockHint,
  toggleReveal,
} from './passwordReveal'

const SOURCES = import.meta.glob(['../../**/*.tsx', '!../../**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function lookup(locale: unknown, path: string): unknown {
  let node = locale
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

describe('password reveal state', () => {
  it('starts hidden', () => {
    expect(isRevealed(initialReveal(0), 0)).toBe(false)
    expect(revealView(false)).toEqual({
      type: 'password',
      pressed: false,
      labelKey: 'auth.showPassword',
    })
  })

  it('toggles between shown and hidden', () => {
    const shown = toggleReveal(initialReveal(undefined), undefined)
    expect(isRevealed(shown, undefined)).toBe(true)
    expect(revealView(true)).toEqual({ type: 'text', pressed: true, labelKey: 'auth.hidePassword' })
    expect(isRevealed(toggleReveal(shown, undefined), undefined)).toBe(false)
  })

  it('hides again once the form moves the reset key on (a successful submit)', () => {
    const shown = toggleReveal(initialReveal(0), 0)
    expect(isRevealed(shown, 0)).toBe(true)
    expect(isRevealed(shown, 1)).toBe(false)
    // The next click after the reset shows it again, under the new key.
    const again = toggleReveal(shown, 1)
    expect(isRevealed(again, 1)).toBe(true)
  })

  it('a disabled field is hidden and does not toggle', () => {
    const shown = toggleReveal(initialReveal(0), 0)
    expect(isRevealed(shown, 0, true)).toBe(false)
    expect(toggleReveal(initialReveal(0), 0, true)).toEqual(initialReveal(0))
  })
})

describe('password reveal labels', () => {
  const expected = {
    en: { show: 'Show password', hide: 'Hide password' },
    ru: { show: 'Показать пароль', hide: 'Скрыть пароль' },
    // U+2018 in «ko‘rsatish», as everywhere in the uz locale.
    uz: { show: 'Parolni ko‘rsatish', hide: 'Parolni yashirish' },
  } as const

  for (const [lang, locale] of [
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ] as const) {
    it(`exist in ${lang}`, () => {
      expect(lookup(locale, REVEAL_LABEL_KEYS.show)).toBe(expected[lang].show)
      expect(lookup(locale, REVEAL_LABEL_KEYS.hide)).toBe(expected[lang].hide)
    })
  }
})

describe('Caps Lock hint', () => {
  it('shows only while the field has focus and Caps Lock is on', () => {
    expect(showCapsLockHint(true, true)).toBe(true)
    expect(showCapsLockHint(true, false)).toBe(false)
    // A field you are not typing in never warns, and blur takes it away.
    expect(showCapsLockHint(false, true)).toBe(false)
    expect(showCapsLockHint(false, false)).toBe(false)
  })

  const expected = {
    en: 'Caps Lock is on',
    ru: 'Включён Caps Lock',
    uz: 'Caps Lock yoqilgan',
  } as const
  for (const [lang, locale] of [
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ] as const) {
    it(`is translated in ${lang}`, () => {
      expect(lookup(locale, CAPS_LOCK_HINT_KEY)).toBe(expected[lang])
    })
  }
})

describe('one password control', () => {
  const files = Object.entries(SOURCES).filter(([path]) => !path.endsWith('/PasswordInput.tsx'))

  it('scans the application', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('no screen renders its own type="password" field', () => {
    const offenders = files
      .filter(([, text]) => /type=(?:"password"|'password'|\{\s*['"]password['"]\s*\})/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('every password autocomplete sits on a PasswordInput', () => {
    const offenders: string[] = []
    let found = 0
    for (const [path, text] of files) {
      for (const m of text.matchAll(/autoComplete=["'](?:current|new)-password["']/g)) {
        found++
        // The element the attribute belongs to: the nearest opening tag before it.
        const tag = [...text.slice(0, m.index).matchAll(/<([A-Za-z]\w*)/g)].at(-1)?.[1]
        if (tag !== 'PasswordInput') offenders.push(`${path}: <${tag}>`)
      }
    }
    // Sign-in, and the new + confirmation fields of «Сменить пароль».
    expect(found).toBeGreaterThanOrEqual(3)
    expect(offenders).toEqual([])
  })
})
