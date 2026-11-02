/**
 * User guide, section 01 «Getting started»: the sign-in page and the Agenda.
 * Text: docs/guide/<lang>/01-getting-started/*.md
 */
import type { ShotSpec } from '../types'

export default [
  {
    id: 'start-sign-in',
    role: null,
    path: '/login',
    crop: 'page',
    marks: [
      { n: 1, target: ({ page }) => page.locator('input[type="email"]'), kind: 'box' },
      { n: 1, target: ({ page }) => page.locator('input[autocomplete="current-password"]'), kind: 'box' },
      { n: 1, target: ({ page }) => page.locator('form button[type="submit"]'), kind: 'circle' },
    ],
    alt: {
      ru: 'Страница входа: поля «Эл. почта» и «Пароль» и кнопка «Войти»',
      en: 'The sign-in page: the Email and Password fields and the Sign in button',
      uz: 'Kirish sahifasi: elektron pochta va parol maydonlari hamda «Kirish» tugmasi',
    },
  },
  {
    id: 'start-agenda',
    role: 'credit_underwriter',
    fixture: 'credit',
    path: '/agenda',
    crop: 'page',
    alt: {
      ru: 'Повестка кредитного андеррайтера: задачи, сгруппированные по сроку',
      en: 'A credit underwriter’s Agenda: tasks grouped by due date',
      uz: 'Kredit anderrayterining kun tartibi: muddat bo‘yicha guruhlangan vazifalar',
    },
  },
] satisfies ShotSpec[]
