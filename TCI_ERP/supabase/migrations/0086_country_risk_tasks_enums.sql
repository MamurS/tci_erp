-- 0086_country_risk_tasks_enums.sql
--
-- What: two Agenda task types for keeping the OECD country list current
--       (owner request 2026-10-27): oecd_review_due (admin is reminded to
--       check the OECD for a new list once the one in use is older than
--       workflow_settings.oecd_stale_months) and country_downgrade_review
--       (credit underwriting looks at the buyers with in-force limits in the
--       countries a new import made worse).
-- Why:  a value added to an enum cannot be used in the transaction that adds
--       it, and every migration file is one transaction; 0087 uses them.

alter type tci.task_type add value if not exists 'oecd_review_due';
alter type tci.task_type add value if not exists 'country_downgrade_review';
