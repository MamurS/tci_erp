/**
 * The APPROVED texts of the TCI brochure, in Russian, English and Uzbek — the
 * source the commercial offer's fixed template quotes
 * (src/features/offers/kp/templates/tciTexts.ts; tciTexts.test.ts proves every
 * statement there is a verbatim quote of this file in the same language).
 *
 * The texts describe how trade credit insurance works in general (the
 * Allianz Trade / Coface / Atradius practice this system follows) and say "as
 * your policy sets" wherever a term is the policy's to decide. They
 * deliberately contain NO statistics, market figures, percentages, partner
 * names, ratings, awards or guarantees — defaultContent.test.ts refuses them
 * — and no invented names or phone numbers: contacts point to the sales
 * manager and the portal; the insurer's own particulars come from the offer's
 * data when it is printed.
 *
 * Terminology follows the glossary in CLAUDE.md: Байер / Bayer (never
 * «покупатель» / «xaridor» for the debtor), Страхователь / Sug‘urtalanuvchi,
 * Страховщик / Sug‘urtalovchi, Процент покрытия, невозмещаемые убытки (NQL) /
 * qoplanmaydigan zarar (NQL), Претензия / da’vo, Полис, Qaltislik,
 * Diskretsion limit, «xabarnoma»; uz o‘ and g‘ with U+2018, the glottal
 * stop with U+2019 as in the uz locale.
 *
 * BROCHURE_CLAIMS lists every factual or marketing statement the Russian
 * text makes (docs/BROCHURE-CLAIMS.md). The two marked `pending` (⚠) are not
 * modelled by the system and not confirmed by the owner: the template leaves
 * them out.
 */

import type { BrochureContent, BrochureLang, BrochureSectionKey, Localized } from './model'

const p = (...paragraphs: string[]) => paragraphs.join('\n\n')
const list = (...items: string[]) => items.map((i) => `- ${i}`).join('\n')
const qa = (question: string, answer: string) => `? ${question}\n${answer}`

type Texts = Record<BrochureSectionKey, { title: Localized; body: Localized }>

