---
id: analysis-rating
title: The grade: calculate, confirm, manual rating
roles: [credit_analyst, credit_underwriter]
order: 3
---

## When to use it

A buyer has no grade, new statements have arrived or the grade is stale.

## Steps

1. Company card › {{ui:entities.tabs.rating}} › calculate. The model gives the {{term:recommended-grade|recommended grade}} and the {{term:recommended-limit|recommended limit}} with a breakdown by factor.
2. **Confirm as is** — {{ui:rating.confirmation.confirm}}. Whoever calculated a grade never confirms it.
3. **Your own grade** — build the {{term:scorecard|scorecard}}: four pillars (general, equity and debt, profit and loss, payment behaviour), each with a sub-grade, a weight and a standard reason. The system computes the weighted grade; the overall grade may differ from it only with a reason of the matching direction. A justification is required.
4. Choose how it is approved:
   - **approve myself** — the grade is in force at once (if you may both rate and confirm);
   - **to a colleague** — a named colleague, or anyone who confirms ratings;
   - **up the authority levels** — {{term:escalate|escalate}} rank by rank up to the committee.
5. Without statements you may propose a {{term:manual-rating|manual rating}} — with a required reason. A manual rating has no recommended limit, so no auto decision ever rests on it.

## Result

The {{term:grade|grade}} comes into force — and with it the {{term:rating-band|rating band}} that sets the authority for limit decisions.

## Common mistakes

- **A grade above the group rating.** When the group has a rating, no member's grade may be better: the system lowers a calculated grade and refuses a proposal above it.
- **Two proposals on one buyer.** Only one rating proposal per buyer may be pending.
