---
id: analysis-adt
title: ADT va guruh reytingi
roles: [credit_analyst, credit_underwriter]
order: 7
---

## ADT (avtomatik qaror chegarasi)

{{term:adt|ADT}} — bayer bo‘yicha limit so‘rovlari avtomatik hal qilinadigan summa va bunday qarorlar soni (1 dan 5 gacha). U {{ui:entities.tabs.rating}} varag‘ida bayer reyting diapazoni uchun vakolatingiz doirasida belgilanadi. Hisoblagich bayerga tegishli va barcha sug‘urtalanuvchilar uchun umumiy.

Avtoqaror faqat **barcha** shartlar bajarilganda qabul qilinadi: avtoqarorlarni administrator yoqgan, ADT faol va tugamagan, polis amalda, summa ADT dan ham, tavsiya etilgan limitdan ham oshmaydi va to‘xtatuvchi omillar yo‘q (ochiq muddati o‘tganlik haqida xabarnoma, da’vo, bekor qilingan limit, taqiq, eskirgan hisobot, guruh limiti, sanksiya mosligi, qoplash matritsasi cheklovi). Aks holda so‘rov sabablar ro‘yxati bilan anderrayterga ketadi.

Reytingning ADT diapazonidan pastga tushishi, to‘xtatuvchi omil yoki eskirgan hisobot ADT ni to‘xtatadi va «Bayerni qayta ko‘rib chiqish / ADT ni yangilash» vazifasini ochadi.

## Guruh reytingi

Katta kredit tahlilchi {{term:group-rating|guruh reytingini}} {{ui:entities.tabs.group}} varag‘ida sabab bilan belgilaydi. U har bir ishtirokchi reytingini **yuqoridan cheklaydi**: belgilanganda yoki pasaytirilganda yaxshiroq reytingli ishtirokchilar yangi, cheklangan reyting oladi; guruh reytingini oshirish yoki tugatish hech kimni oshirmaydi.
