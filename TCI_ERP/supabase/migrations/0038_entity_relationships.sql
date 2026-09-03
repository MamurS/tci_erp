-- What: corporate relationships - tci.entity_relationships, the cycle-safe
--       recursive group resolution (tci.entity_group / v_entity_group), the
--       ultimate parent, and the group settings knobs.
-- Why:  Phase 6. Limits on related companies cannot be assessed in isolation:
--       a group failure hits every member at once, so there is no
--       diversification between them. Before exposure can be controlled at
--       group level the group has to be RESOLVABLE, and that is harder than it
--       looks for three reasons.
--
--   * COMPANIES DO OWN EACH OTHER. Cross-holdings and circular ownership are
--     real, not pathological, and a naive recursive CTE over them does not
--     terminate. The resolution therefore carries a VISITED SET down every
--     path and refuses to re-enter a node, with a depth cap as a second belt.
--     See the cycle-safety note on tci.entity_group below.
--   * THE GROUP HAS NO RECORD OF ITS OWN. Its identity is its ultimate parent
--     entity. There is no `groups` table to drift out of sync with the edges;
--     a group exists exactly as long as an edge implies it. (0040 adds
--     tci.group_limits, keyed by that parent - a limit ON a group, still not a
--     group record.)
--   * EDGES ARE BITEMPORAL-ISH AND DIRECTED, MEMBERSHIP IS NOT. An edge runs
--     parent -> child and has a validity window; membership is the undirected
--     closure over the edges valid TODAY. Walking one direction only would put
--     two sisters in different groups.
--
-- Clients never see any of this. There is no client policy on the table and no
-- v_client_* view, and 0040 asserts that stays true.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
-- tci.workflow_settings is the single-row knob table from 0019.

alter table tci.workflow_settings
  add column group_depth_cap int not null default 10
    check (group_depth_cap between 1 and 50),
  add column group_exposure_warn_pct numeric(5,2) not null default 90
    check (group_exposure_warn_pct > 0 and group_exposure_warn_pct <= 100);

comment on column tci.workflow_settings.group_depth_cap is
  'How many edges deep group resolution will walk. A belt beside the visited set, not the primary cycle defence.';
comment on column tci.workflow_settings.group_exposure_warn_pct is
  'Share of a group limit at which the Agenda raises a warning task. Default 90%.';

create function tci.group_depth_cap()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select group_depth_cap from tci.workflow_settings where id), 10)
$$;

create function tci.group_exposure_warn_pct()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select group_exposure_warn_pct from tci.workflow_settings where id), 90)
$$;

revoke execute on function tci.group_depth_cap(), tci.group_exposure_warn_pct() from public, anon;
grant execute on function tci.group_depth_cap(), tci.group_exposure_warn_pct()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The edges
-- ---------------------------------------------------------------------------

create type tci.relationship_type as enum (
  'ownership',     -- parent holds shares in child; ownership_pct is meaningful
  'control',       -- control without (or beyond) shareholding: board, contract
  'common_owner',  -- both sides are held by the same person or company
  'affiliate'      -- related, weaker than the above; no direction implied
);

comment on type tci.relationship_type is
  'How two companies are related. Only `ownership` gives ownership_pct a meaning; the others are structural and the percentage must be null.';

create type tci.relationship_source as enum (
  'manual',              -- a person entered it
  'external',            -- came from a register or a data provider
  'suggested_accepted'   -- the system suggested it and a person accepted
);

create table tci.entity_relationships (
  id                uuid primary key default gen_random_uuid(),
  parent_entity_id  uuid not null references tci.legal_entities (id) on delete cascade,
  child_entity_id   uuid not null references tci.legal_entities (id) on delete cascade,
  relationship_type tci.relationship_type not null,
  -- Only meaningful for `ownership`. Nullable even there: we often know that A
  -- owns B without knowing how much, and inventing 100 would be a lie.
  ownership_pct     numeric(5,2)
    check (ownership_pct is null or (ownership_pct >= 0 and ownership_pct <= 100)),
  valid_from        date not null default current_date,
  valid_to          date,
  source            tci.relationship_source not null default 'manual',
  source_note       text,
  created_by        uuid not null references auth.users (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint entity_relationships_not_self check (parent_entity_id <> child_entity_id),
  constraint entity_relationships_window check (valid_to is null or valid_to >= valid_from),
  -- A percentage on a non-ownership edge would be meaningless, and meaningless
  -- data is the kind that later gets summed.
  constraint entity_relationships_pct_only_on_ownership check (
    ownership_pct is null or relationship_type = 'ownership'
  )
);

comment on table tci.entity_relationships is
  'Directed, time-bounded corporate relationships. Group MEMBERSHIP is the undirected closure over the edges valid today (tci.entity_group).';

-- One LIVE edge per (pair, type). A closed edge may be superseded by a new one
-- - the history stays - but two open edges saying the same thing cannot exist.
create unique index entity_relationships_live_uq
  on tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type)
  where valid_to is null;

