---
id: credit-monitoring
title: Monitoring, muddati o‘tgan qarzlar va limitni bekor qilish
roles: [credit_underwriter, commercial_underwriter, claims, sales]
pages: ["/overdues", "/overdues/:id"]
order: 6
---

## Qachon foydalaniladi

Limitni qayta ko‘rib chiqish, reytingning yomonlashishi yoki sug‘urtalanuvchidan {{term:noa|muddati o‘tganlik haqida xabarnoma}}.

## Qadamlar

1. {{ui:nav.limits}} › {{ui:limits.views.monitoring}} — e’tibor talab qiladigan narsalar.
2. {{ui:nav.overdues}}: xabarnomani sug‘urtalanuvchi (portalda) yoki xodim topshiradi. Topshirilganda bayerga limit **avtomatik to‘xtatiladi** va bu sug‘urtalanuvchiga darhol ko‘rinadi.
3. Qarzning to‘lanishi xabarnomani {{ui:overdues.statuses.resolved_paid}} sifatida yopadi, lekin limitni **tiklamaydi**: keyingi limit — yangi kredit qarori.
4. Agar qarz kutish davri oxirigacha to‘lanmasa, xabarnoma da’voga o‘tkaziladi.
5. Risk yomonlashdi — {{ui:limits.actions.revoke}}: bu tijorat bosqichi va sotuv oynasini chetlab, sug‘urtalanuvchiga darhol yetib boradi.

## Natija

Limitni bekor qilish yoki yangi qaror tarixning yangi qatorlari sifatida yoziladi; oldingi qarorlar o‘zgarmaydi.

## Ko‘p uchraydigan xatolar

- **Limitni bekor qilish allaqachon jo‘natilgan tovarlar qoplamasini ham olib tashlaydi deb o‘ylash.** Qoplash jo‘natish sanasida o‘sha paytda amalda bo‘lgan qaror bo‘yicha baholanadi.
