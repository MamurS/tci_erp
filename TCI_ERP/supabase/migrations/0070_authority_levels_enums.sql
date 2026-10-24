-- 0070_authority_levels_enums.sql
--
-- What: the Agenda type 'limit_validation_fyi' (Prompt 29 §4a): a rank the
--       direct routing skips is told about the proposal, for information.
-- Why:  a value added to an enum cannot be used in the transaction that adds
--       it, and every migration file is one transaction; 0071 uses it.

alter type tci.task_type add value if not exists 'limit_validation_fyi';
