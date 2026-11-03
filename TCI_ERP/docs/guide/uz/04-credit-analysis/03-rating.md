---
id: analysis-rating
title: Reyting: hisoblash, tasdiqlash, qo‘lda belgilangan reyting
roles: [credit_analyst, credit_underwriter]
order: 3
---

## Qachon foydalaniladi

Bayerda reyting yo‘q, yangi hisobot keldi yoki reyting eskirgan.

## Qadamlar

1. Tashkilot kartochkasi › {{ui:entities.tabs.rating}} › hisoblash. Model {{term:recommended-grade|tavsiya etilgan reyting}} va {{term:recommended-limit|tavsiya etilgan limitni}} omillar bo‘yicha taqsimot bilan beradi.
2. **O‘zgarishsiz tasdiqlash** — {{ui:rating.confirmation.confirm}}. Reytingni hisoblagan xodim uni o‘zi tasdiqlamaydi.
3. **O‘z reytingingiz** — {{term:scorecard|baholash kartasini}} tuzing: to‘rt blok (umumiy, kapital va qarz, foyda va zarar, to‘lov intizomi), har birida subreyting, vazn va standart sabab. Tizim tortilgan reytingni hisoblaydi; yakuniy reyting undan faqat mos yo‘nalishdagi sabab bilan farq qilishi mumkin. Asoslash majburiy.
4. Tasdiqlash yo‘nalishini tanlang:
   - **o‘zim tasdiqlayman** — reyting darhol kuchga kiradi (agar sizda baholash ham, tasdiqlash ham huquqi bo‘lsa);
   - **hamkasbga** — nomlangan hamkasbga yoki reytinglarni tasdiqlaydigan istalgan kishiga;
   - **vakolat darajalari bo‘yicha** — darajadan darajaga qo‘mitagacha {{term:escalate|yuqoriga yo‘naltirish}}.
5. Hisobotsiz {{term:manual-rating|qo‘lda belgilangan reytingni}} taklif qilish mumkin — majburiy sabab bilan. Qo‘lda belgilangan reytingda tavsiya etilgan limit yo‘q, shuning uchun unga asoslangan avtoqaror bo‘lmaydi.

## Natija

{{term:grade|Reyting}} kuchga kiradi — va u bilan limitlar bo‘yicha qarorlar vakolati hisoblanadigan {{term:rating-band|reyting diapazoni}}.

## Ko‘p uchraydigan xatolar

- **Guruh reytingidan yuqori reyting.** Guruhning reytingi bo‘lsa, ishtirokchining reytingi undan yaxshi bo‘lishi mumkin emas: tizim hisoblangan reytingni pasaytiradi va undan yuqori taklifni rad etadi.
- **Bitta bayer bo‘yicha ikkita taklif.** Bitta bayer uchun faqat bitta kutilayotgan reyting taklifi bo‘lishi mumkin.
