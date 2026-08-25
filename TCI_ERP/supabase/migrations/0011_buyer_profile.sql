-- 0011_buyer_profile.sql
-- What: founded_date and legal_form on the buyer profile.
-- Why:  the Risk Report cover needs them, and founded_date activates the
--       previously-excluded company-age rating factor (fairly excluded
--       while the date is unknown).

alter table tci.buyers
  add column founded_date date,
  add column legal_form text;
