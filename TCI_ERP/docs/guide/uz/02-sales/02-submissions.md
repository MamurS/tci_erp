---
id: sales-submissions
title: Sug‘urta arizasi: qoralamadan polisgacha
roles: [sales]
pages: ["/requests", "/requests/:id"]
order: 2
---

## Qachon foydalaniladi

Mijoz savdo kreditlarini sug‘urtalamoqchi yoki mijoz portal orqali ariza topshirgan.

## Qadamlar

1. {{ui:nav.requests}} › {{ui:requests.actions.create}}. Sug‘urtalanuvchini tanlang yoki tashkilot yarating, kutilayotgan aylanma, valyuta va istalgan shartlarni kiriting.

{{shot:sales-submissions}}

2. **Bayerlar paketini** qo‘shing: har bir bayer — so‘ralayotgan limit va to‘lov muddati bilan. Reyestrda yo‘q bayerni faqat nomi bilan kiritish mumkin: axborot menejeri tashkilotni yaratadi, siz esa uni ariza bilan {{ui:requests.actions.resolve}}.
3. Arizani yuboring. Keyin u o‘zi harakatlanadi: {{ui:requests.statuses.entity_resolution}} → {{ui:requests.statuses.underwriting}} (kredit anderraytingi: reytinglar va limitlar) → {{ui:requests.statuses.commercial_review}} (polis shartlari) → {{ui:requests.statuses.sales_confirmation}}.
4. {{ui:requests.statuses.sales_confirmation}} bosqichida shartlar va limitlar bo‘yicha qarorlarni tekshiring va mijozga taklif yuboring — ariza {{ui:requests.statuses.client_review}} holatiga o‘tadi.
5. Mijoz portalda taklifni qabul qiladi (yoki siz uning javobini qayd etasiz). Ariza {{ui:requests.statuses.accepted}} bo‘ladi.
6. Polisni rasmiylashtiring: raqam, boshlanish va tugash sanalarini kiriting. Tizim kelishilgan shartlarni polisga o‘tkazadi, paket limitlarini unga bog‘laydi va arizani {{ui:requests.statuses.bound}} holatiga o‘tkazadi.

## Natija

Arizaning barcha shartlari va limitlari bilan polis yaratildi; sug‘urtalanuvchi uni portalda ko‘radi.

## Ko‘p uchraydigan xatolar

- **Mijoz boshqa shartlarni so‘raydi.** Ariza {{ui:requests.statuses.client_review}} dan {{ui:requests.statuses.sales_confirmation}} ga mijoz izohi bilan qaytadi, izoh kun tartibingizda.
- **Taklif muddati tugagan.** Muddati o‘tgan taklifni na portal orqali, na «Mening arizalarim» orqali qabul qilib bo‘lmaydi; yangi versiyani tayyorlang.
