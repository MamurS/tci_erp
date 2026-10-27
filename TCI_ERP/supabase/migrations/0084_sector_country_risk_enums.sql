-- 0084_sector_country_risk_enums.sql
--
-- What: five Agenda task types for sector grades, country risk and sanctions
--       (Prompt 31): sector_review_due (the responsible analyst's quarterly
--       review), sector_review_approval (a second analyst's four-eyes check,
--       when enabled), sector_downgrade_review (credit underwriting looks at
--       the buyers with limits in a sector downgraded to C or D),
--       sanctions_limit_review (an in-force limit on a newly sanctioned
--       country or company — urgent) and country_override_approval (the head
--       of credit analysis approves an internal country grade).
-- Why:  a value added to an enum cannot be used in the transaction that adds
--       it, and every migration file is one transaction; 0085 uses them.

alter type tci.task_type add value if not exists 'sector_review_due';
alter type tci.task_type add value if not exists 'sector_review_approval';
alter type tci.task_type add value if not exists 'sector_downgrade_review';
alter type tci.task_type add value if not exists 'sanctions_limit_review';
alter type tci.task_type add value if not exists 'country_override_approval';
