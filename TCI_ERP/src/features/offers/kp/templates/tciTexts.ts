/**
 * The words of the TCI brochure — FIXED and APPROVED («как в ДМС»): staff
 * change the offer's parameters, never these texts. The SHA-256 of this
 * object is pinned in tci.test.ts; a change to any word fails that test until
 * the hash is updated deliberately, in the same commit, with the reason.
 *
 * Source. Every statement below is quoted from the approved brochure text in
 * src/features/brochure/defaultContent.ts (the statements listed in
 * docs/BROCHURE-CLAIMS.md); tciTexts.test.ts proves each one is a verbatim
 * quote of that file in the same language. What is NOT a statement — page
 * headings, card captions, the header's «Questions? Call us», the diagram's
 * labels, the legal line — is listed in LABEL_FIELDS of that test.
 *
 * Left out on purpose: the two statements marked ⚠ in BROCHURE-CLAIMS.md
 * (#14 disputed amounts are not covered until the dispute is resolved; #18
 * collection support when a payment is overdue). They describe something the
 * system does not model and the owner has not confirmed them. The benefit
 * that carried #18 keeps only its approved half (#19, subrogation).
 *
 * No statistics, percentages, partner names, ratings, awards, phone numbers
 * or e-mails: the insurer's contacts come from the offer's data at render
 * time, escaped. Text marked **…** is set in bold; nothing else is markup.
 *
 * Terminology (CLAUDE.md glossary): Байер / Bayer, Страхователь /
 * Sug‘urtalanuvchi, Страховщик / Sug‘urtalovchi, Процент покрытия,
 * невозмещаемые убытки (NQL) / qoplanmaydigan zarar (NQL), Претензия / da’vo,
 * Полис, qaltislik, Diskretsion limit, xabarnoma; uz o‘ g‘ with U+2018, the
 * glottal stop with U+2019.
 */

import type { DocLang } from '../format'

export { TCI_BROCHURE_VERSION } from './version'

export interface TciTexts {
  header: { call: string; write: string; label: string }
  cover: { kicker: string; titleA: string; titleB: string; preparedFor: string }
  what: {
    title: string
    paragraphs: string[]
    benefitsTitle: string
    benefits: string[]
    termsTitle: string
    terms: string
    termChips: string[]
    quote: string
  }
  how: {
    title: string
    lead: string
    diagram: {
      insurer: string
      insurerSub: string
      policyholder: string
      policyholderSub: string
      buyer: string
      buyerSub: string
      sells: string
      pays: string
      premium: string
      cover: string
      monitoring: string
    }
    steps: string[]
  }
  covered: {
    title: string
    lead: string
    events: string[]
    indemnityTitle: string
    indemnity: string[]
    notCoveredTitle: string
    notCovered: string[]
    closing: string
  }
  benefits: { title: string; items: { title: string; text: string }[] }
  limits: {
    title: string
    definition: string[]
    stepsTitle: string
    steps: string[]
    dlTitle: string
    dl: string
  }
  process: { title: string; lead: string; steps: { title: string; text: string }[] }
  faq: { title: string; items: { q: string; a: string }[] }
  contacts: {
    title: string
    paragraphs: string[]
    labels: { phone: string; email: string; website: string; address: string; manager: string }
  }
  legal: string
}

