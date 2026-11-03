---
id: credit-rules
title: Four eyes, the cover matrix, information gathering
roles: [credit_underwriter]
order: 5
---

## Four eyes

- Whoever raised a limit request never takes it into review, decides it, proposes a decision on it, validates it or adjusts it.
- Whoever made the credit decision does not run its commercial stage.
- In separate credit analysis, whoever calculated or confirmed the buyer's current grade does not decide the limit on it.

## The cover matrix

The {{term:cover-matrix|cover matrix}} raises the lowest rank that may decide, from the OECD country category (or an approved internal one) and the sector grade: categories 0–3 — no restriction, 4–5 — rank 3, 6 — rank 4, 7 and "not classified" — the committee; a D sector adds a rank. Until an OECD list is loaded, the country part is silent.

## Sanctions

A sanctions flag on the buyer or its country means no cover: an approval is refused for any author. A decline, a reduction to nothing and a revocation remain possible.

## Information gathering

A request whose buyer lacks a registration number, an address, an industry or statements for a period ending within 18 months goes to {{ui:limits.statuses.information_gathering}}. Entering the data returns it to the queue by itself; {{ui:limits.information.recheck}} checks at once. A credit underwriter may waive the requirement with a reason — never on their own request.
