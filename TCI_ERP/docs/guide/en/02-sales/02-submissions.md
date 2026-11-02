---
id: sales-submissions
title: A submission: from draft to policy
roles: [sales]
pages: ["/requests", "/requests/:id"]
order: 2
---

## When to use it

A client wants to insure trade receivables, or a client filed a submission in the portal.

## Steps

1. {{ui:nav.requests}} › {{ui:requests.actions.create}}. Pick the policyholder or create the company, enter the expected turnover, the currency and the terms wanted.

{{shot:sales-submissions}}

2. Add the **buyer package**: each buyer with the limit requested and the payment terms. A buyer not in the registry can be entered by name only: an information manager creates the company, and you {{ui:requests.actions.resolve}} it to the submission.
3. Submit. From here it moves by itself: {{ui:requests.statuses.entity_resolution}} → {{ui:requests.statuses.underwriting}} (credit underwriting: ratings and limits) → {{ui:requests.statuses.commercial_review}} (policy terms) → {{ui:requests.statuses.sales_confirmation}}.
4. At {{ui:requests.statuses.sales_confirmation}} check the terms and the limit decisions and send the client an offer — the submission moves to {{ui:requests.statuses.client_review}}.
5. The client accepts the offer in the portal (or you record their answer). The submission becomes {{ui:requests.statuses.accepted}}.
6. Bind the policy: enter the number, the inception and expiry dates. The system copies the agreed terms into the policy, adopts the package's limits onto it and moves the submission to {{ui:requests.statuses.bound}}.

## Result

A policy exists with every term and limit of the submission; the policyholder sees it in the portal.

## Common mistakes

- **The client asks for other terms.** The submission goes back from {{ui:requests.statuses.client_review}} to {{ui:requests.statuses.sales_confirmation}} with the client's comment in your Agenda.
- **The offer has expired.** An expired offer cannot be accepted, neither in the portal nor through "My submissions"; prepare a new version.
