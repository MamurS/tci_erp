-- Owner step for migration 0057 (contract drafts) on the canonical project.
-- Run once in the Supabase SQL Editor of project tci_erp (reunqrpeumokqgarknge).
--
-- Sections 1-9 of 0057 are already applied. This is its section 10: the guard
-- that refuses REMOVING a contract version, a status-history row or a comment
-- - for everyone, the owner included. (No API role can remove them anyway;
-- this closes it for direct SQL too.) The tooling used for the rest of the
-- migration cannot run a statement naming row removal, so it is yours.

begin;

create trigger contract_versions_no_removal
  before delete on tci.contract_versions
  for each row execute function tci.refuse_contract_history_change();
create trigger contract_draft_status_history_no_removal
  before delete on tci.contract_draft_status_history
  for each row execute function tci.refuse_contract_history_change();
create trigger contract_draft_comments_no_removal
  before delete on tci.contract_draft_comments
  for each row execute function tci.refuse_contract_history_change();

do $$
begin
  if (select count(*) from pg_trigger
       where tgname in ('contract_versions_no_removal', 'contract_draft_status_history_no_removal',
                        'contract_draft_comments_no_removal')) <> 3 then
    raise exception '0057 section 10: the three removal guards are not all in place';
  end if;
end
$$;

commit;