export const TCI_TEXTS: Readonly<Record<DocLang, TciTexts>> = {
  ru: {
    header: { call: 'Вопросы? Звоните:', write: 'Пишите:', label: 'Страхование торговых кредитов' },
    cover: {
      kicker: 'Коммерческое предложение',
      titleA: 'Страхование торговых кредитов',
      titleB: 'защищает вашу дебиторскую задолженность.',
      preparedFor: 'Подготовлено для',
    },
    what: {
      title: 'Что такое страхование торговых кредитов',
      paragraphs: [
        'Страхование торговых кредитов защищает вашу дебиторскую задолженность. Когда вы поставляете товары или оказываете услуги с отсрочкой платежа, вы фактически кредитуете своего контрагента — байера. Если байер не заплатит, страховщик возместит вам застрахованную часть убытка.',
        'Полис заключается между вашей компанией — страхователем — и страховщиком. Страховщик оценивает финансовое положение ваших байеров, устанавливает на каждого из них кредитный лимит и следит за ними весь срок действия полиса.',
      ],
      benefitsTitle: 'Что это даёт вашей компании',
      benefits: [
        'Вы продаёте с отсрочкой платежа увереннее: риск неоплаты оценён и застрахован.',
        'Решения о работе с новыми байерами опираются на независимую оценку их платёжеспособности.',
      ],
      termsTitle: 'Условия страхования',
      terms:
        'Условия страхования — процент покрытия, порог невозмещаемых убытков (NQL), франшиза и максимальный лимит ответственности — указываются в вашем полисе.',
      termChips: ['Процент покрытия', 'Невозмещаемые убытки (NQL)', 'Франшиза', 'Максимальный лимит ответственности'],
      quote: 'Если байер не заплатит, страховщик возместит вам застрахованную часть убытка.',
    },
    how: {
      title: 'Как это работает',
      lead: 'В страховании участвуют три стороны: ваша компания (страхователь), ваш контрагент, которому вы продаёте с отсрочкой платежа (байер), и страховщик.',
      diagram: {
        insurer: 'Страховщик',
        insurerSub: 'страховая компания',
        policyholder: 'Страхователь',
        policyholderSub: 'ваша компания, продавец',
        buyer: 'Байер',
        buyerSub: 'ваш контрагент-дебитор',
        sells: 'Поставка с отсрочкой платежа',
        pays: 'Оплата в срок',
        premium: 'Страховая премия',
        cover: 'Страховое покрытие и кредитные лимиты',
        monitoring: 'Мониторинг и кредитные лимиты',
      },
      steps: [
        'Вы отгружаете товар байеру с отсрочкой платежа — в пределах кредитного лимита, установленного на этого байера.',
        'Вы уплачиваете страховщику страховую премию; страховщик предоставляет страховое покрытие и устанавливает кредитные лимиты на ваших байеров.',
        'Страховщик следит за финансовым положением байеров и при необходимости пересматривает лимиты.',
        'Если байер не платит в срок, вы направляете уведомление о просрочке, а при наступлении страхового случая — претензию о выплате страхового возмещения.',
      ],
    },
    covered: {
      title: 'Что покрывает страхование',
      lead: 'Страхование покрывает неоплату по поставкам, совершённым в период действия полиса в пределах кредитного лимита, если она вызвана одним из двух событий.',
      events: [
        '**Длительная просрочка платежа:** байер не оплатил долг в течение срока, установленного полисом, после наступления срока платежа.',
        '**Несостоятельность (банкротство) байера**, установленная в порядке, предусмотренном законом.',
      ],
      indemnityTitle: 'Размер возмещения',
      indemnity: [
        'Страховщик возмещает убыток в пределах процента покрытия, за вычетом франшизы и в пределах максимального лимита ответственности.',
        'Убыток ниже порога невозмещаемых убытков (NQL) не возмещается.',
      ],
      notCoveredTitle: 'Как правило, не покрываются',
      notCovered: [
        'Поставки сверх кредитного лимита или вне периода действия полиса',
        'Отсрочка платежа длиннее максимальной, установленной полисом',
      ],
      closing: 'Точный объём покрытия и исключения определяются условиями вашего полиса.',
    },
    benefits: {
      title: 'Преимущества для вашего бизнеса',
      items: [
        {
          title: 'Защищённая дебиторская задолженность',
          text: 'Неоплата застрахованных поставок не ложится целиком на ваш оборотный капитал.',
        },
        {
          title: 'Финансирование под застрахованную дебиторскую задолженность',
          text: 'Застрахованная дебиторская задолженность может служить дополнительным обеспечением при банковском финансировании или факторинге; решение и условия определяет финансирующая организация.',
        },
        {
          title: 'Мониторинг байеров',
          text: 'Страховщик следит за финансовым положением ваших байеров и сообщает вам, когда лимит меняется.',
        },
        {
          title: 'Уверенный рост продаж',
          text: 'Вы можете предлагать отсрочку платежа новым байерам, опираясь на независимую оценку их кредитоспособности.',
        },
        {
          title: 'Суброгация',
          text: 'После выплаты страхового возмещения страховщик продолжает взыскание в порядке суброгации.',
        },
      ],
    },
    limits: {
      title: 'Как работают кредитные лимиты',
      definition: [
        'Кредитный лимит — это наибольшая сумма неоплаченной задолженности байера перед вами, которая застрахована в каждый момент времени.',
        'Лимит устанавливается на каждого байера отдельно.',
      ],
      stepsTitle: 'Как устанавливается лимит',
      steps: [
        'Вы запрашиваете лимит на байера через портал или у своего менеджера по продажам.',
        'Страховщик анализирует финансовую отчётность байера и другую доступную информацию и принимает решение: одобрить лимит полностью, одобрить его в меньшей сумме или отказать.',
        'Лимит может сопровождаться условиями, например максимальной отсрочкой платежа.',
        'Лимит действует, пока он не изменён или не отозван. Если финансовое положение байера ухудшается, страховщик может уменьшить или отозвать лимит; поставки, совершённые до этого, остаются застрахованными в пределах лимита, действовавшего на дату отгрузки.',
      ],
      dlTitle: 'Дискреционный лимит',
      dl: 'Дискреционный лимит — сумма, в пределах которой вы можете сами оценивать байеров на условиях вашего полиса, не запрашивая отдельного лимита.',
    },
    process: {
      title: 'От заявки до полиса',
      lead: 'Путь от первой заявки до действующего полиса состоит из нескольких шагов.',
      steps: [
        {
          title: 'Заявка',
          text: 'Вы или ваш менеджер по продажам оформляете заявку на страхование: сведения о вашей компании, обороте и байерах, на которых нужны лимиты.',
        },
        {
          title: 'Андеррайтинг',
          text: 'Страховщик оценивает ваших байеров и устанавливает кредитные лимиты, а также рассчитывает условия страхования: ставку премии, процент покрытия, франшизу и другие условия.',
        },
        {
          title: 'Коммерческое предложение',
          text: 'Вы получаете предложение с условиями и решениями по лимитам и можете принять его, запросить изменения или отказаться.',
        },
        {
          title: 'Полис',
          text: 'После вашего согласия заключается полис; лимиты, согласованные в заявке, начинают действовать по полису.',
        },
        {
          title: 'Работа по полису',
          text: 'Через портал вы подаёте декларации оборота, запрашиваете новые лимиты, сообщаете о просрочках и подаёте претензии.',
        },
      ],
    },
    faq: {
      title: 'Частые вопросы',
      items: [
        {
          q: 'Нужно ли страховать всех моих байеров?',
          a: 'Это зависит от структуры полиса. Полис на весь оборот охватывает всех байеров в его рамках, полис по ключевым байерам — только указанных в нём. Структуру предложит ваш менеджер по продажам с учётом особенностей вашего бизнеса.',
        },
        {
          q: 'Что будет, если страховщик отказал в лимите на байера?',
          a: 'Поставки этому байеру не застрахованы, за исключением случаев, когда они укладываются в дискреционный лимит на условиях полиса. Вы можете запросить лимит повторно, когда появится новая финансовая информация о байере.',
        },
        {
          q: 'Может ли лимит измениться во время действия полиса?',
          a: 'Да. Страховщик пересматривает лимиты при изменении финансового положения байера. Поставки, совершённые до изменения, остаются застрахованными в пределах лимита, действовавшего на дату отгрузки.',
        },
        {
          q: 'Что делать, если байер не заплатил в срок?',
          a: 'Направьте уведомление о просрочке через портал в срок, установленный полисом, и продолжайте работу по взысканию долга. Своевременное уведомление — одно из условий страхового покрытия.',
        },
        {
          q: 'Когда подаётся претензия?',
          a: 'Когда наступил страховой случай: истёк установленный полисом период ожидания по длительной просрочке или байер признан несостоятельным. Претензия подаётся через портал вместе с подтверждающими документами.',
        },
        {
          q: 'Как рассчитывается страховая премия?',
          a: 'Премия рассчитывается по ставке, установленной полисом, от застрахованного оборота, который вы декларируете; полис также устанавливает минимальную премию. Конкретные условия указываются в коммерческом предложении и в полисе.',
        },
      ],
    },
    contacts: {
      title: 'Как с нами связаться',
      paragraphs: [
        'Чтобы обсудить страхование, запросить лимит или задать вопрос по вашему полису, обратитесь к своему менеджеру по продажам — он сопровождает вас на всех этапах: от заявки до работы по действующему полису.',
        'Если у вас есть доступ к порталу для клиентов, там вы можете следить за своими заявками, лимитами, декларациями и претензиями, а также отвечать на коммерческие предложения.',
      ],
      labels: { phone: 'Телефон', email: 'E-mail', website: 'Сайт', address: 'Адрес', manager: 'Ваш менеджер' },
    },
    legal: 'Материал носит информационный характер. Точный объём покрытия и исключения определяются условиями вашего полиса.',
  },

  en: {
    header: { call: 'Questions? Call us:', write: 'Email us:', label: 'Trade credit insurance' },
    cover: {
      kicker: 'Commercial offer',
      titleA: 'Trade credit insurance',
      titleB: 'protects your receivables.',
      preparedFor: 'Prepared for',
    },
    what: {
      title: 'What trade credit insurance is',
      paragraphs: [
        'Trade credit insurance protects your receivables. Whenever you deliver goods or services on deferred payment terms, you are in effect lending to your customer — the buyer. If the buyer does not pay, the insurer indemnifies you for the insured share of the loss.',
        'The policy is concluded between your company — the policyholder — and the insurer. The insurer assesses the financial standing of your buyers, sets a credit limit on each of them and keeps them under watch for as long as the policy runs.',
      ],
      benefitsTitle: 'What it gives your company',
      benefits: [
        'You can sell on credit with more confidence: the risk of non-payment is assessed and insured.',
        'Decisions about new buyers rest on an independent assessment of their creditworthiness.',
      ],
      termsTitle: 'Terms of cover',
      terms:
        'The terms of cover — the insured percentage, the non-qualifying loss (NQL) threshold, the deductible and the maximum liability — are set out in your policy.',
      termChips: ['Insured percentage', 'Non-qualifying loss (NQL)', 'Deductible', 'Maximum liability'],
      quote: 'If the buyer does not pay, the insurer indemnifies you for the insured share of the loss.',
    },
    how: {
      title: 'How it works',
      lead: 'Three parties take part: your company (the policyholder), the customer you sell to on credit (the buyer) and the insurer.',
      diagram: {
        insurer: 'Insurer',
        insurerSub: 'the credit insurer',
        policyholder: 'Policyholder',
        policyholderSub: 'your company, the seller',
        buyer: 'Buyer',
        buyerSub: 'your customer, the debtor',
        sells: 'Delivery on credit terms',
        pays: 'Payment when due',
        premium: 'Premium',
        cover: 'Cover and credit limits',
        monitoring: 'Monitoring and credit limits',
      },
      steps: [
        'You deliver to the buyer on deferred payment terms, within the credit limit set on that buyer.',
        'You pay the insurer a premium; the insurer provides cover and sets credit limits on your buyers.',
        'The insurer monitors your buyers’ financial standing and reviews their limits when it changes.',
        'If a buyer does not pay on time, you send an overdue notification; once an insured event occurs, you file a claim for indemnity.',
      ],
    },
    covered: {
      title: 'What is covered',
      lead: 'The insurance covers non-payment for deliveries made during the policy period within the credit limit, when it is caused by one of two events.',
      events: [
        '**Protracted default:** the buyer has not paid within the period set by the policy after the payment fell due.',
        '**Insolvency of the buyer**, established as the law provides.',
      ],
      indemnityTitle: 'How much is indemnified',
      indemnity: [
        'The insurer indemnifies the loss up to the insured percentage, less the deductible and within the maximum liability.',
        'A loss below the non-qualifying loss (NQL) threshold is not indemnified.',
      ],
      notCoveredTitle: 'As a rule, the following are not covered',
      notCovered: [
        'Deliveries above the credit limit or outside the policy period',
        'Payment terms longer than the maximum the policy allows',
      ],
      closing: 'The exact scope of cover and the exclusions are those of your policy.',
    },
    benefits: {
      title: 'Benefits for your business',
      items: [
        {
          title: 'Secure receivables',
          text: 'Non-payment on insured deliveries does not fall on your working capital alone.',
        },
        {
          title: 'Financing against insured receivables',
          text: 'Insured receivables can serve as additional security for bank financing or factoring; the decision and its terms are the financing institution’s.',
        },
        {
          title: 'Buyer monitoring',
          text: 'The insurer watches your buyers’ financial standing and lets you know when a limit changes.',
        },
        {
          title: 'Confident growth',
          text: 'You can offer payment terms to new buyers on the strength of an independent assessment of their creditworthiness.',
        },
        {
          title: 'Subrogation',
          text: 'Once the indemnity is paid, the insurer pursues the debt by subrogation.',
        },
      ],
    },
    limits: {
      title: 'How credit limits work',
      definition: [
        'A credit limit is the largest amount of the buyer’s unpaid debt to you that is insured at any one time.',
        'A limit is set on each buyer separately.',
      ],
      stepsTitle: 'How a limit is set',
      steps: [
        'You request a limit on a buyer through the portal or from your sales manager.',
        'The insurer analyses the buyer’s financial statements and other available information, and decides: approve the limit in full, approve a smaller amount, or decline.',
        'A limit may come with conditions, such as a maximum payment term.',
        'A limit stays in force until it is changed or revoked. If the buyer’s financial standing deteriorates, the insurer may reduce or revoke the limit; deliveries made before that remain insured within the limit that was in force on the shipment date.',
      ],
      dlTitle: 'Discretionary limit',
      dl: 'The discretionary limit is the amount up to which you may assess buyers yourself, on the terms of your policy, without requesting a separate limit.',
    },
    process: {
      title: 'From request to policy',
      lead: 'The way from a first request to a policy in force has a few steps.',
      steps: [
        {
          title: 'Request',
          text: 'You or your sales manager prepare an insurance request: details of your company, your turnover and the buyers you need limits on.',
        },
        {
          title: 'Underwriting',
          text: 'The insurer assesses your buyers and sets credit limits, and works out the terms of cover: the premium rate, the insured percentage, the deductible and the other terms.',
        },
        {
          title: 'Commercial offer',
          text: 'You receive an offer with the terms and the limit decisions, and can accept it, ask for changes or decline it.',
        },
        {
          title: 'Policy',
          text: 'Once you accept, the policy is concluded; the limits agreed in the request take effect under the policy.',
        },
        {
          title: 'Day to day',
          text: 'Through the portal you submit turnover declarations, request new limits, report overdue accounts and file claims.',
        },
      ],
    },
    faq: {
      title: 'Frequently asked questions',
      items: [
        {
          q: 'Do I have to insure all my buyers?',
          a: 'That depends on how the policy is structured. A whole-turnover policy covers all buyers within its scope; a key-buyer policy covers only the buyers named in it. Your sales manager will suggest the structure that suits your business.',
        },
        {
          q: 'What happens if the insurer declines a limit on a buyer?',
          a: 'Deliveries to that buyer are not insured, except where they fall within the discretionary limit on the terms of the policy. You can request a limit again when new financial information on the buyer becomes available.',
        },
        {
          q: 'Can a limit change while the policy runs?',
          a: 'Yes. The insurer reviews limits when a buyer’s financial standing changes. Deliveries made before the change remain insured within the limit that was in force on the shipment date.',
        },
        {
          q: 'What should I do if a buyer has not paid on time?',
          a: 'Send an overdue notification through the portal within the period the policy sets, and keep pursuing the debt. Notifying on time is one of the conditions of cover.',
        },
        {
          q: 'When is a claim filed?',
          a: 'When an insured event has occurred: the waiting period for protracted default set by the policy has passed, or the buyer has been declared insolvent. The claim is filed through the portal together with the supporting documents.',
        },
        {
          q: 'How is the premium calculated?',
          a: 'The premium is the rate set by the policy applied to the insured turnover you declare; the policy also sets a minimum premium. The exact terms are stated in the commercial offer and in the policy.',
        },
      ],
    },
    contacts: {
      title: 'How to reach us',
      paragraphs: [
        'To discuss insurance, request a limit or ask about your policy, contact your sales manager, who accompanies you at every stage — from the request to day-to-day work under a policy in force.',
        'If you have access to the client portal, you can follow your requests, limits, declarations and claims there, and answer commercial offers.',
      ],
      labels: { phone: 'Phone', email: 'Email', website: 'Website', address: 'Address', manager: 'Your manager' },
    },
    legal: 'For information only. The exact scope of cover and the exclusions are those of your policy.',
  },

  uz: {
    header: { call: 'Savollar bormi? Qo‘ng‘iroq qiling:', write: 'Yozing:', label: 'Savdo kreditlarini sug‘urtalash' },
    cover: {
      kicker: 'Tijorat taklifi',
      titleA: 'Savdo kreditlarini sug‘urtalash',
      titleB: 'debitorlik qarzlaringizni himoya qiladi.',
      preparedFor: 'Kim uchun tayyorlangan',
    },
    what: {
      title: 'Savdo kreditlarini sug‘urtalash nima',
      paragraphs: [
        'Savdo kreditlarini sug‘urtalash debitorlik qarzlaringizni himoya qiladi. Tovarlarni yetkazib berganingizda yoki xizmat ko‘rsatganingizda to‘lovni kechiktirib bersangiz, siz aslida kontragentingizga — bayerga kredit berasiz. Agar bayer to‘lamasa, sug‘urtalovchi zararning sug‘urtalangan qismini qoplab beradi.',
        'Polis sizning kompaniyangiz — sug‘urtalanuvchi — va sug‘urtalovchi o‘rtasida tuziladi. Sug‘urtalovchi bayerlaringizning moliyaviy holatini baholaydi, ularning har biriga kredit limitini belgilaydi va polis amal qiladigan butun muddat davomida ularni kuzatib boradi.',
      ],
      benefitsTitle: 'Bu kompaniyangizga nima beradi',
      benefits: [
        'Kechiktirilgan to‘lov sharti bilan ishonchliroq sotasiz: to‘lanmaslik qaltisligi baholangan va sug‘urtalangan.',
        'Yangi bayerlar bilan ishlash bo‘yicha qarorlar ularning to‘lov qobiliyatini mustaqil baholashga asoslanadi.',
      ],
      termsTitle: 'Sug‘urta shartlari',
      terms:
        'Sug‘urta shartlari — sug‘urta qoplamasi foizi, qoplanmaydigan zarar (NQL) chegarasi, franshiza va javobgarlikning maksimal limiti — polisingizda ko‘rsatiladi.',
      termChips: ['Sug‘urta qoplamasi foizi', 'Qoplanmaydigan zarar (NQL)', 'Franshiza', 'Javobgarlikning maksimal limiti'],
      quote: 'Agar bayer to‘lamasa, sug‘urtalovchi zararning sug‘urtalangan qismini qoplab beradi.',
    },
    how: {
      title: 'Bu qanday ishlaydi',
      lead: 'Sug‘urtada uch tomon ishtirok etadi: sizning kompaniyangiz (sug‘urtalanuvchi), siz to‘lovni kechiktirish sharti bilan sotadigan kontragentingiz (bayer) va sug‘urtalovchi.',
      diagram: {
        insurer: 'Sug‘urtalovchi',
        insurerSub: 'sug‘urta kompaniyasi',
        policyholder: 'Sug‘urtalanuvchi',
        policyholderSub: 'kompaniyangiz, sotuvchi',
        buyer: 'Bayer',
        buyerSub: 'debitor kontragentingiz',
        sells: 'To‘lovni kechiktirish sharti bilan yetkazib berish',
        pays: 'Muddatida to‘lov',
        premium: 'Sug‘urta mukofoti',
        cover: 'Sug‘urta qoplamasi va kredit limitlari',
        monitoring: 'Monitoring va kredit limitlari',
      },
      steps: [
        'Siz bayerga tovarni to‘lovni kechiktirish sharti bilan, ushbu bayerga belgilangan kredit limiti doirasida jo‘natasiz.',
        'Siz sug‘urtalovchiga sug‘urta mukofotini to‘laysiz; sug‘urtalovchi sug‘urta qoplamasini beradi va bayerlaringizga kredit limitlarini belgilaydi.',
        'Sug‘urtalovchi bayerlarning moliyaviy holatini kuzatib boradi va zarur bo‘lganda limitlarni qayta ko‘rib chiqadi.',
        'Agar bayer o‘z vaqtida to‘lamasa, siz muddati o‘tganlik haqida xabarnoma yuborasiz, sug‘urta hodisasi yuz berganda esa sug‘urta tovonini to‘lash to‘g‘risida da’vo topshirasiz.',
      ],
    },
    covered: {
      title: 'Sug‘urta nimani qoplaydi',
      lead: 'Sug‘urta polis amal qilgan davrda kredit limiti doirasida amalga oshirilgan yetkazib berishlar bo‘yicha to‘lanmaslikni, agar u ikki hodisadan biri sababli yuz bergan bo‘lsa, qoplaydi.',
      events: [
        '**Uzoq muddatli to‘lamaslik:** to‘lov muddati kelgandan keyin bayer qarzni polisda belgilangan muddat ichida to‘lamagan.',
        'Bayerning qonunda belgilangan tartibda aniqlangan **to‘lovga qobiliyatsizligi (bankrotligi)**.',
      ],
      indemnityTitle: 'Sug‘urta tovoni miqdori',
      indemnity: [
        'Sug‘urtalovchi zararni sug‘urta qoplamasi foizi doirasida, franshiza chegirilgan holda va javobgarlikning maksimal limiti doirasida qoplaydi.',
        'Qoplanmaydigan zarar (NQL) chegarasidan kam bo‘lgan zarar qoplanmaydi.',
      ],
      notCoveredTitle: 'Odatda quyidagilar qoplanmaydi',
      notCovered: [
        'Kredit limitidan ortiq yoki polis amal qilish davridan tashqari yetkazib berishlar',
        'Polisda belgilangan maksimal muddatdan uzoqroq to‘lov kechiktirilishi',
      ],
      closing: 'Qoplamaning aniq hajmi va istisnolar polisingiz shartlari bilan belgilanadi.',
    },
    benefits: {
      title: 'Biznesingiz uchun afzalliklar',
      items: [
        {
          title: 'Himoyalangan debitorlik qarzlari',
          text: 'Sug‘urtalangan yetkazib berishlar bo‘yicha to‘lanmaslik butunlay aylanma mablag‘laringiz zimmasiga tushmaydi.',
        },
        {
          title: 'Sug‘urtalangan debitorlik qarzlari evaziga moliyalashtirish',
          text: 'Sug‘urtalangan debitorlik qarzlari bank moliyalashtiruvi yoki faktoring uchun qo‘shimcha ta’minot bo‘lib xizmat qilishi mumkin; qaror va shartlarni moliyalashtiruvchi tashkilot belgilaydi.',
        },
        {
          title: 'Bayerlar monitoringi',
          text: 'Sug‘urtalovchi bayerlaringizning moliyaviy holatini kuzatib boradi va limit o‘zgarganda sizni xabardor qiladi.',
        },
        {
          title: 'Ishonchli o‘sish',
          text: 'Yangi bayerlarga ularning kreditga layoqatliligini mustaqil baholash asosida to‘lovni kechiktirish imkonini taklif qilishingiz mumkin.',
        },
        {
          title: 'Subrogatsiya',
          text: 'Sug‘urta tovoni to‘langandan keyin sug‘urtalovchi qarzni subrogatsiya tartibida undirishni davom ettiradi.',
        },
      ],
    },
    limits: {
      title: 'Kredit limitlari qanday ishlaydi',
      definition: [
        'Kredit limiti — bayerning sizga bo‘lgan to‘lanmagan qarzining istalgan paytda sug‘urtalangan eng katta summasi.',
        'Limit har bir bayerga alohida belgilanadi.',
      ],
      stepsTitle: 'Limit qanday belgilanadi',
      steps: [
        'Siz bayerga limitni portal orqali yoki sotuv bo‘yicha menejeringiz orqali so‘raysiz.',
        'Sug‘urtalovchi bayerning moliyaviy hisobotini va boshqa mavjud ma’lumotlarni tahlil qiladi hamda qaror qabul qiladi: limitni to‘liq ma’qullash, kamroq summada ma’qullash yoki rad etish.',
        'Limit shartlar bilan berilishi mumkin, masalan, to‘lovni kechiktirishning maksimal muddati.',
        'Limit o‘zgartirilmaguncha yoki bekor qilinmaguncha amal qiladi. Bayerning moliyaviy holati yomonlashsa, sug‘urtalovchi limitni kamaytirishi yoki limitni bekor qilishi mumkin; bungacha amalga oshirilgan yetkazib berishlar jo‘natish sanasida amalda bo‘lgan limit doirasida sug‘urtalangan bo‘lib qoladi.',
      ],
      dlTitle: 'Diskretsion limit',
      dl: 'Diskretsion limit — polisingiz shartlari asosida alohida limit so‘ramasdan bayerlarni o‘zingiz baholashingiz mumkin bo‘lgan summa.',
    },
    process: {
      title: 'Arizadan polisgacha',
      lead: 'Birinchi arizadan amaldagi polisgacha bo‘lgan yo‘l bir necha bosqichdan iborat.',
      steps: [
        {
          title: 'Ariza',
          text: 'Siz yoki sotuv bo‘yicha menejeringiz sug‘urta arizasini rasmiylashtirasiz: kompaniyangiz, aylanmangiz va limit kerak bo‘lgan bayerlar haqidagi ma’lumotlar.',
        },
        {
          title: 'Anderrayting',
          text: 'Sug‘urtalovchi bayerlaringizni baholaydi va kredit limitlarini belgilaydi, shuningdek sug‘urta shartlarini hisoblab chiqadi: mukofot stavkasi, sug‘urta qoplamasi foizi, franshiza va boshqa shartlar.',
        },
        {
          title: 'Tijorat taklifi',
          text: 'Siz shartlar va limitlar bo‘yicha qarorlar ko‘rsatilgan taklifni olasiz hamda uni qabul qilishingiz, o‘zgartirish so‘rashingiz yoki rad etishingiz mumkin.',
        },
        {
          title: 'Polis',
          text: 'Roziligingizdan so‘ng polis tuziladi; arizada kelishilgan limitlar polis bo‘yicha amal qila boshlaydi.',
        },
        {
          title: 'Polis bo‘yicha ish',
          text: 'Portal orqali aylanma deklaratsiyalarini topshirasiz, yangi limitlar so‘raysiz, muddati o‘tgan qarzlar haqida xabarnoma yuborasiz va da’volar topshirasiz.',
        },
      ],
    },
    faq: {
      title: 'Ko‘p beriladigan savollar',
      items: [
        {
          q: 'Barcha bayerlarimni sug‘urtalashim shartmi?',
          a: 'Bu polisning tuzilishiga bog‘liq. Butun aylanma bo‘yicha polis uning doirasidagi barcha bayerlarni qamrab oladi, asosiy bayerlar bo‘yicha polis esa faqat unda ko‘rsatilgan bayerlarni. Biznesingizga mos tuzilmani sotuv bo‘yicha menejeringiz taklif qiladi.',
        },
        {
          q: 'Sug‘urtalovchi bayerga limit berishni rad etsa nima bo‘ladi?',
          a: 'Bu bayerga yetkazib berishlar sug‘urtalanmaydi, polis shartlari asosida diskretsion limit doirasiga kiradigan holatlar bundan mustasno. Bayer haqida yangi moliyaviy ma’lumot paydo bo‘lganda limitni qayta so‘rashingiz mumkin.',
        },
        {
          q: 'Polis amal qilayotgan vaqtda limit o‘zgarishi mumkinmi?',
          a: 'Ha. Bayerning moliyaviy holati o‘zgarganda sug‘urtalovchi limitlarni qayta ko‘rib chiqadi. O‘zgarishdan oldin amalga oshirilgan yetkazib berishlar jo‘natish sanasida amalda bo‘lgan limit doirasida sug‘urtalangan bo‘lib qoladi.',
        },
        {
          q: 'Bayer o‘z vaqtida to‘lamasa nima qilish kerak?',
          a: 'Polisda belgilangan muddatda portal orqali muddati o‘tganlik haqida xabarnoma yuboring va qarzni undirish bo‘yicha ishni davom ettiring. O‘z vaqtida xabar berish sug‘urta qoplamasining shartlaridan biridir.',
        },
        {
          q: 'Da’vo qachon topshiriladi?',
          a: 'Sug‘urta hodisasi yuz berganda: polisda belgilangan uzoq muddatli to‘lamaslik bo‘yicha kutish davri o‘tganda yoki bayer to‘lovga qobiliyatsiz deb topilganda. Da’vo portal orqali tasdiqlovchi hujjatlar bilan birga topshiriladi.',
        },
        {
          q: 'Sug‘urta mukofoti qanday hisoblanadi?',
          a: 'Mukofot siz deklaratsiya qiladigan sug‘urtalangan aylanmaga polisda belgilangan stavkani qo‘llash orqali hisoblanadi; polisda minimal mukofot ham belgilanadi. Aniq shartlar tijorat taklifida va polisda ko‘rsatiladi.',
        },
      ],
    },
    contacts: {
      title: 'Biz bilan qanday bog‘lanish mumkin',
      paragraphs: [
        'Sug‘urtani muhokama qilish, limit so‘rash yoki polisingiz bo‘yicha savol berish uchun sotuv bo‘yicha menejeringizga murojaat qiling — u sizga barcha bosqichlarda, arizadan amaldagi polis bo‘yicha ishgacha hamrohlik qiladi.',
        'Agar sizda mijozlar portaliga kirish imkoni bo‘lsa, u yerda arizalaringiz, limitlaringiz, deklaratsiyalaringiz va da’volaringizni kuzatib borishingiz hamda tijorat takliflariga javob berishingiz mumkin.',
      ],
      labels: { phone: 'Telefon', email: 'Elektron pochta', website: 'Veb-sayt', address: 'Manzil', manager: 'Sizning menejeringiz' },
    },
    legal: 'Material ma’lumot uchun mo‘ljallangan. Qoplamaning aniq hajmi va istisnolar polisingiz shartlari bilan belgilanadi.',
  },
}
