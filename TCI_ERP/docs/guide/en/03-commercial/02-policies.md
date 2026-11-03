---
id: commercial-policies
title: Policies: register, creation, statuses
roles: [commercial_underwriter, sales]
pages: ["/policies", "/policies/new", "/policies/:id", "/policies/:id/edit"]
order: 2
---

## When to use it

To create a policy by hand, change its terms or status, see its premium and limits.

## Steps

1. {{ui:nav.policies}} — a section with the views {{ui:policies.views.overview}}, {{ui:policies.views.registry}}, {{ui:policies.views.contracts}} and {{ui:policies.views.templates}}.

{{shot:commercial-policies}}

2. A new policy starts as a draft. Usually it appears by itself — when sales binds a submission.
3. Open a policy: the header with the status, the key figures, the tabs for terms, limits, premium and declarations.
4. Only the commercial underwriter changes the status: {{ui:policies.statuses.draft}} → {{ui:policies.statuses.active}} → {{ui:policies.statuses.suspended}} / {{ui:policies.statuses.expired}} / {{ui:policies.statuses.cancelled}} / {{ui:policies.statuses.annulled}}.

## Result

Every status change is recorded in the policy's history with its author and comment.

## Common mistakes

- **Confusing cancellation and annulment.** {{term:cancellation|Cancellation}} ends the policy from a date and what came before stands; {{term:annulment|annulment}} voids it as if never concluded, and the premium is returned.
- **Expecting a premium schedule on an old policy.** On a policy created before schedules existed, press "Create schedule" on the premium tab.
