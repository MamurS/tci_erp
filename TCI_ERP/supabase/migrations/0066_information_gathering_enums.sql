-- 0066_information_gathering_enums.sql
--
-- What: two enum values for limit-request routing (Prompt 29 §2):
--       tci.limit_request_status 'information_gathering' (after 'submitted')
--       and tci.task_type 'limit_information_needed'.
-- Why:  a value added to an enum cannot be used in the transaction that adds
--       it (an index predicate or a view that names it would fail), and every
--       migration file is one transaction. 0067 uses both.

alter type tci.limit_request_status add value if not exists 'information_gathering' after 'submitted';
alter type tci.task_type add value if not exists 'limit_information_needed';
