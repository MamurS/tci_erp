-- What: automatic relationship SUGGESTIONS - tci.entity_relationship_suggestions,
--       the signal scoring, lazy generation, and accept/reject.
-- Why:  Phase 6. Groups are mostly discovered, not declared: nobody tells the
--       insurer that two applicants share a director. The signals below are
--       cheap and available, and together they surface most of it.
--
-- THESE ARE HINTS AND NOTHING ELSE. No edge is ever created automatically.
-- Every signal here has a plausible innocent explanation - two unrelated
-- companies can share a serviced-office address, and a common surname is not a
-- common owner - so a suggestion is a prompt for a human to go and check,
-- displayed as unverified, and it stays open until someone accepts or rejects
-- it. Rejection is remembered so the same pair is not proposed twice.
--
-- Generated LAZILY on entity read/save, like tci.refresh_agenda. No cron.

-- ---------------------------------------------------------------------------
-- 1. What counts as a signal
-- ---------------------------------------------------------------------------
-- Free-mail domains are excluded outright: two companies both using gmail.com
-- tells us they are both small, not that they are related. Including them
-- would bury the real signals under noise, which is the usual way a
-- suggestions feature dies.

create function tci.is_free_email_domain(p_domain text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(coalesce(p_domain, '')) in (
    'gmail.com', 'mail.ru', 'yandex.ru', 'yandex.com', 'inbox.ru', 'list.ru',
    'bk.ru', 'rambler.ru', 'outlook.com', 'hotmail.com', 'yahoo.com',
    'icloud.com', 'proton.me', 'protonmail.com', 'umail.uz', 'mail.uz'
  )
$$;

create function tci.email_domain(p_email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(lower(split_part(coalesce(p_email, ''), '@', 2)), '')
$$;

-- Addresses and people's names are compared on a normalised form: case,
-- punctuation and runs of whitespace are noise, not information.
create function tci.normalise_for_match(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- btrim matters: without it a leading or trailing punctuation run leaves a
  -- space and two identical addresses compare unequal.
  select nullif(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9а-яё]+', ' ', 'g')), '')
$$;

comment on function tci.normalise_for_match(text) is
  'Lower-cased, punctuation-stripped, whitespace-collapsed. Used to compare addresses and contact people, never to store.';

-- The weights. Deliberately conservative: no single signal is enough to reach
-- the display threshold on its own except an exact shared corporate email
-- domain, which is close to conclusive.
create function tci.relationship_signals(p_a uuid, p_b uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with a as (select * from tci.legal_entities where id = p_a),
       b as (select * from tci.legal_entities where id = p_b),
  s as (
    select
      -- A shared corporate email domain is the strongest cheap signal there is.
      case when tci.email_domain(a.contact_email) is not null
            and tci.email_domain(a.contact_email) = tci.email_domain(b.contact_email)
            and not tci.is_free_email_domain(tci.email_domain(a.contact_email))
           then jsonb_build_object('email_domain', jsonb_build_object(
                  'score', 0.60, 'value', tci.email_domain(a.contact_email)))
           else '{}'::jsonb end
      ||
      -- Same registered address. Common for a group; also common for a
      -- business centre, which is why it is not conclusive on its own.
      case when tci.normalise_for_match(a.address) is not null
            and tci.normalise_for_match(a.address) = tci.normalise_for_match(b.address)
           then jsonb_build_object('address', jsonb_build_object(
                  'score', 0.35, 'value', a.address))
           else '{}'::jsonb end
      ||
      -- The same person named as the contact on both files.
      case when tci.normalise_for_match(a.contact_person) is not null
            and tci.normalise_for_match(a.contact_person) = tci.normalise_for_match(b.contact_person)
           then jsonb_build_object('contact_person', jsonb_build_object(
                  'score', 0.35, 'value', a.contact_person))
           else '{}'::jsonb end
      ||
      -- Name similarity, reusing the pg_trgm index Phase 3a added for
      -- dedup-on-entry. "Alfa Trade" and "Alfa Logistics" score well here.
      case when extensions.similarity(a.name, b.name) > 0.45
           then jsonb_build_object('name_similarity', jsonb_build_object(
                  'score', round(extensions.similarity(a.name, b.name)::numeric, 2),
                  'value', b.name))
           else '{}'::jsonb end
      ||
      -- A shared registration-number prefix, and ONLY within one country:
      -- across jurisdictions the numbering schemes are unrelated, so a shared
      -- prefix would be pure coincidence. Weak even so - many national schemes
      -- encode the region in the leading digits - hence the low weight.
      case when a.country_code = b.country_code
            and length(coalesce(a.registration_number, '')) >= 9
            and length(coalesce(b.registration_number, '')) >= 9
            and left(a.registration_number, 5) = left(b.registration_number, 5)
           then jsonb_build_object('registration_prefix', jsonb_build_object(
                  'score', 0.20, 'value', left(a.registration_number, 5)))
           else '{}'::jsonb end
      as signals
    from a, b
  )
  select signals from s
$$;

comment on function tci.relationship_signals(uuid, uuid) is
  'Which cheap signals two companies share, each with its weight. Advisory only: every one of these has an innocent explanation, so nothing here ever creates an edge.';

create function tci.relationship_signal_score(p_signals jsonb)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(round(sum((v->>'score')::numeric), 2), 0)
    from jsonb_each(coalesce(p_signals, '{}'::jsonb)) as e(k, v)
$$;

-- ---------------------------------------------------------------------------
-- 2. The suggestions
-- ---------------------------------------------------------------------------

create type tci.suggestion_status as enum ('open', 'accepted', 'rejected');

create table tci.entity_relationship_suggestions (
  id          uuid primary key default gen_random_uuid(),
  -- Stored with entity_a < entity_b so a pair has exactly one row whichever
  -- side it was discovered from.
  entity_a    uuid not null references tci.legal_entities (id) on delete cascade,
  entity_b    uuid not null references tci.legal_entities (id) on delete cascade,
  signals     jsonb not null default '{}'::jsonb,
  score       numeric(5,2) not null default 0,
  status      tci.suggestion_status not null default 'open',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint suggestions_ordered_pair check (entity_a < entity_b),
  constraint suggestions_review_recorded check (
    (status = 'open') = (reviewed_at is null)
  )
);

create unique index entity_relationship_suggestions_pair_uq
  on tci.entity_relationship_suggestions (entity_a, entity_b);
create index entity_relationship_suggestions_open_idx
  on tci.entity_relationship_suggestions (status, score desc);

comment on table tci.entity_relationship_suggestions is
  'Advisory, UNVERIFIED hints that two companies may be related. Never creates an edge; a rejected pair is remembered so it is not proposed again.';

-- The display threshold. Below this a pair is not worth a human's attention.
create function tci.suggestion_threshold() returns numeric
language sql immutable parallel safe set search_path = '' as $$ select 0.45::numeric $$;

-- ---------------------------------------------------------------------------
-- 3. Lazy generation
-- ---------------------------------------------------------------------------
-- Called when a company card is opened or an entity is saved. Recomputes the
-- open suggestions FOR THIS ENTITY only, so the cost is bounded by the
-- candidate set rather than by the size of the registry.
--
-- Candidates are narrowed before scoring: an entity is only compared against
-- others that already share a cheap, indexable attribute (email domain,
-- address, contact person, registration prefix) or are trigram-similar by
-- name. Nothing scans the whole registry pairwise.

create function tci.refresh_entity_suggestions(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_signals jsonb;
  v_score numeric;
  v_a uuid;
  v_b uuid;
  v_n int := 0;
begin
  if not tci.is_staff() then
    return 0;   -- clients never see relationships; nothing to generate
  end if;

  for v_row in
    select e.id
      from tci.legal_entities e, tci.legal_entities me
     where me.id = p_entity_id
       and e.id <> p_entity_id
       and (
            (tci.email_domain(e.contact_email) is not null
             and tci.email_domain(e.contact_email) = tci.email_domain(me.contact_email)
             and not tci.is_free_email_domain(tci.email_domain(me.contact_email)))
         or (tci.normalise_for_match(e.address) is not null
             and tci.normalise_for_match(e.address) = tci.normalise_for_match(me.address))
         or (tci.normalise_for_match(e.contact_person) is not null
             and tci.normalise_for_match(e.contact_person) = tci.normalise_for_match(me.contact_person))
         or (e.country_code = me.country_code
             and length(coalesce(e.registration_number, '')) >= 9
             and length(coalesce(me.registration_number, '')) >= 9
             and left(e.registration_number, 5) = left(me.registration_number, 5))
         or extensions.similarity(e.name, me.name) > 0.45
       )
  loop
    v_a := least(p_entity_id, v_row.id);
    v_b := greatest(p_entity_id, v_row.id);

    -- Already related, in either direction? Then there is nothing to suggest.
    if exists (
      select 1 from tci.entity_relationships r
       where tci.relationship_is_live(r.valid_from, r.valid_to)
         and ((r.parent_entity_id = v_a and r.child_entity_id = v_b)
           or (r.parent_entity_id = v_b and r.child_entity_id = v_a))
    ) then
      continue;
    end if;

    -- A human has already said no to this pair. Do not ask again.
    if exists (
      select 1 from tci.entity_relationship_suggestions
       where entity_a = v_a and entity_b = v_b and status = 'rejected'
    ) then
      continue;
    end if;

    v_signals := tci.relationship_signals(v_a, v_b);
    v_score := tci.relationship_signal_score(v_signals);
    if v_score < tci.suggestion_threshold() then
      continue;
    end if;

    insert into tci.entity_relationship_suggestions (entity_a, entity_b, signals, score)
    values (v_a, v_b, v_signals, v_score)
    on conflict (entity_a, entity_b) do update
      set signals = excluded.signals,
          score = excluded.score,
          updated_at = now()
      -- An accepted or rejected pair keeps its verdict; only open rows refresh.
      where tci.entity_relationship_suggestions.status = 'open';
    v_n := v_n + 1;
  end loop;

  -- Retire open suggestions for pairs that have since been related by hand.
  update tci.entity_relationship_suggestions s
     set status = 'accepted', reviewed_at = now(), updated_at = now()
   where s.status = 'open'
     and (s.entity_a = p_entity_id or s.entity_b = p_entity_id)
     and exists (
       select 1 from tci.entity_relationships r
        where tci.relationship_is_live(r.valid_from, r.valid_to)
          and ((r.parent_entity_id = s.entity_a and r.child_entity_id = s.entity_b)
            or (r.parent_entity_id = s.entity_b and r.child_entity_id = s.entity_a))
     );

  return v_n;
end;
$$;

comment on function tci.refresh_entity_suggestions(uuid) is
  'Recomputes the open suggestions for ONE company, called lazily on read. Candidates are narrowed by a cheap shared attribute first - the registry is never scanned pairwise - and there is no cron.';

create view tci.v_entity_suggestions
with (security_invoker = true) as
select
  s.id,
  s.entity_a,
  a.name as entity_a_name,
  s.entity_b,
  b.name as entity_b_name,
  s.signals,
  s.score,
  s.status,
  s.reviewed_by,
  s.reviewed_at,
  s.created_at
from tci.entity_relationship_suggestions s
join tci.legal_entities a on a.id = s.entity_a
join tci.legal_entities b on b.id = s.entity_b;

grant select on tci.v_entity_suggestions to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Accepting and rejecting
-- ---------------------------------------------------------------------------
-- Accepting is the ONLY path from a suggestion to an edge, and it still goes
-- through tci.save_entity_relationship - so the direction, the type and the
-- percentage are a human's decision, not the machine's. The edge is stamped
-- source = 'suggested_accepted' so the provenance survives.

create function tci.accept_relationship_suggestion(
  p_suggestion_id     uuid,
  p_parent_entity_id  uuid,
  p_relationship_type tci.relationship_type,
  p_ownership_pct     numeric default null
)
returns tci.entity_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s tci.entity_relationship_suggestions%rowtype;
  v_child uuid;
  v_row tci.entity_relationships%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to record corporate relationships' using errcode = 'P0004';
  end if;
  select * into v_s from tci.entity_relationship_suggestions where id = p_suggestion_id for update;
  if not found then
    raise exception 'suggestion not found' using errcode = 'P0002';
  end if;
  if v_s.status <> 'open' then
    raise exception 'this suggestion is already %', v_s.status using errcode = 'P0001';
  end if;
  if p_parent_entity_id not in (v_s.entity_a, v_s.entity_b) then
    raise exception 'the parent must be one of the two suggested companies'
      using errcode = 'P0001';
  end if;
  v_child := case when p_parent_entity_id = v_s.entity_a then v_s.entity_b else v_s.entity_a end;

  v_row := tci.save_entity_relationship(
    p_parent_entity_id, v_child, p_relationship_type, p_ownership_pct,
    current_date, null, 'suggested_accepted',
    'accepted from suggestion ' || p_suggestion_id::text, null);

  update tci.entity_relationship_suggestions
     set status = 'accepted', reviewed_by = (select auth.uid()),
         reviewed_at = now(), updated_at = now()
   where id = p_suggestion_id;

  return v_row;
end;
$$;

create function tci.reject_relationship_suggestion(p_suggestion_id uuid)
returns tci.entity_relationship_suggestions
language plpgsql
security definer
set search_path = ''
as $$
declare v_s tci.entity_relationship_suggestions%rowtype;
begin
  if not tci.may_edit_relationships() then
    raise exception 'not permitted to review corporate relationships' using errcode = 'P0004';
  end if;
  update tci.entity_relationship_suggestions
     set status = 'rejected', reviewed_by = (select auth.uid()),
         reviewed_at = now(), updated_at = now()
   where id = p_suggestion_id and status = 'open'
   returning * into v_s;
  if not found then
    raise exception 'suggestion not found or already reviewed' using errcode = 'P0002';
  end if;
  return v_s;
end;
$$;

revoke execute on function tci.accept_relationship_suggestion(uuid, uuid, tci.relationship_type, numeric) from public, anon;
grant execute on function tci.accept_relationship_suggestion(uuid, uuid, tci.relationship_type, numeric) to authenticated, service_role;
revoke execute on function tci.reject_relationship_suggestion(uuid) from public, anon;
grant execute on function tci.reject_relationship_suggestion(uuid) to authenticated, service_role;
revoke execute on function tci.refresh_entity_suggestions(uuid) from public, anon;
grant execute on function tci.refresh_entity_suggestions(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

alter table tci.entity_relationship_suggestions enable row level security;

create policy "relationship_suggestions: staff read"
  on tci.entity_relationship_suggestions for select to authenticated using (tci.is_staff());
create policy "relationship_suggestions: staff write"
  on tci.entity_relationship_suggestions for all to authenticated
  using (tci.may_edit_relationships())
  with check (tci.may_edit_relationships());

grant select, insert, update, delete on tci.entity_relationship_suggestions to authenticated;
grant all on tci.entity_relationship_suggestions to service_role;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_sig jsonb;
begin
  -- A free-mail domain must never become a signal.
  if not tci.is_free_email_domain('gmail.com') or tci.is_free_email_domain('alfa-group.uz') then
    raise exception '0039: the free-mail domain list is not doing its job';
  end if;

  -- Normalisation is about noise, not content.
  if tci.normalise_for_match('  ООО «Альфа-Трейд», д.5  ')
     is distinct from tci.normalise_for_match('ООО Альфа Трейд д 5') then
    raise exception '0039: address normalisation is inconsistent';
  end if;

  -- The threshold must be high enough that one weak signal is not enough.
  if 0.20 >= tci.suggestion_threshold() then
    raise exception '0039: a registration prefix alone would raise a suggestion';
  end if;
  if 0.35 >= tci.suggestion_threshold() then
    raise exception '0039: a shared address alone would raise a suggestion';
  end if;
  -- ...but a shared corporate email domain alone IS enough.
  if 0.60 < tci.suggestion_threshold() then
    raise exception '0039: a shared corporate email domain should raise a suggestion on its own';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'tci' and tablename = 'entity_relationship_suggestions'
       and qual like '%client%'
  ) then
    raise exception '0039: a client-facing policy exists on the suggestions table';
  end if;
end;
$$;
