/**
 * User guide, the role sections (02–09): one screen per role, from the
 * recorded demo book with «DEMO …» company names.
 * Text: docs/guide/<lang>/<NN-role>/*.md
 */
import type { ShotSpec } from '../types'

export default [
  {
    id: 'sales-submissions',
    role: 'sales',
    fixture: 'sales',
    path: '/requests',
    crop: 'page',
    alt: {
      ru: 'Заявки на страхование: очередь продаж со статусами заявок',
      en: 'Submissions: the sales queue with each submission’s status',
      uz: 'Sug‘urta arizalari: arizalar holati bilan sotuv navbati',
    },
  },
  {
    id: 'commercial-policies',
    role: 'commercial_underwriter',
    fixture: 'commercial',
    path: '/policies?view=registry',
    crop: 'page',
    alt: {
      ru: 'Полисы: реестр полисов с видами раздела',
      en: 'Policies: the policy register and the section’s views',
      uz: 'Polislar: polislar reyestri va bo‘lim ko‘rinishlari',
    },
  },
  {
    id: 'analysis-ratings',
    role: 'credit_analyst',
    fixture: 'credit',
    path: '/limits?view=ratings',
    crop: 'page',
    alt: {
      ru: 'Кредитные лимиты › Рейтинги: байеры, которым нужен рейтинг, с причиной',
      en: 'Credit limits › Ratings: the buyers that need a rating, with the reason',
      uz: 'Kredit limitlari › Reytinglar: reyting kerak bo‘lgan bayerlar va sababi',
    },
  },
  {
    id: 'credit-queue',
    role: 'credit_underwriter',
    fixture: 'credit',
    path: '/limits?view=queue',
    crop: 'page',
    alt: {
      ru: 'Очередь решений: заявки на лимиты с диапазоном рейтинга и полномочиями',
      en: 'The decision queue: limit requests with their rating band and authority',
      uz: 'Qarorlar navbati: reyting diapazoni va vakolat bilan limit so‘rovlari',
    },
  },
  {
    id: 'data-requests',
    role: 'information_manager',
    fixture: 'info',
    path: '/data',
    crop: 'page',
    alt: {
      ru: 'Управление данными: запросы на организации и отчётность',
      en: 'Data management: requests for companies and statements',
      uz: 'Ma’lumotlarni boshqarish: tashkilot va hisobot so‘rovlari',
    },
  },
  {
    id: 'claims-queue',
    role: 'claims',
    fixture: 'claims',
    path: '/claims',
    crop: 'page',
    alt: {
      ru: 'Претензии: очередь претензий по статусам',
      en: 'Claims: the claims queue by status',
      uz: 'Sug‘urta da’volari: holat bo‘yicha da’volar navbati',
    },
  },
  {
    id: 'admin-users',
    role: 'admin',
    path: '/admin',
    crop: 'page',
    alt: {
      ru: 'Администрирование: вкладки «Пользователи и роли», «Полномочия», «Безопасность»',
      en: 'Admin: the Users & roles, Authorities and Security tabs',
      uz: 'Administratsiya: «Foydalanuvchilar va rollar», «Vakolatlar», «Xavfsizlik» varaqlari',
    },
  },
  {
    id: 'portal-home',
    role: 'client',
    fixture: 'client',
    path: '/portal',
    crop: 'page',
    alt: {
      ru: 'Портал страхователя: мои полисы',
      en: 'The policyholder portal: my policies',
      uz: 'Sug‘urtalanuvchi portali: mening polislarim',
    },
  },
] satisfies ShotSpec[]
