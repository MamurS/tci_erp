---
id: analysis-adt
title: ADT and the group rating
roles: [credit_analyst, credit_underwriter]
order: 7
---

## ADT (auto decision threshold)

The {{term:adt|ADT}} is the amount up to which limit requests on a buyer are decided automatically, and how many such decisions (1 to 5). It is set on the {{ui:entities.tabs.rating}} tab within your authority for the buyer's rating band. The counter belongs to the buyer and is shared by every policyholder.

An auto decision is made only when **all** conditions hold: auto decisions are switched on by the administrator, the ADT is active and not used up, the policy is active, the amount is no more than the ADT and no more than the recommended limit, and there is no stop factor (an open overdue notification, a claim, a revoked limit, a ban, stale statements, the group limit, a sanctions match, a cover-matrix restriction). Otherwise the request goes to an underwriter with the reasons listed.

A downgrade below the ADT's band, a stop factor or stale statements suspend the ADT and open the task "Buyer review / update the ADT".

## The group rating

A senior credit analyst sets the {{term:group-rating|group rating}} on the {{ui:entities.tabs.group}} tab — with a reason. It **caps** every member's grade: setting or lowering it gives each member with a better grade a new, capped grade; raising or ending the group rating raises nobody.