const TEXTS: Texts = {
  what: {
    title: {
      ru: 'Что такое страхование торговых кредитов',
      en: 'What trade credit insurance is',
      uz: 'Savdo kreditlarini sug‘urtalash nima',
    },
    body: {
      ru: p(
        'Страхование торговых кредитов защищает вашу дебиторскую задолженность. Когда вы поставляете товары или оказываете услуги с отсрочкой платежа, вы фактически кредитуете своего контрагента — байера. Если байер не заплатит, страховщик возместит вам застрахованную часть убытка.',
        'Полис заключается между вашей компанией — страхователем — и страховщиком. Страховщик оценивает финансовое положение ваших байеров, устанавливает на каждого из них кредитный лимит и следит за ними весь срок действия полиса.',
        list(
          'Вы продаёте с отсрочкой платежа увереннее: риск неоплаты оценён и застрахован.',
          'Решения о работе с новыми байерами опираются на независимую оценку их платёжеспособности.',
          'Условия страхования — процент покрытия, порог невозмещаемых убытков (NQL), франшиза и максимальный лимит ответственности — указываются в вашем полисе.',
        ),
      ),
      en: p(
        'Trade credit insurance protects your receivables. Whenever you deliver goods or services on deferred payment terms, you are in effect lending to your customer — the buyer. If the buyer does not pay, the insurer indemnifies you for the insured share of the loss.',
        'The policy is concluded between your company — the policyholder — and the insurer. The insurer assesses the financial standing of your buyers, sets a credit limit on each of them and keeps them under watch for as long as the policy runs.',
        list(
          'You can sell on credit with more confidence: the risk of non-payment is assessed and insured.',
          'Decisions about new buyers rest on an independent assessment of their creditworthiness.',
          'The terms of cover — the insured percentage, the non-qualifying loss (NQL) threshold, the deductible and the maximum liability — are set out in your policy.',
        ),
      ),
      uz: p(
        'Savdo kreditlarini sug‘urtalash debitorlik qarzlaringizni himoya qiladi. Tovarlarni yetkazib berganingizda yoki xizmat ko‘rsatganingizda to‘lovni kechiktirib bersangiz, siz aslida kontragentingizga — bayerga kredit berasiz. Agar bayer to‘lamasa, sug‘urtalovchi zararning sug‘urtalangan qismini qoplab beradi.',
        'Polis sizning kompaniyangiz — sug‘urtalanuvchi — va sug‘urtalovchi o‘rtasida tuziladi. Sug‘urtalovchi bayerlaringizning moliyaviy holatini baholaydi, ularning har biriga kredit limitini belgilaydi va polis amal qiladigan butun muddat davomida ularni kuzatib boradi.',
        list(
          'Kechiktirilgan to‘lov sharti bilan ishonchliroq sotasiz: to‘lanmaslik qaltisligi baholangan va sug‘urtalangan.',
          'Yangi bayerlar bilan ishlash bo‘yicha qarorlar ularning to‘lov qobiliyatini mustaqil baholashga asoslanadi.',
          'Sug‘urta shartlari — sug‘urta qoplamasi foizi, qoplanmaydigan zarar (NQL) chegarasi, franshiza va javobgarlikning maksimal limiti — polisingizda ko‘rsatiladi.',
        ),
      ),
    },
  },

  how: {
    title: { ru: 'Как это работает', en: 'How it works', uz: 'Bu qanday ishlaydi' },
    body: {
      ru: p(
        'В страховании участвуют три стороны: ваша компания (страхователь), ваш контрагент, которому вы продаёте с отсрочкой платежа (байер), и страховщик.',
        list(
          'Вы отгружаете товар байеру с отсрочкой платежа — в пределах кредитного лимита, установленного на этого байера.',
          'Вы уплачиваете страховщику страховую премию; страховщик предоставляет страховое покрытие и устанавливает кредитные лимиты на ваших байеров.',
          'Страховщик следит за финансовым положением байеров и при необходимости пересматривает лимиты.',
          'Если байер не платит в срок, вы направляете уведомление о просрочке, а при наступлении страхового случая — претензию о выплате страхового возмещения.',
        ),
      ),
      en: p(
        'Three parties take part: your company (the policyholder), the customer you sell to on credit (the buyer) and the insurer.',
        list(
          'You deliver to the buyer on deferred payment terms, within the credit limit set on that buyer.',
          'You pay the insurer a premium; the insurer provides cover and sets credit limits on your buyers.',
          'The insurer monitors your buyers’ financial standing and reviews their limits when it changes.',
          'If a buyer does not pay on time, you send an overdue notification; once an insured event occurs, you file a claim for indemnity.',
        ),
      ),
      uz: p(
        'Sug‘urtada uch tomon ishtirok etadi: sizning kompaniyangiz (sug‘urtalanuvchi), siz to‘lovni kechiktirish sharti bilan sotadigan kontragentingiz (bayer) va sug‘urtalovchi.',
        list(
          'Siz bayerga tovarni to‘lovni kechiktirish sharti bilan, ushbu bayerga belgilangan kredit limiti doirasida jo‘natasiz.',
          'Siz sug‘urtalovchiga sug‘urta mukofotini to‘laysiz; sug‘urtalovchi sug‘urta qoplamasini beradi va bayerlaringizga kredit limitlarini belgilaydi.',
          'Sug‘urtalovchi bayerlarning moliyaviy holatini kuzatib boradi va zarur bo‘lganda limitlarni qayta ko‘rib chiqadi.',
          'Agar bayer o‘z vaqtida to‘lamasa, siz muddati o‘tganlik haqida xabarnoma yuborasiz, sug‘urta hodisasi yuz berganda esa sug‘urta tovonini to‘lash to‘g‘risida da’vo topshirasiz.',
        ),
      ),
    },
  },

  covered: {
    title: {
      ru: 'Что покрывает страхование',
      en: 'What is covered',
      uz: 'Sug‘urta nimani qoplaydi',
    },
    body: {
      ru: p(
        'Страхование покрывает неоплату по поставкам, совершённым в период действия полиса в пределах кредитного лимита, если она вызвана одним из двух событий.',
        list(
          'Длительная просрочка платежа: байер не оплатил долг в течение срока, установленного полисом, после наступления срока платежа.',
          'Несостоятельность (банкротство) байера, установленная в порядке, предусмотренном законом.',
        ),
        'Страховщик возмещает убыток в пределах процента покрытия, за вычетом франшизы и в пределах максимального лимита ответственности. Убыток ниже порога невозмещаемых убытков (NQL) не возмещается.',
        `Как правило, не покрываются:\n${list(
          'поставки сверх кредитного лимита или вне периода действия полиса;',
          'отсрочка платежа длиннее максимальной, установленной полисом;',
          'суммы, которые байер оспаривает по существу поставки, — до разрешения спора.',
        )}`,
        'Точный объём покрытия и исключения определяются условиями вашего полиса.',
      ),
      en: p(
        'The insurance covers non-payment for deliveries made during the policy period within the credit limit, when it is caused by one of two events.',
        list(
          'Protracted default: the buyer has not paid within the period set by the policy after the payment fell due.',
          'Insolvency of the buyer, established as the law provides.',
        ),
        'The insurer indemnifies the loss up to the insured percentage, less the deductible and within the maximum liability. A loss below the non-qualifying loss (NQL) threshold is not indemnified.',
        `As a rule, the following are not covered:\n${list(
          'deliveries above the credit limit or outside the policy period;',
          'payment terms longer than the maximum the policy allows;',
          'amounts the buyer disputes on the substance of the delivery, until the dispute is resolved.',
        )}`,
        'The exact scope of cover and the exclusions are those of your policy.',
      ),
      uz: p(
        'Sug‘urta polis amal qilgan davrda kredit limiti doirasida amalga oshirilgan yetkazib berishlar bo‘yicha to‘lanmaslikni, agar u ikki hodisadan biri sababli yuz bergan bo‘lsa, qoplaydi.',
        list(
          'Uzoq muddatli to‘lamaslik: to‘lov muddati kelgandan keyin bayer qarzni polisda belgilangan muddat ichida to‘lamagan.',
          'Bayerning qonunda belgilangan tartibda aniqlangan to‘lovga qobiliyatsizligi (bankrotligi).',
        ),
        'Sug‘urtalovchi zararni sug‘urta qoplamasi foizi doirasida, franshiza chegirilgan holda va javobgarlikning maksimal limiti doirasida qoplaydi. Qoplanmaydigan zarar (NQL) chegarasidan kam bo‘lgan zarar qoplanmaydi.',
        `Odatda quyidagilar qoplanmaydi:\n${list(
          'kredit limitidan ortiq yoki polis amal qilish davridan tashqari yetkazib berishlar;',
          'polisda belgilangan maksimal muddatdan uzoqroq to‘lov kechiktirilishi;',
          'bayer yetkazib berishning mohiyati bo‘yicha nizolashayotgan summalar — nizo hal bo‘lgunga qadar.',
        )}`,
        'Qoplamaning aniq hajmi va istisnolar polisingiz shartlari bilan belgilanadi.',
      ),
    },
  },

  benefits: {
    title: {
      ru: 'Преимущества для вашего бизнеса',
      en: 'Benefits for your business',
      uz: 'Biznesingiz uchun afzalliklar',
    },
    body: {
      ru: list(
        'Защищённая дебиторская задолженность. Неоплата застрахованных поставок не ложится целиком на ваш оборотный капитал.',
        'Финансирование под застрахованную дебиторскую задолженность. Застрахованная дебиторская задолженность может служить дополнительным обеспечением при банковском финансировании или факторинге; решение и условия определяет финансирующая организация.',
        'Мониторинг байеров. Страховщик следит за финансовым положением ваших байеров и сообщает вам, когда лимит меняется.',
        'Содействие во взыскании. При просрочке платежа вы можете рассчитывать на содействие во взыскании долга; после выплаты страхового возмещения страховщик продолжает взыскание в порядке суброгации.',
        'Уверенный рост продаж. Вы можете предлагать отсрочку платежа новым байерам, опираясь на независимую оценку их кредитоспособности.',
      ),
      en: list(
        'Secure receivables. Non-payment on insured deliveries does not fall on your working capital alone.',
        'Financing against insured receivables. Insured receivables can serve as additional security for bank financing or factoring; the decision and its terms are the financing institution’s.',
        'Buyer monitoring. The insurer watches your buyers’ financial standing and lets you know when a limit changes.',
        'Collection support. When a payment is overdue you can count on support in collecting the debt; once the indemnity is paid, the insurer pursues the debt by subrogation.',
        'Confident growth. You can offer payment terms to new buyers on the strength of an independent assessment of their creditworthiness.',
      ),
      uz: list(
        'Himoyalangan debitorlik qarzlari. Sug‘urtalangan yetkazib berishlar bo‘yicha to‘lanmaslik butunlay aylanma mablag‘laringiz zimmasiga tushmaydi.',
        'Sug‘urtalangan debitorlik qarzlari evaziga moliyalashtirish. Sug‘urtalangan debitorlik qarzlari bank moliyalashtiruvi yoki faktoring uchun qo‘shimcha ta’minot bo‘lib xizmat qilishi mumkin; qaror va shartlarni moliyalashtiruvchi tashkilot belgilaydi.',
        'Bayerlar monitoringi. Sug‘urtalovchi bayerlaringizning moliyaviy holatini kuzatib boradi va limit o‘zgarganda sizni xabardor qiladi.',
        'Qarzni undirishda ko‘mak. To‘lov muddati o‘tganda qarzni undirishda ko‘mak olishingiz mumkin; sug‘urta tovoni to‘langandan keyin sug‘urtalovchi qarzni subrogatsiya tartibida undirishni davom ettiradi.',
        'Ishonchli o‘sish. Yangi bayerlarga ularning kreditga layoqatliligini mustaqil baholash asosida to‘lovni kechiktirish imkonini taklif qilishingiz mumkin.',
      ),
    },
  },

  limits: {
    title: {
      ru: 'Как работают кредитные лимиты',
      en: 'How credit limits work',
      uz: 'Kredit limitlari qanday ishlaydi',
    },
    body: {
      ru: p(
        'Кредитный лимит — это наибольшая сумма неоплаченной задолженности байера перед вами, которая застрахована в каждый момент времени. Лимит устанавливается на каждого байера отдельно.',
        list(
          'Вы запрашиваете лимит на байера через портал или у своего менеджера по продажам.',
          'Страховщик анализирует финансовую отчётность байера и другую доступную информацию и принимает решение: одобрить лимит полностью, одобрить его в меньшей сумме или отказать.',
          'Лимит может сопровождаться условиями, например максимальной отсрочкой платежа.',
          'Лимит действует, пока он не изменён или не отозван. Если финансовое положение байера ухудшается, страховщик может уменьшить или отозвать лимит; поставки, совершённые до этого, остаются застрахованными в пределах лимита, действовавшего на дату отгрузки.',
        ),
        'Дискреционный лимит — сумма, в пределах которой вы можете сами оценивать байеров на условиях вашего полиса, не запрашивая отдельного лимита.',
      ),
      en: p(
        'A credit limit is the largest amount of the buyer’s unpaid debt to you that is insured at any one time. A limit is set on each buyer separately.',
        list(
          'You request a limit on a buyer through the portal or from your sales manager.',
          'The insurer analyses the buyer’s financial statements and other available information, and decides: approve the limit in full, approve a smaller amount, or decline.',
          'A limit may come with conditions, such as a maximum payment term.',
          'A limit stays in force until it is changed or revoked. If the buyer’s financial standing deteriorates, the insurer may reduce or revoke the limit; deliveries made before that remain insured within the limit that was in force on the shipment date.',
        ),
        'The discretionary limit is the amount up to which you may assess buyers yourself, on the terms of your policy, without requesting a separate limit.',
      ),
      uz: p(
        'Kredit limiti — bayerning sizga bo‘lgan to‘lanmagan qarzining istalgan paytda sug‘urtalangan eng katta summasi. Limit har bir bayerga alohida belgilanadi.',
        list(
          'Siz bayerga limitni portal orqali yoki sotuv bo‘yicha menejeringiz orqali so‘raysiz.',
          'Sug‘urtalovchi bayerning moliyaviy hisobotini va boshqa mavjud ma’lumotlarni tahlil qiladi hamda qaror qabul qiladi: limitni to‘liq ma’qullash, kamroq summada ma’qullash yoki rad etish.',
          'Limit shartlar bilan berilishi mumkin, masalan, to‘lovni kechiktirishning maksimal muddati.',
          'Limit o‘zgartirilmaguncha yoki bekor qilinmaguncha amal qiladi. Bayerning moliyaviy holati yomonlashsa, sug‘urtalovchi limitni kamaytirishi yoki limitni bekor qilishi mumkin; bungacha amalga oshirilgan yetkazib berishlar jo‘natish sanasida amalda bo‘lgan limit doirasida sug‘urtalangan bo‘lib qoladi.',
        ),
        'Diskretsion limit — polisingiz shartlari asosida alohida limit so‘ramasdan bayerlarni o‘zingiz baholashingiz mumkin bo‘lgan summa.',
      ),
    },
  },

  process: {
    title: { ru: 'От заявки до полиса', en: 'From request to policy', uz: 'Arizadan polisgacha' },
    body: {
      ru: p(
        'Путь от первой заявки до действующего полиса состоит из нескольких шагов.',
        list(
          'Заявка. Вы или ваш менеджер по продажам оформляете заявку на страхование: сведения о вашей компании, обороте и байерах, на которых нужны лимиты.',
          'Андеррайтинг. Страховщик оценивает ваших байеров и устанавливает кредитные лимиты, а также рассчитывает условия страхования: ставку премии, процент покрытия, франшизу и другие условия.',
          'Коммерческое предложение. Вы получаете предложение с условиями и решениями по лимитам и можете принять его, запросить изменения или отказаться.',
          'Полис. После вашего согласия заключается полис; лимиты, согласованные в заявке, начинают действовать по полису.',
          'Работа по полису. Через портал вы подаёте декларации оборота, запрашиваете новые лимиты, сообщаете о просрочках и подаёте претензии.',
        ),
      ),
      en: p(
        'The way from a first request to a policy in force has a few steps.',
        list(
          'Request. You or your sales manager prepare an insurance request: details of your company, your turnover and the buyers you need limits on.',
          'Underwriting. The insurer assesses your buyers and sets credit limits, and works out the terms of cover: the premium rate, the insured percentage, the deductible and the other terms.',
          'Commercial offer. You receive an offer with the terms and the limit decisions, and can accept it, ask for changes or decline it.',
          'Policy. Once you accept, the policy is concluded; the limits agreed in the request take effect under the policy.',
          'Day to day. Through the portal you submit turnover declarations, request new limits, report overdue accounts and file claims.',
        ),
      ),
      uz: p(
        'Birinchi arizadan amaldagi polisgacha bo‘lgan yo‘l bir necha bosqichdan iborat.',
        list(
          'Ariza. Siz yoki sotuv bo‘yicha menejeringiz sug‘urta arizasini rasmiylashtirasiz: kompaniyangiz, aylanmangiz va limit kerak bo‘lgan bayerlar haqidagi ma’lumotlar.',
          'Anderrayting. Sug‘urtalovchi bayerlaringizni baholaydi va kredit limitlarini belgilaydi, shuningdek sug‘urta shartlarini hisoblab chiqadi: mukofot stavkasi, sug‘urta qoplamasi foizi, franshiza va boshqa shartlar.',
          'Tijorat taklifi. Siz shartlar va limitlar bo‘yicha qarorlar ko‘rsatilgan taklifni olasiz hamda uni qabul qilishingiz, o‘zgartirish so‘rashingiz yoki rad etishingiz mumkin.',
          'Polis. Roziligingizdan so‘ng polis tuziladi; arizada kelishilgan limitlar polis bo‘yicha amal qila boshlaydi.',
          'Polis bo‘yicha ish. Portal orqali aylanma deklaratsiyalarini topshirasiz, yangi limitlar so‘raysiz, muddati o‘tgan qarzlar haqida xabarnoma yuborasiz va da’volar topshirasiz.',
        ),
      ),
    },
  },

  faq: {
    title: {
      ru: 'Частые вопросы',
      en: 'Frequently asked questions',
      uz: 'Ko‘p beriladigan savollar',
    },
    body: {
      ru: p(
        qa(
          'Нужно ли страховать всех моих байеров?',
          'Это зависит от структуры полиса. Полис на весь оборот охватывает всех байеров в его рамках, полис по ключевым байерам — только указанных в нём. Структуру предложит ваш менеджер по продажам с учётом особенностей вашего бизнеса.',
        ),
        qa(
          'Что будет, если страховщик отказал в лимите на байера?',
          'Поставки этому байеру не застрахованы, за исключением случаев, когда они укладываются в дискреционный лимит на условиях полиса. Вы можете запросить лимит повторно, когда появится новая финансовая информация о байере.',
        ),
        qa(
          'Может ли лимит измениться во время действия полиса?',
          'Да. Страховщик пересматривает лимиты при изменении финансового положения байера. Поставки, совершённые до изменения, остаются застрахованными в пределах лимита, действовавшего на дату отгрузки.',
        ),
        qa(
          'Что делать, если байер не заплатил в срок?',
          'Направьте уведомление о просрочке через портал в срок, установленный полисом, и продолжайте работу по взысканию долга. Своевременное уведомление — одно из условий страхового покрытия.',
        ),
        qa(
          'Когда подаётся претензия?',
          'Когда наступил страховой случай: истёк установленный полисом период ожидания по длительной просрочке или байер признан несостоятельным. Претензия подаётся через портал вместе с подтверждающими документами.',
        ),
        qa(
          'Как рассчитывается страховая премия?',
          'Премия рассчитывается по ставке, установленной полисом, от застрахованного оборота, который вы декларируете; полис также устанавливает минимальную премию. Конкретные условия указываются в коммерческом предложении и в полисе.',
        ),
      ),
      en: p(
        qa(
          'Do I have to insure all my buyers?',
          'That depends on how the policy is structured. A whole-turnover policy covers all buyers within its scope; a key-buyer policy covers only the buyers named in it. Your sales manager will suggest the structure that suits your business.',
        ),
        qa(
          'What happens if the insurer declines a limit on a buyer?',
          'Deliveries to that buyer are not insured, except where they fall within the discretionary limit on the terms of the policy. You can request a limit again when new financial information on the buyer becomes available.',
        ),
        qa(
          'Can a limit change while the policy runs?',
          'Yes. The insurer reviews limits when a buyer’s financial standing changes. Deliveries made before the change remain insured within the limit that was in force on the shipment date.',
        ),
        qa(
          'What should I do if a buyer has not paid on time?',
          'Send an overdue notification through the portal within the period the policy sets, and keep pursuing the debt. Notifying on time is one of the conditions of cover.',
        ),
        qa(
          'When is a claim filed?',
          'When an insured event has occurred: the waiting period for protracted default set by the policy has passed, or the buyer has been declared insolvent. The claim is filed through the portal together with the supporting documents.',
        ),
        qa(
          'How is the premium calculated?',
          'The premium is the rate set by the policy applied to the insured turnover you declare; the policy also sets a minimum premium. The exact terms are stated in the commercial offer and in the policy.',
        ),
      ),
      uz: p(
        qa(
          'Barcha bayerlarimni sug‘urtalashim shartmi?',
          'Bu polisning tuzilishiga bog‘liq. Butun aylanma bo‘yicha polis uning doirasidagi barcha bayerlarni qamrab oladi, asosiy bayerlar bo‘yicha polis esa faqat unda ko‘rsatilgan bayerlarni. Biznesingizga mos tuzilmani sotuv bo‘yicha menejeringiz taklif qiladi.',
        ),
        qa(
          'Sug‘urtalovchi bayerga limit berishni rad etsa nima bo‘ladi?',
          'Bu bayerga yetkazib berishlar sug‘urtalanmaydi, polis shartlari asosida diskretsion limit doirasiga kiradigan holatlar bundan mustasno. Bayer haqida yangi moliyaviy ma’lumot paydo bo‘lganda limitni qayta so‘rashingiz mumkin.',
        ),
        qa(
          'Polis amal qilayotgan vaqtda limit o‘zgarishi mumkinmi?',
          'Ha. Bayerning moliyaviy holati o‘zgarganda sug‘urtalovchi limitlarni qayta ko‘rib chiqadi. O‘zgarishdan oldin amalga oshirilgan yetkazib berishlar jo‘natish sanasida amalda bo‘lgan limit doirasida sug‘urtalangan bo‘lib qoladi.',
        ),
        qa(
          'Bayer o‘z vaqtida to‘lamasa nima qilish kerak?',
          'Polisda belgilangan muddatda portal orqali muddati o‘tganlik haqida xabarnoma yuboring va qarzni undirish bo‘yicha ishni davom ettiring. O‘z vaqtida xabar berish sug‘urta qoplamasining shartlaridan biridir.',
        ),
        qa(
          'Da’vo qachon topshiriladi?',
          'Sug‘urta hodisasi yuz berganda: polisda belgilangan uzoq muddatli to‘lamaslik bo‘yicha kutish davri o‘tganda yoki bayer to‘lovga qobiliyatsiz deb topilganda. Da’vo portal orqali tasdiqlovchi hujjatlar bilan birga topshiriladi.',
        ),
        qa(
          'Sug‘urta mukofoti qanday hisoblanadi?',
          'Mukofot siz deklaratsiya qiladigan sug‘urtalangan aylanmaga polisda belgilangan stavkani qo‘llash orqali hisoblanadi; polisda minimal mukofot ham belgilanadi. Aniq shartlar tijorat taklifida va polisda ko‘rsatiladi.',
        ),
      ),
    },
  },

  contacts: {
    title: {
      ru: 'Как с нами связаться',
      en: 'How to reach us',
      uz: 'Biz bilan qanday bog‘lanish mumkin',
    },
    body: {
      ru: p(
        'Чтобы обсудить страхование, запросить лимит или задать вопрос по вашему полису, обратитесь к своему менеджеру по продажам — он сопровождает вас на всех этапах: от заявки до работы по действующему полису.',
        'Если у вас есть доступ к порталу для клиентов, там вы можете следить за своими заявками, лимитами, декларациями и претензиями, а также отвечать на коммерческие предложения.',
      ),
      en: p(
        'To discuss insurance, request a limit or ask about your policy, contact your sales manager, who accompanies you at every stage — from the request to day-to-day work under a policy in force.',
        'If you have access to the client portal, you can follow your requests, limits, declarations and claims there, and answer commercial offers.',
      ),
      uz: p(
        'Sug‘urtani muhokama qilish, limit so‘rash yoki polisingiz bo‘yicha savol berish uchun sotuv bo‘yicha menejeringizga murojaat qiling — u sizga barcha bosqichlarda, arizadan amaldagi polis bo‘yicha ishgacha hamrohlik qiladi.',
        'Agar sizda mijozlar portaliga kirish imkoni bo‘lsa, u yerda arizalaringiz, limitlaringiz, deklaratsiyalaringiz va da’volaringizni kuzatib borishingiz hamda tijorat takliflariga javob berishingiz mumkin.',
      ),
    },
  },
}

