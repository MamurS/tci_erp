-- What: the buyer package of a submission advances on its own.
--       tci.insurance_request_buyers.resolution_status went pending_entity ->
--       ready automatically (resolve_request_buyer), but rating_done and
--       limit_done were set by nobody: the badges on the submission page
--       stayed at «ready» after the buyer was rated and its limit decided.
--         * tci.buyer_progress_status(request, entity)  the status the FACTS
--             support: a credit-stage approved/partial decision in force for
--             the buyer inside this submission => limit_done; any rating of
--             the buyer => rating_done; otherwise ready
--         * tci.refresh_buyer_progress(request, entity)  moves matching rows
--             FORWARD only (ready -> rating_done -> limit_done), never back:
--             a later revocation is history, not an undone resolution
--         * an eighth AFTER INSERT trigger on tci.workflow_events calls it on
--           rating.created, limit.credit_decided, request.buyer_resolved and
--           request.buyer_added
--         * a one-off catch-up of the rows already in the database, asserted
-- Why:  the open item «buyer_resolution_status beyond ready is not advanced
--       automatically» (CLAUDE.md, Phase 3c-2). The status is a summary of
--       facts the database already holds, so it is computed from them in one
--       place rather than set by hand.
--
-- Only live submissions move: draft, declined, withdrawn and bound packages
-- are a record of what they were. A DECLINED limit leaves the buyer at
-- rating_done — «Лимит установлен» would be untrue — and the decision itself
-- is visible on the limit request.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------
create function tci.buyer_progress_status(p_request_id uuid, p_entity_id uuid)
returns tci.buyer_resolution_status
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
        from tci.credit_limit_requests r
        join tci.credit_limit_decisions d on d.request_id = r.id
       where r.insurance_request_id = p_request_id
         and r.entity_id = p_entity_id
         and d.stage = 'credit'
         and d.outcome in ('approved', 'partial')
         and d.lifecycle = 'effective')
      then 'limit_done'::tci.buyer_resolution_status
    when exists (select 1 from tci.credit_assessments a where a.entity_id = p_entity_id)
      then 'rating_done'::tci.buyer_resolution_status
    else 'ready'::tci.buyer_resolution_status
  end
$$;

comment on function tci.buyer_progress_status(uuid, uuid) is
  'The resolution status the facts support for a resolved buyer of a submission (0059): limit_done with an effective credit-stage approved/partial decision in that submission, rating_done with any rating, else ready.';

