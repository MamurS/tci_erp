---
id: data-daily
title: A day in data management
roles: [information_manager]
order: 1
---

## When to use it

Every day.

## Steps

1. {{ui:nav.agenda}}: a company request, a statements request, a buyer in a submission with no company, a limit request waiting for data.
2. {{ui:nav.data}} › {{ui:data.views.queue}}: take a request and resolve it (see {{link:data-requests}}).

{{shot:data-requests}}

3. {{ui:data.views.proposals}}: buyers clients proposed by name in the portal.
4. {{ui:data.views.freshness}}: companies with live business that have no statements, statements older than 15 months, or missing particulars.

## Result

Requests resolved, no limit request waiting for data.

## Common mistakes

- **Creating a company without checking duplicates.** The form warns about similar names — check them.
