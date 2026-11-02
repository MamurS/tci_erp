---
id: claims-claim
title: A claim: from opening to decision
roles: [claims]
pages: ["/claims", "/claims/:id"]
order: 2
---

## When to use it

A policyholder filed a claim in the portal, or an overdue account must become a claim.

## Steps

1. A claim opens from an overdue notification (the {{ui:agenda.actions.openClaim}} button) or is filed by the policyholder. Its number is CL-YYYY-NNNN.
2. Tab {{ui:claims.tabs.documents}}: the required documents. A claim cannot be filed without them — the system names the missing ones.
3. Tab {{ui:claims.tabs.invoices}}: invoices with their shipment dates. Check the cover (see {{link:claims-coverage}}).
4. Information needed — ask the policyholder: status {{ui:claims.statuses.info_requested}}, a task in their portal.
5. Tab {{ui:claims.tabs.indemnity}}: the indemnity calculation. Approve the claim — {{ui:claims.statuses.approved}} or {{ui:claims.statuses.partially_approved}} follows from the uncovered part of the debt, not from a choice — or decline it.
6. Tab {{ui:claims.tabs.money}}: payments and recoveries (see {{link:claims-money}}).

## Result

On approval the indemnity calculation is frozen onto the claim: money moved on it.

## Common mistakes

- **Approving a claim below the NQL threshold.** The system refuses with the reason: a loss below the {{term:nql|non-qualifying loss}} is not paid.
