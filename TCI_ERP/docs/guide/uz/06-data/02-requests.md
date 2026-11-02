---
id: data-requests
title: Tashkilot va hisobot so‘rovlari
roles: [information_manager, all]
pages: ["/data", "/data/requests/:id"]
order: 2
---

## Qachon foydalaniladi

Xodim qidiruvda tashkilotni topmadi va {{ui:data.notFound.request}} tugmasini bosdi yoki tashkilot kartochkasida {{ui:data.statementsRequest.button}} tugmasini bosdi.

## Qadamlar

1. Istalgan xodim so‘rov yuboradi: nom, mamlakat, ma’lum bo‘lgan narsalar. Agar bunday ro‘yxatdan o‘tish raqami allaqachon bo‘lsa, tizim tashkilot mavjudligini aytadi; agar shunday so‘rov allaqachon ochiq bo‘lsa — u yuborilganini.
2. So‘rov DR-YYYY-NNNN raqamini oladi va **eng kam yuklangan** faol axborot menejeriga — uning kun tartibiga ketadi.
3. Axborot menejeri {{ui:data.actions.take}} tugmasini bosadi, kerak bo‘lsa hamkasbga topshiradi.
4. Tashkilot so‘rovi natijasi: **yaratildi** (dublikat tekshiruvi bilan oddiy tashkilot shakli), mavjud tashkilot bilan **bog‘landi** yoki sabab bilan **rad etildi**. Hisobot so‘rovi natijasi: **yangilandi** yoki **rad etildi**.
5. So‘rov muallifi natija haqida xabar oladi.

## Natija

Tashkilot reyestrda, muallif bundan xabardor.

## Ko‘p uchraydigan xatolar

- **So‘rov tashkilotni o‘zi yaratishini kutish.** Tashkilotni har doim inson oddiy shakl orqali saqlaydi.
