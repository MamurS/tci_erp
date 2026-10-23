/**
 * The words of the offer LETTER (the page after the cover), per document
 * language. Part of the fixed template: hash-pinned with the brochure texts
 * (tci.test.ts). Term labels are the app's own (locales policies.terms.*,
 * offers.doc.*), so a client reads in the offer what staff read on screen;
 * terminology follows the CLAUDE.md glossary (Байер / Bayer, Процент
 * покрытия, Невозмещаемые убытки (NQL), Агрегатная франшиза, Полис).
 */

import type { DocLang } from '../format'

export interface LetterTexts {
  title: string
  continued: string
  number: string
  date: string
  validUntil: string
  to: string
  registration: string
  request: string
  structure: string
  currency: string
  structures: Record<'whole_turnover' | 'key_buyers' | 'single_buyer', string>
  termsTitle: string
  insuredPercentage: string
  maxLiability: string
  premiumMultiple: (value: string) => string
  discretionaryLimit: string
  nql: string
  deductibleEachLoss: string
  aggregateFirstLoss: string
  waitingPeriod: string
  maxExtensionPeriod: string
  maxPaymentTerms: string
  declarationFrequency: string
  frequencies: Record<'monthly' | 'quarterly', string>
  premiumTitle: string
  premiumRate: string
  minimumPremium: string
  estimatedTurnover: string
  estimatedPremium: string
  premiumDue: string
  instalments: string
  instalmentsValue: (count: number, amount: string) => string
  premiumNote: string
  buyersTitle: string
  buyer: string
  country: string
  requested: string
  offered: string
  paymentTerms: string
  basis: string
  bases: Record<'approved' | 'indicative' | 'declined', string>
  noBuyers: string
  buyersFootnote: string
  contactTitle: string
  noteTitle: string
  more: string
  portal: string
}

