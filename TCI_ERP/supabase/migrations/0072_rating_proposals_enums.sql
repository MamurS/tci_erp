-- 0072_rating_proposals_enums.sql
--
-- What: the Agenda types of rating proposals (0073): `rating_proposal` (a
--       suggested grade waits for a colleague or an authority level) and
--       `rating_proposal_result` (the analyst hears how it ended; manual).
-- Why:  an enum value cannot be used in the transaction that adds it, so the
--       values come first, on their own.

alter type tci.task_type add value if not exists 'rating_proposal';
alter type tci.task_type add value if not exists 'rating_proposal_result';