/** The texts as a fresh object (sections in print order). */
export function defaultBrochureContent(): BrochureContent {
  return {
    sections: (Object.keys(TEXTS) as BrochureSectionKey[]).map((key) => ({
      key,
      title: { ...TEXTS[key].title },
      body: { ...TEXTS[key].body },
      image_asset_id: null,
    })),
  }
}

// ---------------------------------------------------------------------------
// The statements the draft makes, for the owner's review
// ---------------------------------------------------------------------------

export interface BrochureClaim {
  section: BrochureSectionKey
  lang: BrochureLang
  text: string
  /** factual: must be true of OUR product and wording; marketing: a selling point. */
  kind: 'factual' | 'marketing'
  /** ⚠ not modelled by the system and not confirmed: never printed. */
  pending?: true
}

/**
 * Every factual or marketing statement of the Russian text (en and uz say the
 * same). A factual one must hold for the insurer's actual wording and
 * service before the brochure is published; the ones marked «проверить» are
 * not modelled by the system at all and are the owner's to confirm.
 */
export const BROCHURE_CLAIMS: readonly BrochureClaim[] = [
  {
    section: 'what',
    lang: 'ru',
    kind: 'factual',
    text: 'Если байер не заплатит, страховщик возместит застрахованную часть убытка.',
  },
  {
    section: 'what',
    lang: 'ru',
    kind: 'factual',
    text: 'Страховщик оценивает финансовое положение байеров, устанавливает на каждого кредитный лимит и следит за ними весь срок действия полиса.',
  },
  {
    section: 'what',
    lang: 'ru',
    kind: 'marketing',
    text: 'Вы продаёте с отсрочкой платежа увереннее: риск неоплаты оценён и застрахован.',
  },
  {
    section: 'what',
    lang: 'ru',
    kind: 'marketing',
    text: 'Решения о работе с новыми байерами опираются на независимую оценку их платёжеспособности.',
  },
  {
    section: 'what',
    lang: 'ru',
    kind: 'factual',
    text: 'Процент покрытия, порог невозмещаемых убытков (NQL), франшиза и максимальный лимит ответственности указываются в полисе.',
  },
  {
    section: 'how',
    lang: 'ru',
    kind: 'factual',
    text: 'Поставки байеру застрахованы в пределах кредитного лимита, установленного на этого байера.',
  },
  {
    section: 'how',
    lang: 'ru',
    kind: 'factual',
    text: 'Страховщик следит за финансовым положением байеров и при необходимости пересматривает лимиты.',
  },
  {
    section: 'how',
    lang: 'ru',
    kind: 'factual',
    text: 'При просрочке страхователь направляет уведомление о просрочке, при страховом случае — претензию о выплате возмещения.',
  },
  {
    section: 'covered',
    lang: 'ru',
    kind: 'factual',
    text: 'Покрываются два события: длительная просрочка платежа (по истечении срока, установленного полисом) и несостоятельность (банкротство) байера.',
  },
  {
    section: 'covered',
    lang: 'ru',
    kind: 'factual',
    text: 'Покрываются поставки в период действия полиса в пределах кредитного лимита.',
  },
  {
    section: 'covered',
    lang: 'ru',
    kind: 'factual',
    text: 'Возмещение — в пределах процента покрытия, за вычетом франшизы, в пределах максимального лимита ответственности.',
  },
  {
    section: 'covered',
    lang: 'ru',
    kind: 'factual',
    text: 'Убыток ниже порога невозмещаемых убытков (NQL) не возмещается.',
  },
  {
    section: 'covered',
    lang: 'ru',
    kind: 'factual',
    text: 'Не покрываются поставки сверх лимита или вне периода полиса и отсрочка длиннее максимальной по полису.',
  },
  {
    section: 'covered',
    lang: 'ru',
    kind: 'factual',
    pending: true,
    text: 'Проверить по wording: суммы, оспариваемые байером по существу поставки, не покрываются до разрешения спора (система этого исключения не моделирует).',
  },
  {
    section: 'benefits',
    lang: 'ru',
    kind: 'marketing',
    text: 'Неоплата застрахованных поставок не ложится целиком на ваш оборотный капитал.',
  },
  {
    section: 'benefits',
    lang: 'ru',
    kind: 'factual',
    text: 'Застрахованная дебиторская задолженность может служить дополнительным обеспечением при банковском финансировании или факторинге; решение за финансирующей организацией.',
  },
  {
    section: 'benefits',
    lang: 'ru',
    kind: 'factual',
    text: 'Страховщик сообщает страхователю, когда лимит меняется.',
  },
  {
    section: 'benefits',
    lang: 'ru',
    kind: 'factual',
    pending: true,
    text: 'Проверить: при просрочке страхователь может рассчитывать на содействие во взыскании долга (услуга взыскания в системе не моделируется).',
  },
  {
    section: 'benefits',
    lang: 'ru',
    kind: 'factual',
    text: 'После выплаты возмещения страховщик продолжает взыскание в порядке суброгации.',
  },
  {
    section: 'benefits',
    lang: 'ru',
    kind: 'marketing',
    text: 'Уверенный рост продаж: отсрочка платежа новым байерам на основе независимой оценки их кредитоспособности.',
  },
  {
    section: 'limits',
    lang: 'ru',
    kind: 'factual',
    text: 'Кредитный лимит — наибольшая сумма неоплаченной задолженности байера, застрахованная в каждый момент времени; устанавливается на каждого байера отдельно.',
  },
  {
    section: 'limits',
    lang: 'ru',
    kind: 'factual',
    text: 'Лимит запрашивается через портал или у менеджера по продажам.',
  },
  {
    section: 'limits',
    lang: 'ru',
    kind: 'factual',
    text: 'Решение по лимиту: одобрить полностью, одобрить в меньшей сумме или отказать; решение принимается по финансовой отчётности байера и другой доступной информации.',
  },
  {
    section: 'limits',
    lang: 'ru',
    kind: 'factual',
    text: 'Лимит может сопровождаться условиями, например максимальной отсрочкой платежа.',
  },
  {
    section: 'limits',
    lang: 'ru',
    kind: 'factual',
    text: 'Страховщик может уменьшить или отозвать лимит; поставки до этого остаются застрахованными в пределах лимита, действовавшего на дату отгрузки.',
  },
  {
    section: 'limits',
    lang: 'ru',
    kind: 'factual',
    text: 'В пределах дискреционного лимита страхователь сам оценивает байеров на условиях полиса.',
  },
  {
    section: 'process',
    lang: 'ru',
    kind: 'factual',
    text: 'Порядок: заявка → андеррайтинг (лимиты и условия) → коммерческое предложение (принять, запросить изменения, отказаться) → полис, на который переходят согласованные лимиты.',
  },
  {
    section: 'process',
    lang: 'ru',
    kind: 'factual',
    text: 'Через портал подаются декларации оборота, запросы лимитов, уведомления о просрочке и претензии.',
  },
  {
    section: 'faq',
    lang: 'ru',
    kind: 'factual',
    text: 'Полис на весь оборот охватывает всех байеров в его рамках; полис по ключевым байерам — только указанных в нём.',
  },
  {
    section: 'faq',
    lang: 'ru',
    kind: 'factual',
    text: 'При отказе в лимите поставки байеру не застрахованы, кроме укладывающихся в дискреционный лимит; лимит можно запросить повторно.',
  },
  {
    section: 'faq',
    lang: 'ru',
    kind: 'factual',
    text: 'Своевременное уведомление о просрочке — одно из условий страхового покрытия.',
  },
  {
    section: 'faq',
    lang: 'ru',
    kind: 'factual',
    text: 'Претензия подаётся после периода ожидания по длительной просрочке или при несостоятельности байера, через портал, с подтверждающими документами.',
  },
  {
    section: 'faq',
    lang: 'ru',
    kind: 'factual',
    text: 'Премия = ставка по полису × застрахованный декларируемый оборот; полис устанавливает минимальную премию.',
  },
  {
    section: 'contacts',
    lang: 'ru',
    kind: 'marketing',
    text: 'Менеджер по продажам сопровождает клиента на всех этапах — от заявки до работы по действующему полису.',
  },
  {
    section: 'contacts',
    lang: 'ru',
    kind: 'factual',
    text: 'В портале клиент следит за заявками, лимитами, декларациями и претензиями и отвечает на коммерческие предложения.',
  },
]
