---
id: claims-claim
title: Da’vo: ochishdan qarorgacha
roles: [claims]
pages: ["/claims", "/claims/:id"]
order: 2
---

## Qachon foydalaniladi

Sug‘urtalanuvchi portalda da’vo topshirdi yoki muddati o‘tgan qarzni da’voga o‘tkazish kerak.

## Qadamlar

1. Da’vo xabarnomadan ({{ui:agenda.actions.openClaim}} tugmasi) ochiladi yoki sug‘urtalanuvchi tomonidan topshiriladi. Raqami — CL-YYYY-NNNN.
2. {{ui:claims.tabs.documents}} varag‘i: majburiy hujjatlar. Ularsiz da’vo topshirib bo‘lmaydi — tizim yetishmayotganlarini nomlaydi.
3. {{ui:claims.tabs.invoices}} varag‘i: jo‘natish sanalari bilan hisob-fakturalar. Qoplashni tekshiring ({{link:claims-coverage}} ga qarang).
4. Ma’lumot kerak — sug‘urtalanuvchidan so‘rang: {{ui:claims.statuses.info_requested}} holati, sug‘urtalanuvchining portalida vazifa.
5. {{ui:claims.tabs.indemnity}} varag‘i: tovon hisobi. Da’voni tan oling — {{ui:claims.statuses.approved}} yoki {{ui:claims.statuses.partially_approved}} holati tanlov bilan emas, qarzning qoplanmagan qismi bilan belgilanadi — yoki rad eting.
6. {{ui:claims.tabs.money}} varag‘i: to‘lovlar va undirishlar ({{link:claims-money}} ga qarang).

## Natija

Tan olinganda tovon hisobi da’voda qotiriladi: pul u bo‘yicha harakatlangan.

## Ko‘p uchraydigan xatolar

- **NQL chegarasidan past da’voni tan olish.** Tizim tushuntirish bilan rad etadi: {{term:nql|qoplanmaydigan zarardan}} kichik zarar qoplanmaydi.