create index entity_relationships_parent_idx on tci.entity_relationships (parent_entity_id);
create index entity_relationships_child_idx on tci.entity_relationships (child_entity_id);

create function tci.relationship_is_live(p_from date, p_to date)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_from <= current_date and (p_to is null or p_to >= current_date)
$$;

-- ---------------------------------------------------------------------------
-- 3. Group resolution, cycle-safe
-- ---------------------------------------------------------------------------
-- THE CYCLE PROBLEM, and how this is solved.
--
-- A owns B, B owns C, C owns A is a legal (if unusual) structure, and mutual
-- cross-holdings between sister companies are common. A plain recursive CTE
-- over such a graph revisits nodes forever.
--
-- Two independent defences, in order of importance:
--
--   1. A VISITED SET carried down each path as a uuid[]. A node is only
--      expanded if it is NOT already on the path (`not (e.other = any(path))`).
--      This is what actually guarantees termination: the graph is finite, and
--      no path can repeat a node, so every path is at most N long.
--   2. A DEPTH CAP (tci.group_depth_cap(), default 10) as a second belt. It
--      bounds the work on a pathologically wide graph even though the visited
--      set already bounds the depth. If a real group is ever deeper than the
--      cap it is truncated rather than wrong-but-unbounded, and the cap is a
--      setting so it can be raised.
--
-- The walk is UNDIRECTED - each edge is traversed both ways - because group
-- membership is not directional: two subsidiaries of one parent are in the
-- same group even though no edge runs between them.

create function tci.entity_group(p_entity_id uuid)
returns table (entity_id uuid, depth int)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive edges as (
    -- Every live edge, in both directions, as one undirected relation.
    select parent_entity_id as a, child_entity_id as b
      from tci.entity_relationships
     where tci.relationship_is_live(valid_from, valid_to)
    union all
    select child_entity_id, parent_entity_id
      from tci.entity_relationships
     where tci.relationship_is_live(valid_from, valid_to)
  ),
  walk (node, depth, path) as (
    select p_entity_id, 0, array[p_entity_id]
    union all
    select e.b, w.depth + 1, w.path || e.b
      from walk w
      join edges e on e.a = w.node
     -- (1) the visited set: never re-enter a node already on this path.
     where not (e.b = any (w.path))
     -- (2) the depth cap: a second, configurable belt.
       and w.depth < tci.group_depth_cap()
  )
  select node, min(depth)::int from walk group by node
$$;

comment on function tci.entity_group(uuid) is
  'Every company in this one''s group, with its distance in edges. Cycle-safe by a per-path visited set (the real guarantee) plus a configurable depth cap (a second belt). The walk is undirected: sisters share a group.';

revoke execute on function tci.entity_group(uuid) from public, anon;
grant execute on function tci.entity_group(uuid) to authenticated, service_role;

-- The ULTIMATE PARENT is the group's identity. Chosen as the member with no
-- live incoming ownership/control edge FROM another member - i.e. nobody in
-- the group owns it. Three things make that a definition rather than a guess:
--
--   * only ownership and control are considered - `affiliate` and
--     `common_owner` are not "being owned by";
--   * when several members qualify (a group held by two unrelated people, or a
--     cycle where everyone is owned) the tie is broken deterministically by
--     id, so the group's identity is STABLE across calls and sessions;
--   * a company with no edges at all is its own ultimate parent, which makes
--     every entity groupable and the callers branch-free.

