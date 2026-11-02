---
id: start-companies
title: Companies and the company card
roles: [all]
pages: ["/entities", "/entities/:id"]
order: 6
---

{{ui:nav.entities}} is one registry: {{term:buyer|buyers}} and {{term:policyholder|policyholders}} are both companies. A company's role is not assigned but **computed**: whoever holds a policy is a policyholder, whoever a limit is requested on is a buyer.

## The company card

At the top: the name, the grade, the sanctions mark and the policyholder tier. Below, the tabs:

- {{ui:entities.tabs.overview}} — the online risk report;
- {{ui:entities.tabs.financials}} — financial statements and analysis;
- {{ui:entities.tabs.rating}} — the grade, the recommended limit, rating proposals, agency ratings, ADT;
- {{ui:entities.tabs.limits}}, {{ui:entities.tabs.policies}}, {{ui:entities.tabs.requests}}, {{ui:entities.tabs.claims}};
- {{ui:entities.tabs.group}} — the corporate group, the group rating, possible relationships;
- {{ui:entities.tabs.sanctions}} — beneficial owners and screening results.

A tab shows only when it means something for this company and your role.

## A new company

On entry the system checks for duplicates: the same registration number in the same country blocks creation, similar names are shown as a hint. If you may not create companies, use {{ui:data.notFound.request}}.