-- ---------------------------------------------------------------------------
-- 2. Forward-only refresh
-- ---------------------------------------------------------------------------
-- Enum order is the progress order: pending_entity < ready < rating_done <
-- limit_done, so "forward" is a plain comparison.
create function tci.refresh_buyer_progress(p_request_id uuid, p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  perform tci.require_internal_call();
  update tci.insurance_request_buyers b
     set resolution_status = s.status
    from (select tci.buyer_progress_status(b2.request_id, b2.entity_id) as status, b2.id
            from tci.insurance_request_buyers b2
            join tci.insurance_requests q on q.id = b2.request_id
           where b2.entity_id = p_entity_id
             and (p_request_id is null or b2.request_id = p_request_id)
             and b2.resolution_status <> 'pending_entity'
             and q.status not in ('draft', 'declined', 'withdrawn', 'bound')) s
   where b.id = s.id
     and s.status > b.resolution_status;
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

comment on function tci.refresh_buyer_progress(uuid, uuid) is
  'Moves the resolved buyer rows of live submissions (one submission, or every submission when p_request_id is null) FORWARD to tci.buyer_progress_status; never back. Internal: token only (0059).';

-- ---------------------------------------------------------------------------
-- 3. The trigger
-- ---------------------------------------------------------------------------
create function tci.handle_buyer_progress_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request uuid;
  v_entity  uuid;
begin
  if new.event_type = 'rating.created' then
    v_entity := (new.payload ->> 'entity_id')::uuid;
    v_request := null;                      -- every live submission of that buyer
  elsif new.event_type = 'limit.credit_decided' then
    select r.insurance_request_id, r.entity_id
      into v_request, v_entity
      from tci.credit_limit_decisions d
      join tci.credit_limit_requests r on r.id = d.request_id
     where d.id = new.object_id;
    if v_request is null then
      return null;                          -- a policy-scoped limit: no package
    end if;
  elsif new.event_type in ('request.buyer_resolved', 'request.buyer_added') then
    v_request := new.object_id;
    v_entity := (new.payload ->> 'entity_id')::uuid;
  else
    return null;
  end if;
  if v_entity is null then
    return null;
  end if;

  perform tci.begin_trusted_call();
  perform tci.refresh_buyer_progress(v_request, v_entity);
  return null;
end;
$$;

create trigger workflow_events_to_buyer_progress
  after insert on tci.workflow_events
  for each row execute function tci.handle_buyer_progress_event();

comment on function tci.handle_buyer_progress_event() is
  'Buyer package progress (0059): a rating, a credit decision or a buyer resolution moves the matching rows of live submissions forward (tci.refresh_buyer_progress).';

-- ---------------------------------------------------------------------------
-- 4. Grants: none of these is an API surface
-- ---------------------------------------------------------------------------
revoke all on function tci.buyer_progress_status(uuid, uuid) from public, anon;
grant execute on function tci.buyer_progress_status(uuid, uuid) to authenticated, service_role;
revoke all on function tci.refresh_buyer_progress(uuid, uuid) from public, anon, authenticated;
revoke all on function tci.handle_buyer_progress_event() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Catch up the rows already there, and prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_before   jsonb;
  v_after    jsonb;
  v_moved    integer := 0;
  v_pair     record;
  v_backward integer;
begin
  select coalesce(jsonb_object_agg(resolution_status, n), '{}') into v_before
    from (select resolution_status, count(*) n from tci.insurance_request_buyers group by 1) x;

  create temp table _buyer_progress_before on commit drop as
    select id, resolution_status from tci.insurance_request_buyers;

  perform tci.begin_trusted_call();
  for v_pair in
    select distinct b.request_id, b.entity_id
      from tci.insurance_request_buyers b
     where b.entity_id is not null and b.resolution_status <> 'pending_entity'
  loop
    v_moved := v_moved + tci.refresh_buyer_progress(v_pair.request_id, v_pair.entity_id);
  end loop;

  -- Nothing moved backwards, nothing was created or lost.
  select count(*) into v_backward
    from tci.insurance_request_buyers b
    join _buyer_progress_before p on p.id = b.id
   where b.resolution_status < p.resolution_status;
  if v_backward > 0 then
    raise exception '0059: % buyer rows moved backwards', v_backward;
  end if;
  if (select count(*) from tci.insurance_request_buyers) <> (select count(*) from _buyer_progress_before) then
    raise exception '0059: the buyer row count changed';
  end if;
  -- Every live resolved row now carries at least what its facts support.
  if exists (
    select 1
      from tci.insurance_request_buyers b
      join tci.insurance_requests q on q.id = b.request_id
     where b.resolution_status <> 'pending_entity'
       and q.status not in ('draft', 'declined', 'withdrawn', 'bound')
       and b.resolution_status < tci.buyer_progress_status(b.request_id, b.entity_id)) then
    raise exception '0059: a live buyer row is behind its facts after the catch-up';
  end if;

  select coalesce(jsonb_object_agg(resolution_status, n), '{}') into v_after
    from (select resolution_status, count(*) n from tci.insurance_request_buyers group by 1) x;
  raise notice '0059 catch-up: % rows moved forward; before %, after %', v_moved, v_before, v_after;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'workflow_events_to_buyer_progress'
                    and tgrelid = 'tci.workflow_events'::regclass) then
    raise exception '0059: the buyer progress trigger is missing';
  end if;
  if has_function_privilege('authenticated', 'tci.refresh_buyer_progress(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'tci.buyer_progress_status(uuid, uuid)', 'execute') then
    raise exception '0059: a progress function is reachable by an API role that must not reach it';
  end if;
  -- The enum order is what "forward" relies on.
  if not ('ready'::tci.buyer_resolution_status < 'rating_done'
          and 'rating_done'::tci.buyer_resolution_status < 'limit_done'
          and 'pending_entity'::tci.buyer_resolution_status < 'ready') then
    raise exception '0059: buyer_resolution_status is no longer in progress order';
  end if;
end;
$$;
