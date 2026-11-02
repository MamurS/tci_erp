---
id: analysis-statements
title: Financial statements: entry and analysis
roles: [credit_analyst, information_manager]
pages: ["/entities/:id/statements/new", "/entities/:id/statements/:statementId/edit"]
order: 2
---

## When to use it

A buyer's annual or interim statements have arrived.

## Steps

1. Company card › {{ui:entities.tabs.financials}} › add statements.
2. The form follows the **buyer's country**: national forms (Uzbekistan, Russia, Kazakhstan, Germany and others) with their line codes, or IFRS. Statements already saved stay on the form they were entered on.
3. Enter the period, the currency and the units (units, thousands, millions). Enter the lines; the form computes its totals.
4. Save. The system maps the statements to IFRS and runs the cross-checks: a total that does not reconcile is shown as a warning.
5. Analysis is on the same tab: vertical and horizontal analysis, ratios, cash flow, the Altman Z-score.

## Result

The statements are ready for rating; if a limit request on the buyer was waiting in information gathering, it returns to the queue by itself.

## Common mistakes

- **Mixing up the units.** Statements in thousands entered as units distort both the grade and the {{term:recommended-limit|recommended limit}}.
