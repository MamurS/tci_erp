-- 0083_adt_count_max.sql
--
-- What: an ADT allows at most FIVE auto decisions (tci.buyer_adt.total_count
--       ≤ 5), next to 0061's 1–1000 check. Additive: the one ADT on canonical
--       has five, and every later one is set through set_buyer_adt, whose
--       insert this check now bounds.
-- Why:  owner, 2026-10-27 — an auto decision threshold is a short run of
--       decisions before a person looks at the buyer again; up to 1000 made
--       the ADT a standing limit. The form offers 1–5 from a list.

alter table tci.buyer_adt
  add constraint buyer_adt_total_count_max check (total_count <= 5);

comment on constraint buyer_adt_total_count_max on tci.buyer_adt is
  'At most five auto decisions per ADT (owner, 2026-10-27; 0083).';
