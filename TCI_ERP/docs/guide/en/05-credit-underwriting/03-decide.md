---
id: credit-decide
title: Deciding a limit request
roles: [credit_underwriter]
pages: ["/limits/:id"]
order: 3
---

## When to use it

A limit request waits for a credit decision.

## Steps

1. Open the request: on the right, the buyer, their grade, the recommended limit, other active limits, the group, open overdue notifications.
2. Press {{ui:limits.actions.startReview}} — the request moves to {{ui:limits.statuses.under_review}}.
3. Fill in the decision: {{ui:limits.outcomes.approved}}, {{ui:limits.outcomes.partial}} or {{ui:limits.outcomes.declined}}; amount, payment terms, validity, conditions. The meters above the form show your authority and the group exposure after the decision.
4. {{ui:limits.actions.decide}}. If the amount in UZS is above your authority for the rating band, nothing is recorded: the system offers {{ui:limits.validation.send}} (see {{link:credit-authority}}).
5. If the decision would exceed the {{term:group-limit|group limit}}, the request moves to {{ui:limits.statuses.escalated}} and the credit desk gets a task.

## Result

A decision never changes: a new decision supersedes the old one, and the whole history is visible. An approval goes to the commercial stage and the sales window; a decline goes at once.

## Common mistakes

- **Expecting a reduction to wait for the sales window.** A reduction and a revocation ({{ui:limits.actions.revoke}}) reach the policyholder at once.
- **Deciding without a grade.** With no assessment the rating band is "unrated", and the authority for it is usually the smallest.
