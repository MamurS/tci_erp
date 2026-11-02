---
id: start-sign-in
title: Kirish, parol va ikkinchi omil
roles: [all]
pages: ["/login", "/mfa/verify", "/change-password", "/account"]
order: 1
---

## Qachon foydalaniladi

Birinchi kirishda, administrator parolingizni tiklagandan keyin va tizim ikkinchi omil kodini so‘raganda.

## Qadamlar

1. Tizim manzilini oching, elektron pochta va parolni kiriting, so‘ng {{ui:auth.signIn}} tugmasini bosing.

{{shot:start-sign-in}}

2. Birinchi kirish administrator bergan vaqtinchalik parol bilan amalga oshiriladi. Tizim darhol parolni almashtirish sahifasini ochadi: kamida 12 belgidan iborat o‘z parolingizni o‘ylab toping va saqlang. Parol almashtirilmaguncha boshqa hech bir ekran ochilmaydi.
3. Agar rolingiz uchun {{ui:account.mfa.title}} yoqilgan bo‘lsa, autentifikator ilovasidagi 6 xonali kodni kiriting. Ilovani {{ui:account.title}} sahifasida ulaysiz (o‘ng yuqoridagi foydalanuvchi menyusi).
4. Kirgandan keyin tizim elektron pochtangiz bilan muvaffaqiyatsiz kirish urinishlari haqida xabar berishi mumkin. Agar bu siz bo‘lsangiz, {{ui:security.notice.thisWasMe}} tugmasini bosing; aks holda parolni almashtiring va administratorga xabar bering.

## Natija

Rolingiz ish maydonida boshqaruv paneli ochiladi. {{ui:account.title}} sahifasida parol, ikkinchi omil, seanslaringiz va ko‘rinish sozlamalari saqlanadi.

## Ko‘p uchraydigan xatolar

- **Parol bir necha marta ketma-ket qabul qilinmaydi.** Bir necha muvaffaqiyatsiz urinishdan keyin kirish vaqtincha to‘xtatiladi va har bir yangi xatoda tanaffus uzayadi. Kirish sahifasidagi teskari hisob tugashini kuting.
- **«Parolni unutdingizmi?»** Parolni administrator tiklaydi: siz vaqtinchalik parol olasiz va kirishda uni almashtirasiz.
- **Ikkinchi omil kodi yo‘q.** Autentifikator ilovasisiz kirib bo‘lmaydi — administratorga murojaat qiling.
