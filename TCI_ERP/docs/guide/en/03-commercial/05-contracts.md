---
id: commercial-contracts
title: Draft contracts: generate, edit, sign
roles: [commercial_underwriter, sales]
pages: ["/policies/contracts/:draftId", "/policies/contracts/:draftId/edit", "/policies/contracts/:draftId/compare"]
order: 5
---

## When to use it

An insurance contract must be prepared for a policy or a submission.

## Steps

1. {{ui:nav.policies}} › {{ui:policies.views.contracts}}: pick the policy or the submission and press {{ui:wording.generate.open}}. An active contract template for the country, language and product is needed.
2. The document opens in the editor. The values from the policy are field chips; refresh them from the data without touching the words.
3. Every save is a new version with its author and a note. Compare any two versions, restore any one (as a new version).
4. Send it for review: a task goes to commercial underwriting. You may share the draft with the client — they see exactly the shared version and can comment.
5. Agree, then sign: upload the scan of the signed PDF. A signed contract is locked for good.

## Result

The signed contract and the whole chain of versions are kept; export to DOCX and print to PDF.

## Common mistakes

- **Generating the draft again over manual edits.** The system asks for confirmation: the manual edits are replaced by a new version from the template.
- **Editing an agreed contract.** Only the commercial underwriter can send it back to draft, with a reason.
