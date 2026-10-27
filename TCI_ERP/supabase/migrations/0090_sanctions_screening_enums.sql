-- 0090_sanctions_screening_enums.sql
--
-- What: two Agenda task types for sanctions screening (owner request
--       2026-10-27): sanctions_match_review (a possible match of a buyer,
--       its owners or its beneficial owners against an official list, for
--       the least-loaded credit analyst) and sanctions_list_due (the lists in
--       use are missing or older than workflow_settings.sanctions_list_stale_days).
-- Why:  a value added to an enum cannot be used in the transaction that adds
--       it, and every migration file is one transaction; 0091 uses them.

alter type tci.task_type add value if not exists 'sanctions_match_review';
alter type tci.task_type add value if not exists 'sanctions_list_due';
