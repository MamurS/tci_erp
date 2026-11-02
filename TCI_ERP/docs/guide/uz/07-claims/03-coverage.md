---
id: claims-coverage
title: Qoplashni tekshirish va tovonni hisoblash
roles: [claims, commercial_underwriter]
order: 3
---

## Qoplash — jo‘natish sanasida

Har bir hisob-faktura uchun tizim qarorlar tarixidan **jo‘natish sanasida** amalda bo‘lgan limitni tiklaydi. Bugun limitni bekor qilish o‘tgan oy jo‘natmalarining qoplamasini olib tashlamaydi, bugungi oshirish esa ularni orqaga qarab qoplamaydi.

Hisob-fakturalar jo‘natish tartibida tekshiriladi; qarz qoplangan-qoplanmaganidan qat’i nazar to‘liq to‘planadi — qoplanmagan jo‘natma ham limitni egallaydi.

## Hisob-faktura bo‘yicha xulosa

- **Yetishmovchilik** (limit yoki diskretsion limitdan oshish) — bir qismi qoplanadi.
- **Buzilish** (maksimaldan uzun to‘lov muddati, polis davridan tashqari jo‘natma, bekor qilingan yoki rad etilgan limit, xabar berish muddatining buzilishi) — qoplash nolga teng.

Xodim xulosani sabab bilan almashtirishi mumkin; tizim xulosasi yonida saqlanib qoladi.

## Tovon hisobi

1. Qoplangan qarz (almashtirishlar hisobga olingan holda).
2. {{term:nql|NQL}} chegarasi: qarz chegaradan kam emas — aks holda hech narsa to‘lanmaydi. Chegaraga teng bo‘lsa — o‘tadi.
3. × {{term:insured-percentage|qoplash foizi}}.
4. − har bir zarar bo‘yicha {{term:deductible|franshiza}}.
5. − oldingi da’volardan keyin {{term:afl|agregat franshiza}} qoldig‘i.
6. {{term:max-liability|Javobgarlikning maksimal limiti}} qoldig‘idan oshmaydi.

Har bir qadam noldan pastga tushmaydi; butun hisob {{ui:claims.tabs.indemnity}} varag‘ida ko‘rsatilgan.
