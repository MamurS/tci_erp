---
id: commercial-policies
title: Polislar: reyestr, yaratish, holatlar
roles: [commercial_underwriter, sales]
pages: ["/policies", "/policies/new", "/policies/:id", "/policies/:id/edit"]
order: 2
---

## Qachon foydalaniladi

Polisni qo‘lda yaratish, uning shartlari yoki holatini o‘zgartirish, mukofot va limitlarni ko‘rish.

## Qadamlar

1. {{ui:nav.policies}} — {{ui:policies.views.overview}}, {{ui:policies.views.registry}}, {{ui:policies.views.contracts}} va {{ui:policies.views.templates}} ko‘rinishlari bo‘lgan bo‘lim.

{{shot:commercial-policies}}

2. Yangi polis qoralama sifatida yaratiladi. Odatda u o‘zi paydo bo‘ladi — sotuv arizani rasmiylashtirganda.
3. Polisni oching: holat bilan sarlavha, asosiy raqamlar, shartlar, limitlar, mukofot va deklaratsiyalar varaqlari.
4. Holatni faqat tijorat anderrayteri o‘zgartiradi: {{ui:policies.statuses.draft}} → {{ui:policies.statuses.active}} → {{ui:policies.statuses.suspended}} / {{ui:policies.statuses.expired}} / {{ui:policies.statuses.cancelled}} / {{ui:policies.statuses.annulled}}.

## Natija

Holatning har bir o‘zgarishi muallifi va izohi bilan polis tarixiga yoziladi.

## Ko‘p uchraydigan xatolar

- **Shartnomani bekor qilishni annulyatsiya bilan chalkashtirish.** {{term:cancellation|Shartnomani bekor qilish}} polisni sanadan boshlab to‘xtatadi, avvalgi ijro kuchda qoladi; {{term:annulment|annulyatsiya}} — polis go‘yo tuzilmagandek, mukofot qaytariladi.
- **Eski polisda mukofot jadvalini kutish.** Jadvallardan oldin yaratilgan polisda mukofot varag‘idagi «Jadval yaratish» tugmasini bosing.
