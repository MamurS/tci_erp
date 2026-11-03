---
id: credit-monitoring
title: Monitoring, overdue accounts and revoking a limit
roles: [credit_underwriter, commercial_underwriter, claims, sales]
pages: ["/overdues", "/overdues/:id"]
order: 6
---

## When to use it

A limit review, a worse grade, or an {{term:noa|overdue notification}} from the policyholder.

## Steps

1. {{ui:nav.limits}} › {{ui:limits.views.monitoring}} — what needs attention.
2. {{ui:nav.overdues}}: the policyholder (in the portal) or a member of staff files the overdue notification. On filing, the limit on the buyer is **suspended automatically** and the policyholder sees that at once.
3. Payment of the debt closes the notification as {{ui:overdues.statuses.resolved_paid}}, but does **not** reinstate the limit: the next limit is a fresh credit decision.
4. If the debt is still unpaid when the waiting period ends, the notification becomes a claim.
5. The risk has worsened — {{ui:limits.actions.revoke}}: a revocation reaches the policyholder at once, bypassing the commercial stage and the sales window.

## Result

A revocation or a new decision is recorded as new rows of the history; earlier decisions never change.

## Common mistakes

- **Thinking a revocation withdraws cover for goods already shipped.** Cover is judged at the shipment date, by the decision in force then.
