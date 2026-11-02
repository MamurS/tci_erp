---
id: start-sanctions
title: Sanctions: checking a name
roles: [all]
pages: ["/sanctions"]
order: 7
---

{{ui:nav.sanctions}} is open to everyone on staff. Here you check any name against the official sanctions lists (OFAC SDN, UN, EU, UK and any other loaded), see the possible matches, the loaded lists and the live {{term:sanctions|sanctions flags}}.

## Check a name

1. Open {{ui:nav.sanctions}}.
2. Type a person's or a company's name.
3. The system shows the nearest list entries with a similarity score. Case, Cyrillic or Latin script and the legal form ("LLC", "MChJ") do not matter.

Companies and their {{term:beneficial-owner|beneficial owners}} are screened automatically — when a rating is created, a limit request is submitted, owners or the name change, and after a new list is loaded. A credit analyst reviews the matches (see {{link:analysis-sanctions}}).

> [!WARNING]
> A sanctions flag means **no cover**: the database refuses a new limit request, a limit approval, a submission and a policy for the flagged company or country — whoever tries.
