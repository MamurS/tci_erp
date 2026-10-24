-- 0068_credit_analyst_role.sql
--
-- What: the department role `credit_analyst` («Кредитный аналитик», uz
--       «Kredit tahlilchisi») — Prompt 29 §2a.
-- Why:  a value added to an enum cannot be used in the transaction that adds
--       it, and every migration file is one transaction; 0069 gives the role
--       its capabilities, policies and Agenda routing.

alter type tci.user_role add value if not exists 'credit_analyst' after 'credit_underwriter';