const ruPlural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const LETTER_TEXTS: Readonly<Record<DocLang, LetterTexts>> = {
  ru: {
    title: 'Коммерческое предложение',
    continued: 'продолжение',
    number: 'Номер',
    date: 'Дата',
    validUntil: 'Действительно до',
    to: 'Кому',
    registration: 'Рег. номер',
    request: 'Заявка',
    structure: 'Структура полиса',
    currency: 'Валюта полиса',
    structures: { whole_turnover: 'Полный оборот', key_buyers: 'Ключевые байеры', single_buyer: 'Один байер' },
    termsTitle: 'Предлагаемые условия',
    insuredPercentage: 'Процент покрытия',
    maxLiability: 'Максимальный лимит ответственности',
    premiumMultiple: (v) => `${v}× премия`,
    discretionaryLimit: 'Дискреционный лимит',
    nql: 'Невозмещаемые убытки (NQL)',
    deductibleEachLoss: 'Франшиза по каждому убытку',
    aggregateFirstLoss: 'Агрегатная франшиза',
    waitingPeriod: 'Период ожидания',
    maxExtensionPeriod: 'Максимальный период пролонгации',
    maxPaymentTerms: 'Максимальная отсрочка платежа',
    declarationFrequency: 'Периодичность деклараций',
    frequencies: { monthly: 'Ежемесячно', quarterly: 'Ежеквартально' },
    premiumTitle: 'Страховая премия',
    premiumRate: 'Ставка премии (от оборота)',
    minimumPremium: 'Минимальная премия',
    estimatedTurnover: 'Ожидаемый годовой оборот',
    estimatedPremium: 'Расчётная премия от ожидаемого оборота',
    premiumDue: 'Премия к оплате за год (не ниже минимальной)',
    instalments: 'Оплата минимальной премии',
    instalmentsValue: (n, amount) => `${n} ${ruPlural(n, 'взнос', 'взноса', 'взносов')} по ${amount}`,
    premiumNote:
      'Минимальная премия оплачивается в любом случае; если премия от фактического оборота выше, разница доначисляется по итогам периода. Возврата ниже минимальной премии нет.',
    buyersTitle: 'Лимиты по байерам',
    buyer: 'Байер',
    country: 'Страна',
    requested: 'Запрошено',
    offered: 'Предлагается',
    paymentTerms: 'Отсрочка',
    basis: 'Основание',
    bases: { approved: 'Утверждено', indicative: 'Ориентировочно', declined: 'Отказано' },
    noBuyers: 'Байеры в заявку не включены.',
    buyersFootnote:
      '«Утверждено» — лимит, по которому принято решение. «Ориентировочно» — запрошенная сумма до решения по лимиту; окончательная сумма может отличаться.',
    contactTitle: 'Ваш менеджер',
    noteTitle: 'Комментарий',
    more: 'Подробные условия — на следующих страницах',
    portal: 'Принять предложение или запросить изменения можно в портале клиента.',
  },
  en: {
    title: 'Commercial offer',
    continued: 'continued',
    number: 'Number',
    date: 'Date',
    validUntil: 'Valid until',
    to: 'To',
    registration: 'Reg. number',
    request: 'Submission',
    structure: 'Policy structure',
    currency: 'Policy currency',
    structures: { whole_turnover: 'Whole turnover', key_buyers: 'Key buyers', single_buyer: 'Single buyer' },
    termsTitle: 'Proposed terms',
    insuredPercentage: 'Insured percentage',
    maxLiability: 'Maximum liability',
    premiumMultiple: (v) => `${v}× premium`,
    discretionaryLimit: 'Discretionary limit',
    nql: 'Non-qualifying loss (NQL)',
    deductibleEachLoss: 'Deductible each loss',
    aggregateFirstLoss: 'Aggregate first loss',
    waitingPeriod: 'Waiting period',
    maxExtensionPeriod: 'Maximum extension period',
    maxPaymentTerms: 'Maximum payment terms',
    declarationFrequency: 'Declaration frequency',
    frequencies: { monthly: 'Monthly', quarterly: 'Quarterly' },
    premiumTitle: 'Premium',
    premiumRate: 'Premium rate (on turnover)',
    minimumPremium: 'Minimum premium',
    estimatedTurnover: 'Estimated annual turnover',
    estimatedPremium: 'Estimated premium on the expected turnover',
    premiumDue: 'Premium payable for the year (not below the minimum)',
    instalments: 'Minimum premium payable in',
    instalmentsValue: (n, amount) => `${n} ${n === 1 ? 'instalment' : 'instalments'} of ${amount}`,
    premiumNote:
      'The minimum premium is payable in any case; if the premium earned on the actual turnover is higher, the difference is charged at the end of the period. There is no refund below the minimum premium.',
    buyersTitle: 'Buyer limits',
    buyer: 'Buyer',
    country: 'Country',
    requested: 'Requested',
    offered: 'Offered',
    paymentTerms: 'Payment terms',
    basis: 'Basis',
    bases: { approved: 'Approved', indicative: 'Indicative', declined: 'Declined' },
    noBuyers: 'No buyers are included in the submission.',
    buyersFootnote:
      '“Approved” is a limit the insurer has decided. “Indicative” is the amount requested, before the limit decision; the final amount may differ.',
    contactTitle: 'Your manager',
    noteTitle: 'Note',
    more: 'The detailed terms are on the following pages',
    portal: 'You can accept the offer or request changes in the client portal.',
  },
  uz: {
    title: 'Tijorat taklifi',
    continued: 'davomi',
    number: 'Raqam',
    date: 'Sana',
    validUntil: 'Amal qilish muddati',
    to: 'Kimga',
    registration: 'Ro‘yxat raqami',
    request: 'Ariza',
    structure: 'Polis tuzilmasi',
    currency: 'Polis valyutasi',
    structures: { whole_turnover: 'To‘liq aylanma', key_buyers: 'Asosiy bayerlar', single_buyer: 'Yagona bayer' },
    termsTitle: 'Taklif etilayotgan shartlar',
    insuredPercentage: 'Sug‘urta qoplamasi foizi',
    maxLiability: 'Javobgarlikning maksimal limiti',
    premiumMultiple: (v) => `${v}× mukofot`,
    discretionaryLimit: 'Diskretsion limit',
    nql: 'Qoplanmaydigan zarar (NQL)',
    deductibleEachLoss: 'Har bir zarar bo‘yicha franshiza',
    aggregateFirstLoss: 'Birinchi zarar bo‘yicha agregat franshiza',
    waitingPeriod: 'Kutish davri',
    maxExtensionPeriod: 'Maksimal uzaytirish davri',
    maxPaymentTerms: 'Maksimal to‘lov muddati',
    declarationFrequency: 'Deklaratsiyalar davriyligi',
    frequencies: { monthly: 'Oylik', quarterly: 'Choraklik' },
    premiumTitle: 'Sug‘urta mukofoti',
    premiumRate: 'Mukofot stavkasi (aylanmadan)',
    minimumPremium: 'Minimal mukofot',
    estimatedTurnover: 'Kutilayotgan yillik aylanma',
    estimatedPremium: 'Kutilayotgan aylanmadan hisoblangan mukofot',
    premiumDue: 'Yil uchun to‘lanadigan mukofot (minimaldan kam emas)',
    instalments: 'Minimal mukofotni to‘lash',
    instalmentsValue: (n, amount) => `${amount} dan ${n} ta badal`,
    premiumNote:
      'Minimal mukofot har qanday holatda to‘lanadi; agar haqiqiy aylanmadan hisoblangan mukofot yuqori bo‘lsa, farq davr yakunida qo‘shimcha hisoblanadi. Minimal mukofotdan past qaytarish yo‘q.',
    buyersTitle: 'Bayerlar bo‘yicha limitlar',
    buyer: 'Bayer',
    country: 'Mamlakat',
    requested: 'So‘ralgan',
    offered: 'Taklif etiladi',
    paymentTerms: 'To‘lov muddati',
    basis: 'Asos',
    bases: { approved: 'Tasdiqlangan', indicative: 'Taxminiy', declined: 'Rad etilgan' },
    noBuyers: 'Arizaga bayerlar kiritilmagan.',
    buyersFootnote:
      '«Tasdiqlangan» — qaror qabul qilingan limit. «Taxminiy» — limit bo‘yicha qarorgacha so‘ralgan summa; yakuniy summa farq qilishi mumkin.',
    contactTitle: 'Sizning menejeringiz',
    noteTitle: 'Izoh',
    more: 'Batafsil shartlar — keyingi sahifalarda',
    portal: 'Taklifni qabul qilish yoki o‘zgartirish so‘rash mijoz portalida mumkin.',
  },
}
