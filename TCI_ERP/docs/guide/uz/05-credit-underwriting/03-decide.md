---
id: credit-decide
title: Limit so‘rovi bo‘yicha qaror
roles: [credit_underwriter]
pages: ["/limits/:id"]
order: 3
---

## Qachon foydalaniladi

Limit so‘rovi kredit qarorini kutmoqda.

## Qadamlar

1. So‘rovni oching: o‘ngda — bayer, uning reytingi, tavsiya etilgan limit, boshqa amaldagi limitlar, guruh, ochiq xabarnomalar.
2. {{ui:limits.actions.startReview}} tugmasini bosing — so‘rov {{ui:limits.statuses.under_review}} holatiga o‘tadi.
3. Qarorni to‘ldiring: {{ui:limits.outcomes.approved}}, {{ui:limits.outcomes.partial}} yoki {{ui:limits.outcomes.declined}}; summa, to‘lov muddati, amal qilish muddati, shartlar. Shakl ustidagi shkala vakolatingizni va qarordan keyingi guruh ekspozitsiyasini ko‘rsatadi.
4. {{ui:limits.actions.decide}}. Agar UZS dagi summa reyting diapazoni uchun vakolatingizdan yuqori bo‘lsa, qaror yozilmaydi: tizim {{ui:limits.validation.send}} ni taklif qiladi ({{link:credit-authority}} ga qarang).
5. Agar qaror {{term:group-limit|guruh limitidan}} oshsa, so‘rov {{ui:limits.statuses.escalated}} holatiga o‘tadi, kredit bo‘limi esa vazifa oladi.

## Natija

Qaror o‘zgarmaydi: yangi qaror oldingisini almashtiradi, butun tarix ko‘rinadi. Tasdiqlash tijorat bosqichi va sotuv oynasiga ketadi; rad etish — darhol.

## Ko‘p uchraydigan xatolar

- **Kamaytirish sotuv oynasidan o‘tishini kutish.** Kamaytirish va {{ui:limits.actions.revoke}} sug‘urtalanuvchiga darhol yetib boradi.
- **Reytingsiz qaror qabul qilish.** Baho bo‘lmasa, reyting diapazoni «reytingsiz» bo‘ladi va u bo‘yicha vakolat odatda eng kichik.
