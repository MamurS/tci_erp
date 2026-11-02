---
id: claims-coverage
title: Checking cover and calculating the indemnity
roles: [claims, commercial_underwriter]
order: 3
---

## Cover is judged at the shipment date

For each invoice the system reconstructs the limit in force **at the shipment date** from the decision history. A limit revoked today does not withdraw cover for last month's shipments, and an increase granted today does not cover them backwards.

Invoices are walked in shipment order; the debt builds up in full, covered or not — an uncovered shipment fills the limit too.

## The verdict per invoice

- **A shortfall** (above the limit or the discretionary limit) — part is covered.
- **A breach** (payment terms beyond the maximum, a shipment outside the policy period, a revoked or declined limit, a missed notification duty) — nothing is covered.

Staff may override a verdict with a reason; the system's verdict stays beside it.

## The indemnity

1. The covered debt (after overrides).
2. The {{term:nql|NQL}} threshold: the debt is at least the threshold — otherwise nothing is payable. Equal to the threshold passes.
3. × the {{term:insured-percentage|insured percentage}}.
4. − the {{term:deductible|deductible}} per loss.
5. − what is left of the {{term:afl|aggregate first loss}} after earlier claims.
6. No more than what is left of the {{term:max-liability|maximum liability}}.

No step goes below zero; the whole calculation is shown on the {{ui:claims.tabs.indemnity}} tab.
