---
id: credit-authority
title: Authority, validation and the committee
roles: [credit_underwriter, commercial_underwriter, admin]
order: 4
---

## Authority

{{term:authority|Authority}} is a matrix: person × stream (credit or commercial) × {{term:rating-band|rating band}} (A, B, C, D, unrated) × amount × currency × validity. The request's amount is converted to UZS. Your authority is the larger of your personal grants and those of your {{term:authority-level|level}}. Nobody's authority is unlimited, the administrator's included.

## Send for validation

1. A decision above your authority: on the request page press {{ui:limits.validation.send}}. You may send one within your authority too — then a comment is required.
2. The proposed decision goes to an authority level: in "direct" routing to the lowest rank that covers the amount (the ranks in between are told), in "sequential" routing to the next rank.
3. While it is on validation the request is {{ui:limits.statuses.escalated}}: the decision does not exist yet and the client does not see it.
4. Any eligible member of the level answers: approve, approve modified within their own authority, return to the author, reject, or forward up.

## The committee

Rank 5 is the {{term:committee|committee}}. Members vote (approve, reject with a reason, abstain); a conflict of interest is declared and bars the member. Quorum is at least half; simple majority; a tie goes the chair's way; without the chair's vote the proposal returns to the author.
