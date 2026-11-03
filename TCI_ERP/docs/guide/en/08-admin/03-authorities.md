---
id: admin-authorities
title: Authority, levels and workflow settings
roles: [admin]
order: 3
---

## When to use it

A new underwriter, a change in the authority structure, switching auto decisions on.

## Steps

1. {{ui:nav.admin}} › {{ui:admin.tabs.authorities}}.
2. **Personal grants**: person × stream (credit / commercial) × rating band × amount × currency × validity.
3. **Authority levels**: ranks 1–4 with the level's grants per band and its members; rank 5 is the committee with a chair. Routing: "direct" or "sequential".
4. **Credit analysis mode**: "combined" or "separate".
5. The default **rating scorecard weights**.
6. **Auto decisions (ADT)**: the global switch. Switch it on only once the model is calibrated and the analytics service is hosted.

## Result

A person's authority is the larger of their personal grants and their level's. The administrator holds none.

## Common mistakes

- **A grant in a currency with no rate.** Without a UZS rate such a grant is left out of the comparison.
