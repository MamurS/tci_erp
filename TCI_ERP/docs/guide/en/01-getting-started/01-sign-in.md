---
id: start-sign-in
title: Signing in, password and second factor
roles: [all]
pages: ["/login", "/mfa/verify", "/change-password", "/account"]
order: 1
---

## When to use it

On your first sign-in, after the administrator resets your password, and whenever the system asks for a second-factor code.

## Steps

1. Open the system's address, enter your email and password, then press {{ui:auth.signIn}}.

{{shot:start-sign-in}}

2. The first sign-in uses the temporary password the administrator gave you. The system opens the change-password page straight away: choose your own password — at least 12 characters — and save it. Until the password is changed, no other screen opens.
3. If {{ui:account.mfa.title}} is on for your role, enter the 6-digit code from your authenticator app. You connect the app on {{ui:account.title}} (the user menu, top right).
4. After you sign in, the system may tell you about failed sign-in attempts with your email. If it was you, press {{ui:security.notice.thisWasMe}}; if not, change your password and tell the administrator.

## Result

The dashboard opens in your role's workspace. {{ui:account.title}} holds your password, second factor, your sessions and the display settings.

## Common mistakes

- **The password is refused several times in a row.** After a few failed attempts sign-in is paused, and the pause grows with each new failure. Wait for the countdown on the sign-in page to end.
- **"Forgot your password?"** The administrator resets passwords: you receive a temporary password and change it when you sign in.
- **No second-factor code.** Without the authenticator app you cannot sign in — contact the administrator.