create function tci.ultimate_parent(p_entity_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with members as (select entity_id from tci.entity_group(p_entity_id)),
  owned as (
    select distinct r.child_entity_id as id
      from tci.entity_relationships r
     where tci.relationship_is_live(r.valid_from, r.valid_to)
       and r.relationship_type in ('ownership', 'control')
       and r.child_entity_id in (select entity_id from members)
       and r.parent_entity_id in (select entity_id from members)
  )
  select coalesce(
    -- Nobody in the group owns it: the top.
    (select m.entity_id from members m
      where m.entity_id not in (select id from owned)
      order by m.entity_id limit 1),
    -- Everyone is owned by someone (a pure cycle). Still needs one stable
    -- answer, so take the lowest id in the group.
    (select m.entity_id from members m order by m.entity_id limit 1)
  )
$$;

comment on function tci.ultimate_parent(uuid) is
  'The group''s identity: the member no other member owns or controls, ties broken by id so it is stable. In a pure ownership cycle nobody qualifies, so the lowest id is used - stable, and documented as arbitrary.';

revoke execute on function tci.ultimate_parent(uuid) from public, anon;
grant execute on function tci.ultimate_parent(uuid) to authenticated, service_role;

-- One row per (entity, group member). The workhorse view: everything in Phase
-- 6 joins through it.
create view tci.v_entity_group
with (security_invoker = true) as
select
  e.id                     as entity_id,
  g.entity_id              as member_id,
  g.depth,
  tci.ultimate_parent(e.id) as ultimate_parent_id,
  (g.entity_id = tci.ultimate_parent(e.id)) as member_is_ultimate_parent,
  (select count(*) from tci.entity_group(e.id))::int as group_size
from tci.legal_entities e
cross join lateral tci.entity_group(e.id) g;

comment on view tci.v_entity_group is
  'For every company: its group members, their distance, and the group''s ultimate parent. A company with no relationships is a group of one, of which it is the parent.';

grant select on tci.v_entity_group to authenticated, service_role;

-- The relationships of one entity, both directions, with the counterparty
-- named - what the Группа tab draws its tree from.
create view tci.v_entity_relationships
with (security_invoker = true) as
select
  r.id,
  r.parent_entity_id,
  p.name as parent_name,
  r.child_entity_id,
  c.name as child_name,
  r.relationship_type,
  r.ownership_pct,
  r.valid_from,
  r.valid_to,
  tci.relationship_is_live(r.valid_from, r.valid_to) as is_live,
  r.source,
  r.source_note,
  r.created_by,
  r.created_at,
  r.updated_at
from tci.entity_relationships r
join tci.legal_entities p on p.id = r.parent_entity_id
join tci.legal_entities c on c.id = r.child_entity_id;

grant select on tci.v_entity_relationships to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Writing an edge
-- ---------------------------------------------------------------------------

create function tci.may_edit_relationships()
returns boolean
language sql
stable
set search_path = ''
as $$
  select tci.has_role('admin', 'information_manager',
                      'credit_underwriter', 'commercial_underwriter')
$$;

create function tci.save_entity_relationship(
  p_parent_entity_id  uuid,
  p_child_entity_id   uuid,
  p_relationship_type tci.relationship_type,
  p_ownership_pct     numeric default null,
  p_valid_from        date default current_date,
  p_valid_to          date default null,
  p_source            tci.relationship_source default 'manual',
  p_source_note       text default null,
  p_relationship_id   uuid default null
)
returns tci.entity_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.entity_relationships%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to record corporate relationships' using errcode = 'P0004';
  end if;
  if p_parent_entity_id = p_child_entity_id then
    raise exception 'a company cannot be related to itself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_parent_entity_id)
     or not exists (select 1 from tci.legal_entities where id = p_child_entity_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if p_ownership_pct is not null and p_relationship_type <> 'ownership' then
    raise exception 'an ownership percentage only means something on an ownership relationship'
      using errcode = 'P0001';
  end if;

  if p_relationship_id is null then
    insert into tci.entity_relationships (
      parent_entity_id, child_entity_id, relationship_type, ownership_pct,
      valid_from, valid_to, source, source_note
    ) values (
      p_parent_entity_id, p_child_entity_id, p_relationship_type, p_ownership_pct,
      coalesce(p_valid_from, current_date), p_valid_to, p_source, p_source_note
    ) returning * into v_row;
  else
    update tci.entity_relationships
       set relationship_type = p_relationship_type,
           ownership_pct = p_ownership_pct,
           valid_from = coalesce(p_valid_from, valid_from),
           valid_to = p_valid_to,
           source_note = p_source_note,
           updated_at = now()
     where id = p_relationship_id
     returning * into v_row;
    if not found then
      raise exception 'relationship not found' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

comment on function tci.save_entity_relationship(uuid, uuid, tci.relationship_type, numeric, date, date, tci.relationship_source, text, uuid) is
  'Records or amends a corporate relationship. Refuses a self-reference and an ownership percentage on a non-ownership edge.';

-- Ending an edge is CLOSING it, not deleting it: the group as it stood when a
-- limit was decided has to stay readable.
create function tci.end_entity_relationship(p_relationship_id uuid, p_valid_to date default current_date)
returns tci.entity_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.entity_relationships%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to record corporate relationships' using errcode = 'P0004';
  end if;
  update tci.entity_relationships
     set valid_to = coalesce(p_valid_to, current_date), updated_at = now()
   where id = p_relationship_id
   returning * into v_row;
  if not found then
    raise exception 'relationship not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke execute on function tci.save_entity_relationship(uuid, uuid, tci.relationship_type, numeric, date, date, tci.relationship_source, text, uuid) from public, anon;
grant execute on function tci.save_entity_relationship(uuid, uuid, tci.relationship_type, numeric, date, date, tci.relationship_source, text, uuid) to authenticated, service_role;
revoke execute on function tci.end_entity_relationship(uuid, date) from public, anon;
grant execute on function tci.end_entity_relationship(uuid, date) to authenticated, service_role;
revoke execute on function tci.may_edit_relationships() from public, anon;
grant execute on function tci.may_edit_relationships() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
-- Staff read; information_manager, both underwriting streams and admin write.
-- NO client policy at all: who owns whom is not a policyholder's business, and
-- 0040 asserts that no client-facing surface ever exposes it.

alter table tci.entity_relationships enable row level security;

create policy "entity_relationships: staff read"
  on tci.entity_relationships for select to authenticated using (tci.is_staff());
create policy "entity_relationships: staff write"
  on tci.entity_relationships for all to authenticated
  using (tci.may_edit_relationships())
  with check (tci.may_edit_relationships());

grant select, insert, update, delete on tci.entity_relationships to authenticated;
grant all on tci.entity_relationships to service_role;

-- ---------------------------------------------------------------------------
-- 6. Assertions - including a deliberately cyclic fixture
-- ---------------------------------------------------------------------------

do $$
declare
  A uuid; B uuid; C uuid; D uuid; v_user uuid;
  v_n int; v_parent uuid;
begin
  -- A throwaway country/user is not needed: use whatever already exists, and
  -- roll the whole fixture back at the end.
  select id into v_user from auth.users limit 1;
  if v_user is null then
    raise notice '0038: no auth user to attribute the cycle fixture to - skipping the live cycle test';
    return;
  end if;

  insert into tci.legal_entities (name, country_code, created_by)
  values ('ZZ cycle A', (select code from tci.countries limit 1), v_user) returning id into A;
  insert into tci.legal_entities (name, country_code, created_by)
  values ('ZZ cycle B', (select code from tci.countries limit 1), v_user) returning id into B;
  insert into tci.legal_entities (name, country_code, created_by)
  values ('ZZ cycle C', (select code from tci.countries limit 1), v_user) returning id into C;
  insert into tci.legal_entities (name, country_code, created_by)
  values ('ZZ sister D', (select code from tci.countries limit 1), v_user) returning id into D;

  -- A -> B -> C -> A is a closed ownership cycle. D hangs off A as a sister of
  -- B, reachable only by walking the A->B edge BACKWARDS from B.
  insert into tci.entity_relationships (parent_entity_id, child_entity_id, relationship_type, ownership_pct, created_by)
  values (A, B, 'ownership', 100, v_user),
         (B, C, 'ownership', 60, v_user),
         (C, A, 'ownership', 5, v_user),
         (A, D, 'ownership', 80, v_user);

  -- If the walk were not cycle-safe this call would not return.
  select count(*) into v_n from tci.entity_group(B);
  if v_n <> 4 then
    raise exception '0038: the cyclic group should resolve to 4 members, got %', v_n;
  end if;

  -- Undirected: D is found from B only by traversing A->B in reverse.
  if not exists (select 1 from tci.entity_group(B) where entity_id = D) then
    raise exception '0038: group resolution is not undirected - the sister was not found';
  end if;

  -- Every member of a cycle is owned by another member, so the fallback picks
  -- the lowest id - and every member must agree on it.
  v_parent := tci.ultimate_parent(A);
  if v_parent is distinct from tci.ultimate_parent(B)
     or v_parent is distinct from tci.ultimate_parent(C)
     or v_parent is distinct from tci.ultimate_parent(D) then
    raise exception '0038: the group members disagree about the ultimate parent';
  end if;

  -- An unrelated company is a group of one, of which it is the parent.
  if (select count(*) from tci.entity_group(A)) <> 4 then
    raise exception '0038: unexpected group size from A';
  end if;

  raise notice '0038: cyclic group A->B->C->A + sister D resolved to % members, stable parent', v_n;

  -- Leave nothing behind.
  delete from tci.entity_relationships where parent_entity_id in (A,B,C,D) or child_entity_id in (A,B,C,D);
  delete from tci.legal_entities where id in (A,B,C,D);
end;
$$;

do $$
begin
  -- A group of one for an entity with no edges at all.
  if exists (
    select 1 from tci.legal_entities e
     where (select count(*) from tci.entity_group(e.id)) = 0
  ) then
    raise exception '0038: some entity resolves to an empty group';
  end if;
  -- No client may read the relationship table.
  if exists (
    select 1 from pg_policies
     where schemaname = 'tci' and tablename = 'entity_relationships'
       and qual like '%client%'
  ) then
    raise exception '0038: a client-facing policy exists on entity_relationships';
  end if;
end;
$$;
