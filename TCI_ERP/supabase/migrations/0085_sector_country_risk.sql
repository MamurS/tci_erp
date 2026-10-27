-- 0085_sector_country_risk.sql
--
-- What: two risk layers and a sanctions overlay, as trade credit insurers
--       run them (Prompt 31, after Allianz Trade):
--         * SECTOR GRADES — every industry has a sector (tci.sectors) with a
--           responsible credit analyst; quarterly reviews (A–D, outlook,
--           seven scored factors, narrative, sources) are immutable
--           versions, the current grade is the latest approved one; the
--           quarterly task is generated lazily (refresh_sector_tasks, called
--           by refresh_agenda — no cron); optional four-eyes; ad-hoc reviews
--           supersede at once; a downgrade to C/D tells credit underwriting
--           which buyers with limits it touches;
--         * COUNTRY RISK — imported OECD classifications (0–7, history by
--           import) and an internal override that a second, senior analyst
--           approves; decisions use the internal value when there is one;
--         * SANCTIONS — flags on a country or a single company (regime,
--           source, effective date, lifted with a reason, never deleted)
--           that make cover unavailable: triggers refuse a new limit
--           request, an approving decision, a submission, a buyer in a
--           package and a policy for a flagged party, whatever the path or
--           the authority; flagging opens an urgent review task per in-force
--           limit (nothing is revoked automatically);
--         * the COVER MATRIX and the ADJUSTMENT TABLE (risk_adjustment_settings):
--           the authority rank a decision needs by country category, one
--           more for a D sector, applied in decide_limit_request and in the
--           validation routing; the engine notches and caps; informational
--           premium loadings; a concentration check per policy/submission.
-- Why:  sector and country are how a credit insurer reads risk beyond the
--       buyer's own figures, and sanctions decide whether cover may exist
--       at all. Everything is decided here; the screens only show it.
--
-- Agenda (task types added by 0084):
--   sector_review_due          the responsible analyst (user)   normal; AUTO — closes with the
--                              quarter's review, an earlier quarter's retired by refresh_sector_tasks
--   sector_review_approval     credit analysts (role)           high; AUTO — the second analyst's answer
--   sector_downgrade_review    credit underwriting (role)       high; MANUAL — a person decides the
--                              buyers of a sector downgraded to C/D have been looked at
--   sanctions_limit_review     credit underwriting (role)       urgent; MANUAL — revoke, reduce or
--                              keep; retired by refresh_agenda once nothing on the request is in force
--   country_override_approval  the heads of credit analysis     high; AUTO — the head's answer
-- complete_task: sector_downgrade_review and sanctions_limit_review are the
-- eighth and ninth manual types.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

alter table tci.workflow_settings
  add column sector_review_due_day smallint not null default 15
    constraint workflow_settings_sector_due_day check (sector_review_due_day between 1 and 90),
  add column sector_review_four_eyes boolean not null default false,
  add column oecd_stale_months smallint not null default 6
    constraint workflow_settings_oecd_stale check (oecd_stale_months between 1 and 36),
  add column concentration_warn_pct numeric(5,2) not null default 40
    constraint workflow_settings_concentration check (concentration_warn_pct between 1 and 100),
  add column client_show_oecd boolean not null default false;

comment on column tci.workflow_settings.sector_review_due_day is
  'The day of each quarter by which the quarterly sector review is due (0085; default 15).';
comment on column tci.workflow_settings.sector_review_four_eyes is
  'A sector review needs a second analyst''s approval before it is in force (0085; default off).';
comment on column tci.workflow_settings.client_show_oecd is
  'Whether client-facing surfaces may show the OECD country category (0085; default off — and nothing shows it yet).';

-- The adjustment table and the cover matrix, one row per sector grade and per
-- country category ('0'…'7', 'unclassified').
create table tci.risk_adjustment_settings (
  dimension      text not null check (dimension in ('sector', 'country')),
  key            text not null,
  notch          smallint not null default 0 check (notch between -6 and 6),
  cap_grade      text check (cap_grade is null or cap_grade in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D')),
  cover          text not null default 'available' check (cover in ('available', 'restricted')),
  rank_floor     smallint not null default 0 check (rank_floor between 0 and 5),
  rank_add       smallint not null default 0 check (rank_add between 0 and 4),
  premium_loading_pct numeric(6,2) not null default 0 check (premium_loading_pct between 0 and 500),
  updated_by     uuid references auth.users (id),
  updated_at     timestamptz not null default now(),
  primary key (dimension, key),
  constraint risk_adjustment_key check (
    (dimension = 'sector' and key in ('A', 'B', 'C', 'D'))
    or (dimension = 'country' and key in ('0', '1', '2', '3', '4', '5', '6', '7', 'unclassified')))
);
comment on table tci.risk_adjustment_settings is
  'Prompt 31: per sector grade and country category — the engine notch (+ better, − worse) and grade cap, the cover label, the authority rank a decision needs (rank_floor, country) or adds (rank_add, sector), and an informational premium loading. Admin-configured.';

insert into tci.risk_adjustment_settings (dimension, key, notch, cap_grade, cover, rank_floor, rank_add, premium_loading_pct) values
  ('sector', 'A',  1, null, 'available', 0, 0,  0),
  ('sector', 'B',  0, null, 'available', 0, 0,  0),
  ('sector', 'C', -1, null, 'available', 0, 0, 10),
  ('sector', 'D', -2, null, 'available', 0, 1, 25),
  ('country', '0', 0, null, 'available', 0, 0, 0),
  ('country', '1', 0, null, 'available', 0, 0, 0),
  ('country', '2', 0, null, 'available', 0, 0, 0),
  ('country', '3', 0, null, 'available', 0, 0, 0),
  ('country', '4', 0, null, 'available', 3, 0, 5),
  ('country', '5', 0, null, 'available', 3, 0, 10),
  ('country', '6', 0, 'C1', 'restricted', 4, 0, 20),
  ('country', '7', 0, 'C1', 'restricted', 5, 0, 30),
  ('country', 'unclassified', 0, null, 'restricted', 5, 0, 30);

alter table tci.risk_adjustment_settings enable row level security;
create policy "risk_adjustment_settings: staff read" on tci.risk_adjustment_settings
  for select to authenticated using (tci.is_staff());
grant select on tci.risk_adjustment_settings to authenticated;
grant select, insert, update on tci.risk_adjustment_settings to service_role;

-- ---------------------------------------------------------------------------
-- 2. Sectors and their reviews
-- ---------------------------------------------------------------------------

create table tci.sectors (
  id             uuid primary key default gen_random_uuid(),
  industry_code  text not null unique references tci.industries (code),
  analyst_id     uuid references auth.users (id),
  assigned_by    uuid references auth.users (id),
  assigned_at    timestamptz
);
comment on table tci.sectors is
  'Prompt 31: one row per industry — its sector-risk record and the credit analyst responsible for its quarterly review (admin assigns).';

insert into tci.sectors (industry_code) select code from tci.industries on conflict do nothing;

create function tci.sector_for_new_industry() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into tci.sectors (industry_code) values (new.code) on conflict do nothing;
  return new;
end $$;
create trigger industries_sector_row after insert on tci.industries
  for each row execute function tci.sector_for_new_industry();
revoke all on function tci.sector_for_new_industry() from public, anon;

create table tci.sector_reviews (
  id             uuid primary key default gen_random_uuid(),
  sector_id      uuid not null references tci.sectors (id),
  quarter_start  date not null check (extract(day from quarter_start) = 1 and extract(month from quarter_start) in (1, 4, 7, 10)),
  kind           text not null check (kind in ('quarterly', 'ad_hoc')),
  grade          char(1) not null check (grade in ('A', 'B', 'C', 'D')),
  outlook        text not null check (outlook in ('positive', 'stable', 'negative')),
  factors        jsonb not null,
  narrative      text not null check (btrim(narrative) <> ''),
  sources        jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  status         text not null check (status in ('pending', 'approved', 'rejected')),
  created_by     uuid not null references auth.users (id),
  created_at     timestamptz not null default clock_timestamp(),
  decided_by     uuid references auth.users (id),
  decided_at     timestamptz,
  decision_comment text,
  constraint sector_reviews_decided check ((status = 'pending') = (decided_at is null))
);
create index sector_reviews_sector_idx on tci.sector_reviews (sector_id, decided_at desc);
create unique index sector_reviews_one_pending on tci.sector_reviews (sector_id) where status = 'pending';
comment on table tci.sector_reviews is
  'Prompt 31: immutable sector review versions. The grade in force is the latest APPROVED review (decided_at). A pending review (four-eyes) is resolved once.';

-- A review is resolved once and never changed afterwards; nothing is deleted.
create function tci.guard_sector_review() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'sector_review_immutable: a sector review is never deleted' using errcode = 'P0001';
  end if;
  if old.status <> 'pending'
     or new.id <> old.id or new.sector_id <> old.sector_id or new.quarter_start <> old.quarter_start
     or new.kind <> old.kind or new.grade <> old.grade or new.outlook <> old.outlook
     or new.factors <> old.factors or new.narrative <> old.narrative or new.sources <> old.sources
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'sector_review_immutable: a sector review is resolved once and never changed' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sector_reviews_immutable before update on tci.sector_reviews
  for each row execute function tci.guard_sector_review();
revoke all on function tci.guard_sector_review() from public, anon;

-- The seven factors and how each is scored (sectorReview.ts mirrors them).
create function tci.sector_factor_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['demand', 'prices_margins', 'payment_insolvency', 'financing', 'regulation', 'technology', 'import_fx']
$$;
revoke all on function tci.sector_factor_keys() from public, anon;
grant execute on function tci.sector_factor_keys() to authenticated, service_role;

create function tci.quarter_start(p_day date) returns date
language sql immutable set search_path = '' as $$
  select date_trunc('quarter', p_day)::date
$$;
revoke all on function tci.quarter_start(date) from public, anon;
grant execute on function tci.quarter_start(date) to authenticated, service_role;

-- The sector's grade in force: the latest approved review.
create function tci.sector_current_review(p_sector uuid) returns tci.sector_reviews
language sql stable set search_path = '' as $$
  select r.* from tci.sector_reviews r
   where r.sector_id = p_sector and r.status = 'approved'
   order by r.decided_at desc, r.created_at desc
   limit 1
$$;
revoke all on function tci.sector_current_review(uuid) from public, anon;
grant execute on function tci.sector_current_review(uuid) to authenticated, service_role;

-- A company's sector grade (by its industry), or null.
create function tci.entity_sector_grade(p_entity uuid) returns text
language sql stable security definer set search_path = '' as $$
  select (tci.sector_current_review(s.id)).grade::text
    from tci.legal_entities e
    join tci.sectors s on s.industry_code = e.industry_id
   where e.id = p_entity
$$;
revoke all on function tci.entity_sector_grade(uuid) from public, anon;
grant execute on function tci.entity_sector_grade(uuid) to service_role;

-- An industry's name in the three languages, for a task's params: the
-- Agenda renders the title in the reader's language (rendered text never
-- reaches the database).
create function tci.industry_names(p_code text) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('en', i.name_en, 'ru', i.name_ru, 'uz', i.name_uz)
    from tci.industries i where i.code = p_code
$$;
revoke all on function tci.industry_names(text) from public, anon;
grant execute on function tci.industry_names(text) to authenticated, service_role;

alter table tci.sectors enable row level security;
alter table tci.sector_reviews enable row level security;
create policy "sectors: staff read" on tci.sectors for select to authenticated using (tci.is_staff());
create policy "sector_reviews: staff read" on tci.sector_reviews for select to authenticated using (tci.is_staff());
grant select on tci.sectors, tci.sector_reviews to authenticated;
grant select, insert, update on tci.sectors, tci.sector_reviews to service_role;

-- ---------------------------------------------------------------------------
-- 3. Country risk: OECD imports, internal overrides
-- ---------------------------------------------------------------------------

create table tci.country_risk_imports (
  id             uuid primary key default gen_random_uuid(),
  effective_date date not null,
  file_name      text not null,
  row_count      integer not null,
  note           text,
  imported_by    uuid not null references auth.users (id),
  imported_at    timestamptz not null default now()
);
create table tci.country_risk_classifications (
  import_id      uuid not null references tci.country_risk_imports (id),
  country_code   char(2) not null references tci.countries (code),
  category       smallint not null check (category between 0 and 7),
  primary key (import_id, country_code)
);
comment on table tci.country_risk_classifications is
  'Prompt 31: the OECD Country Risk Classification (0 lowest … 7 highest) as published, one row per country per import, history kept. The current list is the latest import (effective date, then import time); a country not in it is NOT CLASSIFIED (never category 0).';

create table tci.country_risk_overrides (
  id             uuid primary key default gen_random_uuid(),
  country_code   char(2) not null references tci.countries (code),
  category       smallint not null check (category between 0 and 7),
  justification  text not null check (btrim(justification) <> ''),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'ended')),
  proposed_by    uuid not null references auth.users (id),
  proposed_at    timestamptz not null default now(),
  decided_by     uuid references auth.users (id),
  decided_at     timestamptz,
  decision_comment text,
  ended_by       uuid references auth.users (id),
  ended_at       timestamptz,
  end_reason     text
);
create unique index country_risk_overrides_live on tci.country_risk_overrides (country_code) where status = 'approved';
create unique index country_risk_overrides_pending on tci.country_risk_overrides (country_code) where status = 'pending';
comment on table tci.country_risk_overrides is
  'Prompt 31: an internal country grade on the OECD scale, proposed by a credit analyst with a justification and approved by the head of credit analysis (a senior credit analyst, never the proposer). Decisions use it in place of the OECD category while approved.';

create function tci.guard_country_override() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'country_override_immutable: an override is never deleted' using errcode = 'P0001';
  end if;
  if new.country_code <> old.country_code or new.category <> old.category
     or new.justification <> old.justification or new.proposed_by <> old.proposed_by
     or new.proposed_at <> old.proposed_at
     or (old.status in ('rejected', 'ended'))
     or (old.status = 'approved' and new.status <> 'ended') then
    raise exception 'country_override_immutable: an override is decided once and only ended afterwards' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger country_risk_overrides_immutable before update on tci.country_risk_overrides
  for each row execute function tci.guard_country_override();
revoke all on function tci.guard_country_override() from public, anon;

create function tci.guard_country_import() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'country_risk_immutable: an import is history and never changes' using errcode = 'P0001';
end $$;
create trigger country_risk_imports_immutable before update on tci.country_risk_imports
  for each row execute function tci.guard_country_import();
create trigger country_risk_classifications_immutable before update on tci.country_risk_classifications
  for each row execute function tci.guard_country_import();
revoke all on function tci.guard_country_import() from public, anon;

-- The latest import.
create function tci.oecd_latest_import() returns tci.country_risk_imports
language sql stable set search_path = '' as $$
  select i.* from tci.country_risk_imports i order by i.effective_date desc, i.imported_at desc limit 1
$$;
revoke all on function tci.oecd_latest_import() from public, anon;
grant execute on function tci.oecd_latest_import() to authenticated, service_role;

-- A country's risk: the OECD category (latest import), the internal override
-- and the one decisions use. SECURITY DEFINER: the routing and the triggers
-- call it for any caller; it reads only the risk tables.
create function tci.country_risk(p_country char) returns table (
  oecd_category smallint, oecd_effective date, internal_category smallint, override_id uuid,
  category smallint, source text)
language sql stable security definer set search_path = '' as $$
  with imp as (select * from tci.oecd_latest_import()),
       oecd as (select c.category from tci.country_risk_classifications c, imp
                 where c.import_id = imp.id and c.country_code = p_country),
       ovr as (select o.id, o.category from tci.country_risk_overrides o
                where o.country_code = p_country and o.status = 'approved')
  select (select category from oecd), (select effective_date from imp where exists (select 1 from oecd)),
         (select category from ovr), (select id from ovr),
         coalesce((select category from ovr), (select category from oecd)),
         case when exists (select 1 from ovr) then 'internal'
              when exists (select 1 from oecd) then 'oecd' end
$$;
revoke all on function tci.country_risk(char) from public, anon;
grant execute on function tci.country_risk(char) to service_role;

alter table tci.country_risk_imports enable row level security;
alter table tci.country_risk_classifications enable row level security;
alter table tci.country_risk_overrides enable row level security;
create policy "country_risk_imports: staff read" on tci.country_risk_imports for select to authenticated using (tci.is_staff());
create policy "country_risk_classifications: staff read" on tci.country_risk_classifications for select to authenticated using (tci.is_staff());
create policy "country_risk_overrides: staff read" on tci.country_risk_overrides for select to authenticated using (tci.is_staff());
grant select on tci.country_risk_imports, tci.country_risk_classifications, tci.country_risk_overrides to authenticated;
grant select, insert, update on tci.country_risk_imports, tci.country_risk_classifications, tci.country_risk_overrides to service_role;

-- ---------------------------------------------------------------------------
-- 4. Sanctions
-- ---------------------------------------------------------------------------

create table tci.sanction_flags (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null check (scope in ('country', 'entity')),
  country_code   char(2) references tci.countries (code),
  entity_id      uuid references tci.legal_entities (id),
  regime         text not null check (regime in ('UN', 'OFAC', 'EU', 'UK', 'national', 'other')),
  source         text not null check (btrim(source) <> ''),
  reference      text,
  effective_from date not null default current_date,
  note           text,
  set_by         uuid not null references auth.users (id),
  set_at         timestamptz not null default now(),
  lifted_by      uuid references auth.users (id),
  lifted_at      timestamptz,
  lift_reason    text,
  constraint sanction_flags_scope check (
    (scope = 'country' and country_code is not null and entity_id is null)
    or (scope = 'entity' and entity_id is not null and country_code is null)),
  constraint sanction_flags_lift check ((lifted_at is null) = (lifted_by is null) and (lifted_at is null or btrim(coalesce(lift_reason, '')) <> ''))
);
create unique index sanction_flags_live_country on tci.sanction_flags (country_code, regime) where scope = 'country' and lifted_at is null;
create unique index sanction_flags_live_entity on tci.sanction_flags (entity_id, regime) where scope = 'entity' and lifted_at is null;
comment on table tci.sanction_flags is
  'Prompt 31: a sanctions flag on a country or a single company (regime, source, effective date). While live (effective, not lifted) NO cover is possible for that party — refused in SQL whatever the authority. Never deleted; lifting is a stamped event. Maintained by admin today, by a compliance role later (tci.may_manage_sanctions).';

create function tci.guard_sanction_flag() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'sanction_flag_immutable: a sanctions flag is never deleted, it is lifted' using errcode = 'P0001';
  end if;
  if old.lifted_at is not null
     or new.scope <> old.scope or new.country_code is distinct from old.country_code
     or new.entity_id is distinct from old.entity_id or new.regime <> old.regime or new.source <> old.source
     or new.reference is distinct from old.reference or new.effective_from <> old.effective_from
     or new.set_by <> old.set_by or new.set_at <> old.set_at then
    raise exception 'sanction_flag_immutable: a sanctions flag is only lifted, once' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sanction_flags_immutable before update on tci.sanction_flags
  for each row execute function tci.guard_sanction_flag();
revoke all on function tci.guard_sanction_flag() from public, anon;

alter table tci.sanction_flags enable row level security;
create policy "sanction_flags: staff read" on tci.sanction_flags for select to authenticated using (tci.is_staff());
grant select on tci.sanction_flags to authenticated;
grant select, insert, update on tci.sanction_flags to service_role;

-- Who maintains sanctions: admin today; the one place a compliance role
-- will be added.
create function tci.may_manage_sanctions() returns boolean
language sql stable security definer set search_path = '' as $$
  select tci.has_role('admin')
$$;
revoke all on function tci.may_manage_sanctions() from public, anon;
grant execute on function tci.may_manage_sanctions() to authenticated, service_role;

-- Why cover is not available for a company, or null: a live flag on the
-- company itself, or on its country. The reason names no regime: it may
-- reach a client as is. The internal form is what the triggers use (they
-- run for every writer, the owner's scripts included); no API role may call
-- it. API callers use the gated tci.cover_block.
create function tci.cover_block_internal(p_entity uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from tci.sanction_flags f
                  where f.scope = 'entity' and f.entity_id = p_entity
                    and f.lifted_at is null and f.effective_from <= current_date) then 'company'
    when exists (select 1 from tci.sanction_flags f join tci.legal_entities e on e.country_code = f.country_code
                  where f.scope = 'country' and e.id = p_entity
                    and f.lifted_at is null and f.effective_from <= current_date) then 'country'
  end
$$;
revoke all on function tci.cover_block_internal(uuid) from public, anon, authenticated;
grant execute on function tci.cover_block_internal(uuid) to service_role;

create function tci.cover_block(p_entity uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Staff, or a client's own action's workflow code: never a client probing
  -- companies directly.
  perform tci.require_staff_or_internal();
  return tci.cover_block_internal(p_entity);
end $$;
revoke all on function tci.cover_block(uuid) from public, anon;
grant execute on function tci.cover_block(uuid) to authenticated, service_role;

-- The refusal itself, for the triggers (internal) and for the decision
-- functions (through the gated check below).
create function tci.raise_cover_block(p_block text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  -- The two texts are literal, so the screens map each to its own words.
  if p_block = 'company' then
    raise exception 'cover_not_available: company' using errcode = 'P0001', detail = 'cover.notAvailable.company';
  elsif p_block is not null then
    raise exception 'cover_not_available: country' using errcode = 'P0001', detail = 'cover.notAvailable.country';
  end if;
end $$;
revoke all on function tci.raise_cover_block(text) from public, anon;
grant execute on function tci.raise_cover_block(text) to authenticated, service_role;

create function tci.require_cover_available(p_entity uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform tci.raise_cover_block(tci.cover_block(p_entity));
end $$;
revoke all on function tci.require_cover_available(uuid) from public, anon;
grant execute on function tci.require_cover_available(uuid) to authenticated, service_role;

-- The blocking triggers: whatever path creates cover — a staff form, the
-- portal, a resolved proposal, bind, an auto decision, a validator, the
-- committee — a flagged party gets none. No authority overrides it.
create function tci.guard_cover_limit_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.raise_cover_block(tci.cover_block_internal(new.entity_id));
  if new.policy_id is not null then
    perform tci.raise_cover_block(tci.cover_block_internal((select p.entity_id from tci.policies p where p.id = new.policy_id)));
  end if;
  if new.insurance_request_id is not null then
    perform tci.raise_cover_block(tci.cover_block_internal((select r.entity_id from tci.insurance_requests r where r.id = new.insurance_request_id)));
  end if;
  return new;
end $$;
create trigger credit_limit_requests_cover before insert on tci.credit_limit_requests
  for each row execute function tci.guard_cover_limit_request();
revoke all on function tci.guard_cover_limit_request() from public, anon;

create function tci.guard_cover_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_request tci.credit_limit_requests%rowtype;
begin
  -- Only what grants cover is refused: a decline, a reduction to nothing
  -- and a revocation must always remain possible.
  if new.outcome not in ('approved', 'partial') then
    return new;
  end if;
  select * into v_request from tci.credit_limit_requests where id = new.request_id;
  perform tci.raise_cover_block(tci.cover_block_internal(v_request.entity_id));
  if v_request.policy_id is not null then
    perform tci.raise_cover_block(tci.cover_block_internal((select p.entity_id from tci.policies p where p.id = v_request.policy_id)));
  end if;
  if v_request.insurance_request_id is not null then
    perform tci.raise_cover_block(tci.cover_block_internal((select r.entity_id from tci.insurance_requests r where r.id = v_request.insurance_request_id)));
  end if;
  return new;
end $$;
create trigger credit_limit_decisions_cover before insert on tci.credit_limit_decisions
  for each row execute function tci.guard_cover_decision();
revoke all on function tci.guard_cover_decision() from public, anon;

create function tci.guard_cover_entity_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null then
    perform tci.raise_cover_block(tci.cover_block_internal(new.entity_id));
  end if;
  return new;
end $$;
create trigger insurance_requests_cover before insert on tci.insurance_requests
  for each row execute function tci.guard_cover_entity_row();
create trigger insurance_request_buyers_cover before insert or update of entity_id on tci.insurance_request_buyers
  for each row execute function tci.guard_cover_entity_row();
create trigger policies_cover before insert on tci.policies
  for each row execute function tci.guard_cover_entity_row();
revoke all on function tci.guard_cover_entity_row() from public, anon;

-- ---------------------------------------------------------------------------
-- 5. The cover matrix: the authority rank a decision needs
-- ---------------------------------------------------------------------------

-- The rank a decision granting cover to this buyer needs (0 = normal
-- authority): the country category's floor (internal override first, then
-- OECD, else 'unclassified'), plus the sector grade's addition; at most 5,
-- the committee.
create function tci.cover_required_rank_internal(p_entity uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_country char(2);
  v_key text;
  v_grade text;
begin
  select e.country_code into v_country from tci.legal_entities e where e.id = p_entity;
  if not found then
    return null;
  end if;
  -- Until an OECD list has been imported the country part is inactive: an
  -- empty list would make every country «not classified» and send every
  -- decision to the committee. Once a list exists, not classified means
  -- not classified (never category 0).
  v_key := case
             when (tci.oecd_latest_import()).id is null
                  and not exists (select 1 from tci.country_risk_overrides o
                                   where o.country_code = v_country and o.status = 'approved') then null
             else coalesce((select r.category::text from tci.country_risk(v_country) r), 'unclassified') end;
  v_grade := tci.entity_sector_grade(p_entity);
  return least(5,
           coalesce((select a.rank_floor from tci.risk_adjustment_settings a
                      where a.dimension = 'country' and a.key = v_key), 0)
         + coalesce((select a.rank_add from tci.risk_adjustment_settings a
                      where a.dimension = 'sector' and a.key = v_grade), 0))::integer;
end $$;
revoke all on function tci.cover_required_rank_internal(uuid) from public, anon, authenticated;
grant execute on function tci.cover_required_rank_internal(uuid) to service_role;

create function tci.cover_required_rank(p_entity uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform tci.require_staff_or_internal();
  return tci.cover_required_rank_internal(p_entity);
end $$;
revoke all on function tci.cover_required_rank(uuid) from public, anon;
grant execute on function tci.cover_required_rank(uuid) to authenticated, service_role;

-- Everything a decision screen shows about a buyer's sector, country and
-- cover (staff only).
create function tci.buyer_risk_context(p_entity uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e tci.legal_entities%rowtype;
  v_sector tci.sectors%rowtype;
  v_review tci.sector_reviews%rowtype;
  v_country record;
  v_flags jsonb;
begin
  perform tci.require_staff();
  select * into v_e from tci.legal_entities where id = p_entity;
  if not found then
    raise exception 'company % not found', p_entity using errcode = 'P0002';
  end if;
  select * into v_sector from tci.sectors where industry_code = v_e.industry_id;
  if found then
    v_review := tci.sector_current_review(v_sector.id);
  end if;
  select * into v_country from tci.country_risk(v_e.country_code);
  select coalesce(jsonb_agg(jsonb_build_object('scope', f.scope, 'regime', f.regime, 'source', f.source,
                                               'reference', f.reference, 'effective_from', f.effective_from)
                            order by f.effective_from), '[]'::jsonb)
    into v_flags
    from tci.sanction_flags f
   where f.lifted_at is null and f.effective_from <= current_date
     and ((f.scope = 'entity' and f.entity_id = p_entity) or (f.scope = 'country' and f.country_code = v_e.country_code));
  return jsonb_build_object(
    'sector_id', v_sector.id,
    'industry_code', v_e.industry_id,
    'sector_grade', v_review.grade,
    'sector_outlook', v_review.outlook,
    'sector_reviewed_at', v_review.decided_at,
    'sector_stale', v_review.id is not null and v_review.quarter_start < tci.quarter_start(current_date),
    'country_code', v_e.country_code,
    'country_category', v_country.category,
    'country_source', v_country.source,
    'oecd_category', v_country.oecd_category,
    'internal_category', v_country.internal_category,
    'cover_block', tci.cover_block(p_entity),
    'sanctions', v_flags,
    'required_rank', tci.cover_required_rank(p_entity),
    'my_rank', tci.user_rank((select auth.uid()), 'credit'));
end $$;
revoke all on function tci.buyer_risk_context(uuid) from public, anon;
grant execute on function tci.buyer_risk_context(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Sector reviews: assign, submit, decide, the quarterly task
-- ---------------------------------------------------------------------------

create function tci.assign_sector_analyst(p_sector uuid, p_analyst uuid) returns tci.sectors
language plpgsql security definer set search_path = '' as $$
declare v_row tci.sectors%rowtype;
begin
  perform tci.require_role('admin');
  if p_analyst is not null and not exists (select 1 from tci.user_roles r where r.user_id = p_analyst and r.role = 'credit_analyst') then
    raise exception 'sector_analyst_not_analyst: the responsible person must hold the credit analyst role' using errcode = 'P0001';
  end if;
  update tci.sectors set analyst_id = p_analyst, assigned_by = (select auth.uid()), assigned_at = now()
   where id = p_sector returning * into v_row;
  if not found then
    raise exception 'sector % not found', p_sector using errcode = 'P0002';
  end if;
  -- The open quarterly task follows the person.
  perform tci.begin_trusted_call();
  update tci.tasks set status = 'cancelled', completed_at = now()
   where task_type = 'sector_review_due' and object_id = p_sector and status = 'open'
     and target_user is distinct from p_analyst;
  perform tci.refresh_sector_tasks();
  return v_row;
end $$;
revoke all on function tci.assign_sector_analyst(uuid, uuid) from public, anon;
grant execute on function tci.assign_sector_analyst(uuid, uuid) to authenticated;

-- The factors object: every key of sector_factor_keys, each
-- {score: favourable|neutral|adverse, note: text}.
create function tci.sector_factors_valid(p_factors jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_factors) = 'object'
     and (select count(*) from jsonb_object_keys(p_factors)) = cardinality(tci.sector_factor_keys())
     and (select bool_and(p_factors ? k
                          and jsonb_typeof(p_factors -> k) = 'object'
                          and (p_factors -> k ->> 'score') in ('favourable', 'neutral', 'adverse')
                          and coalesce(jsonb_typeof(p_factors -> k -> 'note'), 'string') = 'string')
            from unnest(tci.sector_factor_keys()) k)
$$;
revoke all on function tci.sector_factors_valid(jsonb) from public, anon;
grant execute on function tci.sector_factors_valid(jsonb) to authenticated, service_role;

-- What follows a review coming into force: the event, the end of the
-- quarter's task, and — on a downgrade to C or D — credit underwriting's
-- review of the buyers with limits in the sector.
create function tci.sector_review_in_force(p_review tci.sector_reviews, p_previous text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_buyers integer;
  v_names jsonb;
begin
  perform tci.require_internal_call();
  update tci.tasks set status = 'done', completed_by = p_review.created_by, completed_at = now()
   where task_type = 'sector_review_due' and object_id = p_review.sector_id and status = 'open';
  perform tci.emit_workflow_event('sector.graded', 'sector', p_review.sector_id,
    jsonb_build_object('review_id', p_review.id, 'from', p_previous, 'to', p_review.grade,
                       'outlook', p_review.outlook, 'kind', p_review.kind),
    null, null);
  if p_review.grade in ('C', 'D') and (p_previous is null or p_previous < p_review.grade) then
    select count(distinct v.entity_id) into v_buyers
      from tci.v_effective_limits v
      join tci.legal_entities e on e.id = v.entity_id
      join tci.sectors s on s.industry_code = e.industry_id
     where s.id = p_review.sector_id and v.outcome in ('approved', 'partial') and v.policy_id is not null;
    -- The task lists the buyers (the first 25 by name; the sector page has
    -- them all).
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name), '[]'::jsonb)
      into v_names
      from (select distinct e.id, e.name
              from tci.v_effective_limits v
              join tci.legal_entities e on e.id = v.entity_id
              join tci.sectors s on s.industry_code = e.industry_id
             where s.id = p_review.sector_id and v.outcome in ('approved', 'partial') and v.policy_id is not null
             order by e.name limit 25) x;
    if v_buyers > 0 then
      perform tci.open_task('sector_downgrade_review', 'sector', p_review.sector_id,
        'agenda.tasks.sector_downgrade_review',
        jsonb_build_object('industry', (select industry_code from tci.sectors where id = p_review.sector_id),
                           'industry_names', tci.industry_names((select industry_code from tci.sectors where id = p_review.sector_id)),
                           'from', p_previous, 'to', p_review.grade, 'buyers', v_buyers,
                           'buyer_list', v_names),
        'credit_underwriter'::tci.user_role, null, null, 'high', null);
    end if;
  end if;
end $$;
revoke all on function tci.sector_review_in_force(tci.sector_reviews, text) from public, anon;
grant execute on function tci.sector_review_in_force(tci.sector_reviews, text) to authenticated, service_role;

create function tci.submit_sector_review(
  p_sector uuid, p_grade text, p_outlook text, p_factors jsonb, p_narrative text,
  p_sources jsonb default '[]'::jsonb, p_kind text default 'quarterly')
returns tci.sector_reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_four_eyes boolean;
  v_previous text;
  v_row tci.sector_reviews%rowtype;
begin
  perform tci.require_role('credit_analyst');
  perform tci.begin_trusted_call();
  if not exists (select 1 from tci.sectors where id = p_sector) then
    raise exception 'sector % not found', p_sector using errcode = 'P0002';
  end if;
  if p_kind not in ('quarterly', 'ad_hoc') then
    raise exception 'sector_review_kind: a review is quarterly or ad hoc' using errcode = 'P0001';
  end if;
  if not tci.sector_factors_valid(p_factors) then
    raise exception 'sector_review_factors: every factor needs a score (favourable, neutral or adverse)' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_narrative), '') = '' then
    raise exception 'sector_review_narrative_required: say what the grade rests on' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.sector_reviews where sector_id = p_sector and status = 'pending') then
    raise exception 'sector_review_pending: a review of this sector is waiting for approval' using errcode = 'P0001';
  end if;

  select s.sector_review_four_eyes into v_four_eyes from tci.workflow_settings s where s.id;
  v_previous := (tci.sector_current_review(p_sector)).grade;

  insert into tci.sector_reviews (sector_id, quarter_start, kind, grade, outlook, factors, narrative, sources,
                                  status, created_by, decided_by, decided_at)
  values (p_sector, tci.quarter_start(current_date), p_kind, p_grade, p_outlook, p_factors, btrim(p_narrative),
          coalesce(p_sources, '[]'::jsonb),
          case when v_four_eyes then 'pending' else 'approved' end,
          (select auth.uid()),
          case when v_four_eyes then null else (select auth.uid()) end,
          case when v_four_eyes then null else clock_timestamp() end)
  returning * into v_row;

  if v_four_eyes then
    update tci.tasks set status = 'done', completed_by = (select auth.uid()), completed_at = now()
     where task_type = 'sector_review_due' and object_id = p_sector and status = 'open';
    perform tci.open_task('sector_review_approval', 'sector', p_sector,
      'agenda.tasks.sector_review_approval',
      jsonb_build_object('industry', (select industry_code from tci.sectors where id = p_sector),
                         'industry_names', tci.industry_names((select industry_code from tci.sectors where id = p_sector)),
                         'grade', v_row.grade, 'review_id', v_row.id),
      'credit_analyst'::tci.user_role, null, null, 'high', null);
  else
    perform tci.sector_review_in_force(v_row, v_previous);
  end if;
  return v_row;
end $$;
revoke all on function tci.submit_sector_review(uuid, text, text, jsonb, text, jsonb, text) from public, anon;
grant execute on function tci.submit_sector_review(uuid, text, text, jsonb, text, jsonb, text) to authenticated;

-- Four eyes: another credit analyst approves or rejects, once.
create function tci.decide_sector_review(p_review uuid, p_approve boolean, p_comment text default null)
returns tci.sector_reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_row tci.sector_reviews%rowtype;
  v_previous text;
begin
  perform tci.require_role('credit_analyst');
  perform tci.begin_trusted_call();
  select * into v_row from tci.sector_reviews where id = p_review for update;
  if not found then
    raise exception 'sector review % not found', p_review using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'sector_review_decided: this review is already %', v_row.status using errcode = 'P0001';
  end if;
  if v_row.created_by = (select auth.uid()) then
    raise exception 'four_eyes_own_sector_review: a second analyst approves a sector review' using errcode = '42501';
  end if;
  if not p_approve and coalesce(btrim(p_comment), '') = '' then
    raise exception 'sector_review_reject_reason: say why the review is rejected' using errcode = 'P0001';
  end if;
  v_previous := (tci.sector_current_review(v_row.sector_id)).grade;
  update tci.sector_reviews
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = (select auth.uid()), decided_at = clock_timestamp(), decision_comment = nullif(btrim(p_comment), '')
   where id = p_review
   returning * into v_row;
  update tci.tasks set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where task_type = 'sector_review_approval' and object_id = v_row.sector_id and status = 'open';
  if p_approve then
    perform tci.sector_review_in_force(v_row, v_previous);
  else
    perform tci.refresh_sector_tasks();
  end if;
  return v_row;
end $$;
revoke all on function tci.decide_sector_review(uuid, boolean, text) from public, anon;
grant execute on function tci.decide_sector_review(uuid, boolean, text) to authenticated;

-- The quarterly task, generated and retired on read (refresh_agenda calls
-- it): each sector with a responsible analyst and no review of this quarter
-- (approved or waiting) has one open task, due on the configured day.
create function tci.refresh_sector_tasks() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_q date := tci.quarter_start(current_date);
  v_due_day smallint;
  v_row record;
  v_opened integer := 0;
begin
  perform tci.require_staff_or_internal();
  perform tci.begin_trusted_call();
  select s.sector_review_due_day into v_due_day from tci.workflow_settings s where s.id;

  -- A task of an earlier quarter, or one already answered, closes.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'sector_review_due' and t.status = 'open'
     and ((t.params ->> 'quarter_start')::date < v_q
          or exists (select 1 from tci.sector_reviews r
                      where r.sector_id = t.object_id and r.quarter_start = v_q and r.status in ('approved', 'pending')));

  for v_row in
    select s.id, s.industry_code, s.analyst_id
      from tci.sectors s
     where s.analyst_id is not null
       and not exists (select 1 from tci.sector_reviews r
                        where r.sector_id = s.id and r.quarter_start = v_q and r.status in ('approved', 'pending'))
  loop
    perform tci.open_task('sector_review_due', 'sector', v_row.id,
      'agenda.tasks.sector_review_due',
      jsonb_build_object('industry', v_row.industry_code, 'industry_names', tci.industry_names(v_row.industry_code),
                         'quarter_start', v_q,
                         'quarter', extract(quarter from v_q)::int, 'year', extract(year from v_q)::int),
      'credit_analyst'::tci.user_role, v_row.analyst_id,
      ((v_q + (v_due_day - 1)) + time '23:59') at time zone 'Asia/Tashkent',
      'normal', null);
    v_opened := v_opened + 1;
  end loop;
  return v_opened;
end $$;
revoke all on function tci.refresh_sector_tasks() from public, anon;
grant execute on function tci.refresh_sector_tasks() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Country risk: import, override, decide
-- ---------------------------------------------------------------------------

-- An import is the whole published list: [{country_code, category}], a
-- country left out is not classified. Unknown codes refuse the import and
-- are named.
create function tci.import_country_risk(p_effective date, p_file_name text, p_rows jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_import uuid;
  v_unknown text[];
  v_bad text[];
  v_count integer;
begin
  perform tci.require_role('admin');
  perform tci.begin_trusted_call();
  if p_effective is null or coalesce(btrim(p_file_name), '') = '' then
    raise exception 'country_import_incomplete: the effective date and the file name are required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'country_import_empty: the file holds no classification' using errcode = 'P0001';
  end if;
  select array_agg(distinct upper(r ->> 'country_code')) into v_unknown
    from jsonb_array_elements(p_rows) r
   where not exists (select 1 from tci.countries c where c.code = upper(r ->> 'country_code'));
  if v_unknown is not null then
    raise exception 'country_import_unknown: %', array_to_string(v_unknown, ', ')
      using errcode = 'P0001', detail = array_to_string(v_unknown, ',');
  end if;
  select array_agg(r ->> 'country_code') into v_bad
    from jsonb_array_elements(p_rows) r
   where (r ->> 'category') !~ '^[0-7]$';
  if v_bad is not null then
    raise exception 'country_import_category: %', array_to_string(v_bad, ', ')
      using errcode = 'P0001', detail = array_to_string(v_bad, ',');
  end if;
  if (select count(*) from jsonb_array_elements(p_rows)) <> (select count(distinct upper(r ->> 'country_code')) from jsonb_array_elements(p_rows) r) then
    raise exception 'country_import_duplicate: a country appears twice in the file' using errcode = 'P0001';
  end if;

  insert into tci.country_risk_imports (effective_date, file_name, row_count, note, imported_by)
  values (p_effective, btrim(p_file_name), jsonb_array_length(p_rows), nullif(btrim(p_note), ''), (select auth.uid()))
  returning id into v_import;
  insert into tci.country_risk_classifications (import_id, country_code, category)
  select v_import, upper(r ->> 'country_code'), (r ->> 'category')::smallint
    from jsonb_array_elements(p_rows) r;
  get diagnostics v_count = row_count;

  perform tci.emit_workflow_event('country_risk.imported', 'country_risk_import', v_import,
    jsonb_build_object('effective_date', p_effective, 'rows', v_count), null, null);
  return jsonb_build_object('import_id', v_import, 'rows', v_count);
end $$;
revoke all on function tci.import_country_risk(date, text, jsonb, text) from public, anon;
grant execute on function tci.import_country_risk(date, text, jsonb, text) to authenticated;

-- The head of credit analysis: credit analysts admin marked senior (0074).
create function tci.head_analyst_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.user_id), '{}')
    from tci.user_profiles p
   where p.senior_credit_analyst
     and exists (select 1 from tci.user_roles r where r.user_id = p.user_id and r.role = 'credit_analyst')
$$;
revoke all on function tci.head_analyst_ids() from public, anon;
grant execute on function tci.head_analyst_ids() to service_role;

create function tci.propose_country_override(p_country char, p_category smallint, p_justification text)
returns tci.country_risk_overrides
language plpgsql security definer set search_path = '' as $$
declare
  v_row tci.country_risk_overrides%rowtype;
  v_head uuid;
begin
  perform tci.require_role('credit_analyst');
  perform tci.begin_trusted_call();
  if not exists (select 1 from tci.countries where code = upper(p_country)) then
    raise exception 'country % not found', p_country using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_justification), '') = '' then
    raise exception 'country_override_justification: say why the internal grade differs' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.country_risk_overrides where country_code = upper(p_country) and status = 'pending') then
    raise exception 'country_override_pending: an override of this country is waiting for approval' using errcode = 'P0001';
  end if;
  insert into tci.country_risk_overrides (country_code, category, justification, proposed_by)
  values (upper(p_country), p_category, btrim(p_justification), (select auth.uid()))
  returning * into v_row;
  -- Every head of credit analysis but the proposer is told; none → the role.
  for v_head in select unnest(tci.head_analyst_ids()) loop
    continue when v_head = (select auth.uid());
    perform tci.open_task('country_override_approval', 'country_risk_override', v_row.id,
      'agenda.tasks.country_override_approval',
      jsonb_build_object('country', v_row.country_code, 'category', v_row.category),
      'credit_analyst'::tci.user_role, v_head, null, 'high', null);
  end loop;
  if not exists (select 1 from tci.tasks where task_type = 'country_override_approval' and object_id = v_row.id and status = 'open') then
    perform tci.open_task('country_override_approval', 'country_risk_override', v_row.id,
      'agenda.tasks.country_override_approval',
      jsonb_build_object('country', v_row.country_code, 'category', v_row.category),
      'credit_analyst'::tci.user_role, null, null, 'high', null);
  end if;
  return v_row;
end $$;
revoke all on function tci.propose_country_override(char, smallint, text) from public, anon;
grant execute on function tci.propose_country_override(char, smallint, text) to authenticated;

create function tci.decide_country_override(p_override uuid, p_approve boolean, p_comment text default null)
returns tci.country_risk_overrides
language plpgsql security definer set search_path = '' as $$
declare v_row tci.country_risk_overrides%rowtype;
begin
  perform tci.require_role('credit_analyst');
  perform tci.begin_trusted_call();
  if not tci.is_senior_credit_analyst() then
    raise exception 'country_override_head_only: the head of credit analysis approves an internal country grade' using errcode = '42501';
  end if;
  select * into v_row from tci.country_risk_overrides where id = p_override for update;
  if not found then
    raise exception 'override % not found', p_override using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'country_override_decided: this override is already %', v_row.status using errcode = 'P0001';
  end if;
  if v_row.proposed_by = (select auth.uid()) then
    raise exception 'four_eyes_own_country_override: another person approves an internal country grade' using errcode = '42501';
  end if;
  if not p_approve and coalesce(btrim(p_comment), '') = '' then
    raise exception 'country_override_reject_reason: say why it is rejected' using errcode = 'P0001';
  end if;
  if p_approve then
    update tci.country_risk_overrides
       set status = 'ended', ended_by = (select auth.uid()), ended_at = now(), end_reason = 'replaced'
     where country_code = v_row.country_code and status = 'approved';
  end if;
  update tci.country_risk_overrides
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = (select auth.uid()), decided_at = now(), decision_comment = nullif(btrim(p_comment), '')
   where id = p_override
   returning * into v_row;
  update tci.tasks set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where task_type = 'country_override_approval' and object_id = p_override and status = 'open';
  if p_approve then
    perform tci.emit_workflow_event('country_risk.override_approved', 'country_risk_override', v_row.id,
      jsonb_build_object('country', v_row.country_code, 'category', v_row.category), null, null);
  end if;
  return v_row;
end $$;
revoke all on function tci.decide_country_override(uuid, boolean, text) from public, anon;
grant execute on function tci.decide_country_override(uuid, boolean, text) to authenticated;

create function tci.end_country_override(p_override uuid, p_reason text)
returns tci.country_risk_overrides
language plpgsql security definer set search_path = '' as $$
declare v_row tci.country_risk_overrides%rowtype;
begin
  perform tci.require_role('credit_analyst');
  if not tci.is_senior_credit_analyst() then
    raise exception 'country_override_head_only: the head of credit analysis ends an internal country grade' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'country_override_end_reason: say why it ends' using errcode = 'P0001';
  end if;
  update tci.country_risk_overrides
     set status = 'ended', ended_by = (select auth.uid()), ended_at = now(), end_reason = btrim(p_reason)
   where id = p_override and status = 'approved'
   returning * into v_row;
  if not found then
    raise exception 'no live override %', p_override using errcode = 'P0002';
  end if;
  return v_row;
end $$;
revoke all on function tci.end_country_override(uuid, text) from public, anon;
grant execute on function tci.end_country_override(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Sanctions: set and lift
-- ---------------------------------------------------------------------------

-- Setting a flag opens an urgent review task per in-force limit it touches
-- (credit underwriting reviews or revokes — nothing is revoked here) and
-- answers how many.
create function tci.set_sanction_flag(
  p_scope text, p_country char, p_entity uuid, p_regime text, p_source text,
  p_reference text default null, p_effective_from date default current_date, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_flag tci.sanction_flags%rowtype;
  v_limit record;
  v_count integer := 0;
begin
  perform tci.require_staff();
  if not tci.may_manage_sanctions() then
    raise exception 'sanctions_manage_only: sanctions flags are maintained by admin' using errcode = '42501';
  end if;
  perform tci.begin_trusted_call();
  insert into tci.sanction_flags (scope, country_code, entity_id, regime, source, reference, effective_from, note, set_by)
  values (p_scope, case when p_scope = 'country' then upper(p_country) end,
          case when p_scope = 'entity' then p_entity end,
          p_regime, btrim(p_source), nullif(btrim(p_reference), ''), coalesce(p_effective_from, current_date),
          nullif(btrim(p_note), ''), (select auth.uid()))
  returning * into v_flag;

  for v_limit in
    select distinct v.request_id, v.entity_id, v.policy_id
      from tci.v_effective_limits v
      join tci.legal_entities e on e.id = v.entity_id
      left join tci.policies p on p.id = v.policy_id
      left join tci.legal_entities ph on ph.id = p.entity_id
     where v.outcome in ('approved', 'partial') and v.policy_id is not null
       and ((v_flag.scope = 'entity' and (v.entity_id = v_flag.entity_id or p.entity_id = v_flag.entity_id))
            or (v_flag.scope = 'country' and (e.country_code = v_flag.country_code or ph.country_code = v_flag.country_code)))
  loop
    perform tci.open_task('sanctions_limit_review', 'credit_limit_request', v_limit.request_id,
      'agenda.tasks.sanctions_limit_review',
      jsonb_build_object('entity_id', v_limit.entity_id, 'flag_id', v_flag.id, 'scope', v_flag.scope,
                         'regime', v_flag.regime),
      'credit_underwriter'::tci.user_role, null, now(), 'urgent', null);
    v_count := v_count + 1;
  end loop;

  perform tci.emit_workflow_event('sanctions.flagged', 'sanction_flag', v_flag.id,
    jsonb_build_object('scope', v_flag.scope, 'country', v_flag.country_code, 'entity_id', v_flag.entity_id,
                       'regime', v_flag.regime, 'limits_to_review', v_count), null, null);
  return jsonb_build_object('flag_id', v_flag.id, 'limits_to_review', v_count);
end $$;
revoke all on function tci.set_sanction_flag(text, char, uuid, text, text, text, date, text) from public, anon;
grant execute on function tci.set_sanction_flag(text, char, uuid, text, text, text, date, text) to authenticated;

create function tci.lift_sanction_flag(p_flag uuid, p_reason text) returns tci.sanction_flags
language plpgsql security definer set search_path = '' as $$
declare v_flag tci.sanction_flags%rowtype;
begin
  perform tci.require_staff();
  if not tci.may_manage_sanctions() then
    raise exception 'sanctions_manage_only: sanctions flags are maintained by admin' using errcode = '42501';
  end if;
  perform tci.begin_trusted_call();
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'sanctions_lift_reason: say why the flag is lifted' using errcode = 'P0001';
  end if;
  update tci.sanction_flags
     set lifted_by = (select auth.uid()), lifted_at = now(), lift_reason = btrim(p_reason)
   where id = p_flag and lifted_at is null
   returning * into v_flag;
  if not found then
    raise exception 'no live sanctions flag %', p_flag using errcode = 'P0002';
  end if;
  perform tci.emit_workflow_event('sanctions.lifted', 'sanction_flag', v_flag.id,
    jsonb_build_object('scope', v_flag.scope, 'country', v_flag.country_code, 'entity_id', v_flag.entity_id), null, null);
  return v_flag;
end $$;
revoke all on function tci.lift_sanction_flag(uuid, text) from public, anon;
grant execute on function tci.lift_sanction_flag(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Settings writers (admin)
-- ---------------------------------------------------------------------------

create function tci.save_risk_adjustment(
  p_dimension text, p_key text, p_notch smallint, p_cap_grade text, p_cover text,
  p_rank_floor smallint, p_rank_add smallint, p_premium_loading_pct numeric)
returns tci.risk_adjustment_settings
language plpgsql security definer set search_path = '' as $$
declare v_row tci.risk_adjustment_settings%rowtype;
begin
  perform tci.require_role('admin');
  update tci.risk_adjustment_settings
     set notch = p_notch, cap_grade = nullif(p_cap_grade, ''), cover = p_cover,
         rank_floor = p_rank_floor, rank_add = p_rank_add, premium_loading_pct = p_premium_loading_pct,
         updated_by = (select auth.uid()), updated_at = now()
   where dimension = p_dimension and key = p_key
   returning * into v_row;
  if not found then
    raise exception 'no adjustment row % %', p_dimension, p_key using errcode = 'P0002';
  end if;
  return v_row;
end $$;
revoke all on function tci.save_risk_adjustment(text, text, smallint, text, text, smallint, smallint, numeric) from public, anon;
grant execute on function tci.save_risk_adjustment(text, text, smallint, text, text, smallint, smallint, numeric) to authenticated;

create function tci.set_risk_settings(
  p_sector_review_due_day smallint, p_sector_review_four_eyes boolean, p_oecd_stale_months smallint,
  p_concentration_warn_pct numeric, p_client_show_oecd boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_role('admin');
  update tci.workflow_settings
     set sector_review_due_day = p_sector_review_due_day,
         sector_review_four_eyes = coalesce(p_sector_review_four_eyes, false),
         oecd_stale_months = p_oecd_stale_months,
         concentration_warn_pct = p_concentration_warn_pct,
         client_show_oecd = coalesce(p_client_show_oecd, false),
         updated_by = (select auth.uid()), updated_at = now()
   where id;
end $$;
revoke all on function tci.set_risk_settings(smallint, boolean, smallint, numeric, boolean) from public, anon;
grant execute on function tci.set_risk_settings(smallint, boolean, smallint, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The decision path: sanctions first, then the cover matrix
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.decide_limit_request(p_request_id uuid, p_outcome tci.decision_outcome, p_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_valid_from date DEFAULT CURRENT_DATE, p_valid_until date DEFAULT NULL::date, p_conditions jsonb DEFAULT '[]'::jsonb, p_comment text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_decision tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_condition jsonb;
  v_group    jsonb;
  v_pending  record;
  v_resolving uuid := tci.resolving_validation();
  v_refusal  text;
begin
  perform tci.begin_internal_call();
  if p_outcome = 'revoked' then
    raise exception 'use tci.revoke_effective_limit to revoke an effective limit'
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status
      using errcode = 'P0001';
  end if;

  if not tci.has_role('credit_underwriter') then
    raise exception 'only credit underwriting may decide' using errcode = '42501';
  end if;
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;

  -- 0060: a request on validation is decided only by its validator, from
  -- resolve_limit_validation.
  select * into v_pending from tci.pending_validation_of(p_request_id, 'credit');
  if found and (v_resolving is distinct from v_pending.id
                or v_pending.validator_id <> (select auth.uid())) then
    raise exception 'limit_validation_pending: this request is on validation'
      using errcode = 'P0001';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);
  v_band := tci.grade_band_for_assessment(p_assessment_id);

  if p_outcome in ('approved', 'partial') then
    -- 0085: no cover for a sanctioned country or company, whatever the authority.
    perform tci.require_cover_available(v_request.entity_id);
    if p_amount is null or p_amount <= 0 then
      raise exception 'approved/partial decisions require a positive amount'
        using errcode = 'P0001';
    end if;

    -- 0063: no admin bypass: admin holds no business decision rights
    v_amount_uzs := tci.to_uzs(p_amount, v_currency);
    -- 0071: a committee vote being carried out is the top of the chain.
    v_authority_uzs := case when v_resolving is not null and tci.committee_resolving() = v_resolving
                            then 'Infinity'::numeric else tci.my_authority_uzs(v_band) end;
    -- 0085: the cover matrix — a country category, or a D sector, may need a
    -- higher authority rank than the decider holds; then, as beyond the
    -- amount, nothing is recorded and the decision goes up the levels.
    if v_amount_uzs > v_authority_uzs
       or (v_resolving is null
           and tci.user_rank((select auth.uid()), 'credit') < tci.cover_required_rank(v_request.entity_id)) then
      -- 0060: beyond authority nothing is recorded; the author sends it to
      -- a named validator (submit_limit_for_validation), and a validator
      -- beyond THEIR authority forwards it.
      if v_resolving is not null then
        raise exception 'validation_beyond_authority: the amount is beyond your authority for rating band % — forward it',
          v_band using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'result', 'needs_validation',
        'grade_band', v_band,
        'amount_uzs', v_amount_uzs,
        'authority_uzs', v_authority_uzs,
        'required_rank', tci.cover_required_rank(v_request.entity_id)
      );
    end if;

    -- PHASE 6: the group control. Blocking, and it escalates rather than
    -- simply failing, so the request reaches someone who can weigh the whole
    -- group. Since 0063 nobody is exempt.
    v_group := tci.group_exposure_preflight(
      v_request.entity_id, p_amount, v_currency,
      tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));

    if (v_group ->> 'over_limit')::boolean then
      if v_resolving is not null then
        raise exception 'validation_group_limit: this amount would take the group over its limit'
          using errcode = 'P0001', detail = 'limits.errors.groupLimitExceeded';
      end if;
      update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

      perform tci.emit_workflow_event(
        'limit.group_limit_breached', 'credit_limit_request', p_request_id,
        jsonb_build_object(
          'entity_id', v_request.entity_id,
          'ultimate_parent_id', v_group ->> 'ultimate_parent_id',
          'amount', p_amount,
          'currency', v_currency,
          'exposure_after_uzs', v_group ->> 'exposure_after_uzs',
          'group_limit_uzs', v_group ->> 'group_limit_uzs'),
        'credit_underwriter'::tci.user_role);

      return jsonb_build_object(
        'result', 'group_limit_exceeded',
        'grade_band', v_band,
        'group', v_group
      );
    end if;
  elsif p_outcome = 'declined' then
    if p_amount is not null then
      raise exception 'declined decisions carry no amount' using errcode = 'P0001';
    end if;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, valid_until, based_on_assessment_id, comment, validation_id
  ) values (
    p_request_id, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, p_assessment_id, p_comment, v_resolving
  ) returning * into v_decision;

  for v_condition in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    insert into tci.decision_conditions (decision_id, condition_type, description)
    values (
      v_decision.id,
      (v_condition->>'condition_type')::tci.condition_type,
      v_condition->>'description'
    );
  end loop;

  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(v_request.policy_id, v_request.insurance_request_id)
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object(
    'result', 'decided', 'decision_id', v_decision.id, 'grade_band', v_band);
end;
$function$;

CREATE OR REPLACE FUNCTION tci.submit_limit_for_validation(p_request_id uuid, p_validator_id uuid, p_outcome tci.decision_outcome, p_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_valid_from date DEFAULT CURRENT_DATE, p_valid_until date DEFAULT NULL::date, p_conditions jsonb DEFAULT '[]'::jsonb, p_comment text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_kind     tci.validation_kind;
  v_row      tci.limit_validations%rowtype;
  v_id       uuid := gen_random_uuid();
  v_refusal  text;
  v_routing  text;
  v_rank     integer;
  v_level    uuid;
  v_fyi      uuid[] := '{}';
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();

  -- 0071: a proposal goes to an authority LEVEL, never to a chosen person.
  if p_validator_id is not null then
    raise exception 'named_validator_retired: a proposal goes to the authority level that may decide it, not to a chosen colleague'
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status using errcode = 'P0001';
  end if;
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;
  if exists (select 1 from tci.limit_validations where request_id = p_request_id and status = 'pending') then
    raise exception 'limit_validation_pending: this request is already on validation' using errcode = 'P0001';
  end if;
  if p_outcome not in ('approved', 'partial', 'declined') then
    raise exception 'only an approval, a partial approval or a decline can be validated' using errcode = 'P0001';
  end if;
  if p_outcome in ('approved', 'partial') and (p_amount is null or p_amount <= 0) then
    raise exception 'approved/partial decisions require a positive amount' using errcode = 'P0001';
  end if;
  if p_outcome = 'declined' and p_amount is not null then
    raise exception 'declined decisions carry no amount' using errcode = 'P0001';
  end if;

  -- 0085: no cover for a sanctioned country or company.
  if p_outcome in ('approved', 'partial') then
    perform tci.require_cover_available(v_request.entity_id);
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);
  v_band := tci.grade_band_for_assessment(p_assessment_id);
  v_amount_uzs := case when p_amount is null then null else tci.to_uzs(p_amount, v_currency) end;
  v_kind := case
              when p_amount is not null
                   and (v_amount_uzs > tci.my_authority_uzs(v_band)
                        -- 0085: below the cover matrix's rank it is required too.
                        or tci.user_rank((select auth.uid()), 'credit') < tci.cover_required_rank(v_request.entity_id)) then 'required'
              else 'voluntary' end;
  if v_kind = 'voluntary' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say what you want a second opinion on' using errcode = 'P0001';
  end if;

  select s.authority_routing into v_routing from tci.workflow_settings s where s.id;
  v_rank := tci.user_rank((select auth.uid()), 'credit');
  v_level := tci.route_validation_level('credit', v_band, v_amount_uzs,
               v_kind = 'required' and v_routing = 'direct', p_request_id, null,
               -- 0085: never below the rank the cover matrix asks for.
               greatest(v_rank, tci.cover_required_rank(v_request.entity_id) - 1));
  if v_level is null then
    raise exception 'authority_level_missing: no authority level above yours can take this decision — ask the administrator to set up the levels'
      using errcode = 'P0001';
  end if;
  if v_kind = 'required' and v_routing = 'direct' then
    v_fyi := tci.skipped_rank_members('credit', v_rank, v_level, p_request_id, null);
  end if;

  insert into tci.limit_validations (
    id, chain_id, request_id, stream, kind, outcome, amount, currency_code,
    valid_from, valid_until, conditions, assessment_id, grade_band, amount_uzs, comment,
    proposed_by, validator_id, level_id)
  values (
    v_id, v_id, p_request_id, 'credit', v_kind, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, coalesce(p_conditions, '[]'::jsonb),
    p_assessment_id, v_band, v_amount_uzs, nullif(btrim(p_comment), ''),
    (select auth.uid()), null, v_level)
  returning * into v_row;

  update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

  perform tci.emit_level_validation_requested(v_row, v_fyi);
  return jsonb_build_object('result', 'on_validation', 'validation_id', v_row.id, 'kind', v_kind,
                            'grade_band', v_band, 'level_id', v_level,
                            'rank', (select l.rank from tci.authority_levels l where l.id = v_level));
end;
$function$;

CREATE OR REPLACE FUNCTION tci.try_auto_decision(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings   tci.workflow_settings%rowtype;
  v_request    tci.credit_limit_requests%rowtype;
  v_policy     tci.policies%rowtype;
  v_adt        tci.buyer_adt%rowtype;
  v_assessment tci.credit_assessments%rowtype;
  v_reasons    text[] := '{}';
  v_used       integer := 0;
  v_req_uzs    numeric;
  v_adt_uzs    numeric;
  v_rec_uzs    numeric;
  v_group      jsonb;
  v_snapshot   jsonb;
  v_decision   tci.credit_limit_decisions%rowtype;
  v_band       tci.grade_band;
begin
  perform tci.require_internal_call();
  select * into v_settings from tci.workflow_settings where id;
  if not v_settings.auto_decisions_enabled then
    return jsonb_build_object('result', 'disabled');      -- nothing recorded: the feature is off
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found or v_request.status <> 'submitted' then
    return jsonb_build_object('result', 'not_submitted');
  end if;

  select * into v_adt from tci.buyer_adt
   where entity_id = v_request.entity_id and status in ('active', 'suspended') for update;
  if not found then
    v_reasons := v_reasons || 'no_adt'::text;
  else
    -- A buyer whose facts moved since: suspend first, then judge.
    perform tci.recheck_buyer_adt(v_request.entity_id);
    select * into v_adt from tci.buyer_adt where id = v_adt.id;
    v_used := tci.adt_used(v_adt.id);
    if v_adt.status = 'suspended' then
      v_reasons := v_reasons || 'adt_suspended'::text;
    end if;
    if v_used >= v_adt.total_count then
      v_reasons := v_reasons || 'adt_exhausted'::text;
    end if;
  end if;

  if v_request.policy_id is null then
    v_reasons := v_reasons || 'no_policy'::text;
  else
    select * into v_policy from tci.policies where id = v_request.policy_id;
    if v_policy.status <> 'active' then
      v_reasons := v_reasons || 'policy_not_active'::text;
    end if;
  end if;

  v_req_uzs := tci.uzs_or_null(v_request.requested_amount, v_request.currency_code);
  if v_adt.id is not null then
    v_adt_uzs := tci.uzs_or_null(v_adt.max_amount, v_adt.currency_code);
    if v_req_uzs is null or v_adt_uzs is null then
      v_reasons := v_reasons || 'fx_missing'::text;
    elsif v_req_uzs > v_adt_uzs then
      v_reasons := v_reasons || 'above_adt_amount'::text;
    end if;
  end if;

  select * into v_assessment from tci.credit_assessments a
   where a.entity_id = v_request.entity_id order by a.created_at desc limit 1;
  if not found then
    v_reasons := v_reasons || 'no_rating'::text;
  else
    v_band := tci.grade_band_for_assessment(v_assessment.id);
    v_rec_uzs := tci.uzs_or_null(v_assessment.suggested_limit, v_assessment.limit_currency);
    -- 0073: a manual rating carries no recommended limit to stay under.
    if v_assessment.suggested_limit is null then
      v_reasons := v_reasons || 'no_recommended_limit'::text;
    elsif v_rec_uzs is null or v_req_uzs is null then
      v_reasons := v_reasons || 'fx_missing'::text;
    elsif v_rec_uzs < v_req_uzs then
      v_reasons := v_reasons || 'above_recommended'::text;
    end if;
  end if;

  v_reasons := v_reasons || tci.adt_buyer_stops(v_request.entity_id);

  if v_req_uzs is not null then
    v_group := tci.group_exposure_preflight(
      v_request.entity_id, v_request.requested_amount, v_request.currency_code,
      tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));
    if coalesce((v_group ->> 'over_limit')::boolean, false) then
      v_reasons := v_reasons || 'group_limit'::text;
    end if;
  end if;

  -- 0085: an auto decision needs open cover and ordinary authority — not a
  -- sanctioned party, not a country or sector the cover matrix restricts.
  if tci.cover_block_internal(v_request.entity_id) is not null
     or tci.cover_required_rank_internal(v_request.entity_id) > 0 then
    v_reasons := v_reasons || 'cover_restricted'::text;
  end if;

  -- One reason once, in the order found.
  select coalesce(array_agg(r order by first_pos), '{}') into v_reasons
    from (select r, min(o) as first_pos from unnest(v_reasons) with ordinality as u(r, o) group by r) x;

  v_snapshot := jsonb_build_object(
    'rating_grade', v_assessment.rating_grade, 'rating_score', v_assessment.rating_score,
    'grade_band', v_band, 'assessment_id', v_assessment.id,
    'recommended_limit', v_assessment.suggested_limit, 'recommended_currency', v_assessment.limit_currency,
    'requested_amount', v_request.requested_amount, 'requested_currency', v_request.currency_code,
    'adt_id', v_adt.id, 'adt_max_amount', v_adt.max_amount, 'adt_currency', v_adt.currency_code,
    'adt_total', v_adt.total_count, 'adt_used_before', v_used,
    'adt_remaining_before', case when v_adt.id is null then null else v_adt.total_count - v_used end,
    'group', v_group);

  if cardinality(v_reasons) > 0 then
    insert into tci.auto_decision_attempts (request_id, entity_id, policy_id, adt_id, decided, reasons, snapshot)
    values (p_request_id, v_request.entity_id, v_request.policy_id, v_adt.id, false, v_reasons, v_snapshot);
    return jsonb_build_object('result', 'to_underwriter', 'reasons', to_jsonb(v_reasons));
  end if;

  -- All conditions hold: the auto decision, released at once.
  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, valid_until,
    based_on_assessment_id, payment_terms_days, decided_by, system_generated, system_reason_key,
    released_at, release_kind, adt_id)
  values (
    p_request_id, 'approved', v_request.requested_amount, v_request.currency_code, current_date,
    (current_date + make_interval(months => v_settings.adt_limit_validity_months))::date,
    v_assessment.id, v_policy.max_payment_terms_days, null, true, 'limits.auto.adt',
    now(), 'immediate', v_adt.id)
  returning * into v_decision;

  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(v_request.policy_id, v_request.insurance_request_id)
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests set status = 'decided', decided_at = now() where id = p_request_id;

  insert into tci.auto_decision_attempts (request_id, entity_id, policy_id, adt_id, decided, decision_id, reasons, snapshot)
  values (p_request_id, v_request.entity_id, v_request.policy_id, v_adt.id, true, v_decision.id, '{}',
          v_snapshot || jsonb_build_object('adt_remaining_after', v_adt.total_count - v_used - 1));

  perform tci.emit_workflow_event('limit.auto_decided', 'credit_limit_decision', v_decision.id,
    jsonb_build_object('request_id', p_request_id, 'entity_id', v_request.entity_id,
                       'amount', v_request.requested_amount, 'currency', v_request.currency_code,
                       'adt_id', v_adt.id, 'remaining', v_adt.total_count - v_used - 1),
    'client'::tci.user_role);

  -- Used up: the credit desk reviews the buyer.
  if v_adt.total_count - v_used - 1 <= 0 then
    perform tci.emit_workflow_event('adt.exhausted', 'legal_entity', v_request.entity_id,
      jsonb_build_object('adt_id', v_adt.id), 'credit_underwriter'::tci.user_role);
  end if;

  return jsonb_build_object('result', 'auto_decided', 'decision_id', v_decision.id,
                            'remaining', v_adt.total_count - v_used - 1);
end;
$function$;

CREATE OR REPLACE FUNCTION tci.complete_task(p_task_id uuid)
 RETURNS tci.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_task tci.tasks%rowtype;
begin
  perform tci.require_staff();

  select * into v_task from tci.tasks t
   where t.id = p_task_id and tci.task_is_mine(t.target_role, t.target_user)
     for update;
  if not found then
    raise exception 'task % not found or not yours', p_task_id using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' then
    raise exception 'task is already %', v_task.status using errcode = 'P0001';
  end if;
  -- 0073: the proposer has read how their rating proposal ended.
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',
      'entity_request_resolved', 'limit_validation_result', 'limit_validation_fyi',
      'rating_proposal_result',
      -- 0085: a person decides when the buyers of a downgraded sector, or a
      -- limit on a sanctioned party, have been looked at.
      'sector_downgrade_review', 'sanctions_limit_review') then
    raise exception 'task type % closes itself when its object moves on', v_task.task_type
      using errcode = 'P0001';
  end if;

  update tci.tasks
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where id = p_task_id
   returning * into v_task;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION tci.refresh_agenda()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = '42501';
  end if;

  -- (1) Effective limits expiring within 30 days need a review decision.
  for v_row in
    select v.entity_id, v.policy_id, v.valid_until, v.approved_amount, v.currency_code
    from tci.v_effective_limits v
    where v.valid_until is not null
      and v.valid_until <= current_date + 30
      and v.outcome in ('approved', 'partial')
  loop
    perform tci.open_task(
      'limit_review_due', 'legal_entity', v_row.entity_id,
      'agenda.tasks.limit_review_due',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'policy_id', v_row.policy_id,
        'valid_until', v_row.valid_until,
        'amount', v_row.approved_amount,
        'currency', v_row.currency_code),
      'credit_underwriter'::tci.user_role, null,
      v_row.valid_until::timestamptz,
      case when v_row.valid_until <= current_date + 7 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'limit_review_due'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_effective_limits v
        where v.entity_id = t.object_id
          and v.valid_until is not null
          and v.valid_until <= current_date + 30
          and v.outcome in ('approved', 'partial')
     );

  -- (2) A company carrying an effective limit on a rating older than a year.
  for v_row in
    select distinct v.entity_id
    from tci.v_effective_limits v
    where v.outcome in ('approved', 'partial')
      and not exists (
        select 1 from tci.credit_assessments a
         where a.entity_id = v.entity_id
           and a.created_at > now() - interval '12 months'
      )
  loop
    perform tci.open_task(
      'rating_stale', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_stale',
      jsonb_build_object('entity_id', v_row.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'rating_stale'
     and t.status = 'open'
     and exists (
       select 1 from tci.credit_assessments a
        where a.entity_id = t.object_id
          and a.created_at > now() - interval '12 months'
     );

  -- (3) NEW: the declaration period that has CLOSED and has not been declared.
  -- Keyed on the policy, not on a declaration row, because the whole point is
  -- that the declaration does not exist yet.
  for v_row in
    select p.id as policy_id,
           p.policy_number,
           p.declaration_frequency,
           tci.declaration_period_start(
             (tci.declaration_period_start(current_date, p.declaration_frequency)
              - interval '1 day')::date,
             p.declaration_frequency) as period_start
    from tci.policies p
    where p.status = 'active'
      -- Only chase a period the policy was actually live for: a policy
      -- incepted this month owes nothing for last month.
      and tci.declaration_period_start(
            (tci.declaration_period_start(current_date, p.declaration_frequency)
             - interval '1 day')::date,
            p.declaration_frequency)
          >= tci.declaration_period_start(p.inception_date, p.declaration_frequency)
  loop
    if not exists (
      select 1 from tci.declarations d
       where d.policy_id = v_row.policy_id
         and d.period_start = v_row.period_start
         and d.status <> 'corrected'
    ) then
      perform tci.open_task(
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'declaration_overdue' else 'declaration_due' end::tci.task_type,
        'policy', v_row.policy_id,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'agenda.tasks.declaration_overdue' else 'agenda.tasks.declaration_due' end,
        jsonb_build_object(
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'period_start', v_row.period_start,
          'period_end', tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency)),
        'sales'::tci.user_role, null,
        (tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30)::timestamptz,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'high' else 'normal' end::tci.task_priority,
        null);
      v_opened := v_opened + 1;
    end if;
  end loop;

  -- Retire chasing tasks once the period HAS been declared, or the policy
  -- stopped being active.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('declaration_due', 'declaration_overdue')
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.declarations d
          where d.policy_id = t.object_id
            and d.period_start = (t.params->>'period_start')::date
            and d.status <> 'corrected'
       )
       or not exists (
         select 1 from tci.policies p where p.id = t.object_id and p.status = 'active'
       )
     );

  -- (4) instalments falling due, and instalments already past due. Since
  -- 0056 an instalment is owed while it has an OUTSTANDING amount, whatever
  -- its billing status, and the task carries what is still owed.
  for v_row in
    select vi.id, vi.policy_id, vi.sequence, vi.due_date, vi.outstanding, vi.amount,
           vi.invoice_number, p.policy_number, p.currency_code
    from tci.v_premium_instalments vi
    join tci.policies p on p.id = vi.policy_id
    where vi.derived_status <> 'cancelled'
      and vi.outstanding > 0
      and vi.due_date <= current_date + 14
  loop
    perform tci.open_task(
      case when v_row.due_date < current_date
           then 'instalment_overdue' else 'instalment_due' end::tci.task_type,
      'premium_instalment', v_row.id,
      case when v_row.due_date < current_date
           then 'agenda.tasks.instalment_overdue' else 'agenda.tasks.instalment_due' end,
      jsonb_build_object(
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'sequence', v_row.sequence,
        'due_date', v_row.due_date,
        'amount', v_row.outstanding,
        'scheduled', v_row.amount,
        'invoice_number', v_row.invoice_number,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- An open task follows what is still owed (a part payment lowers it).
  -- (The owed set is materialised once: the view's allocation is a window
  -- over each policy, which a per-task lookup would recompute.)
  with owed as materialized (
    select vi.id, vi.outstanding from tci.v_premium_instalments vi where vi.outstanding > 0
  )
  update tci.tasks t
     set params = t.params || jsonb_build_object('amount', owed.outstanding)
    from owed
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and owed.id = t.object_id
     and (t.params->>'amount')::numeric is distinct from owed.outstanding;

  with chased as materialized (
    select vi.id from tci.v_premium_instalments vi
     where vi.derived_status <> 'cancelled'
       and vi.outstanding > 0
       and vi.due_date <= current_date + 14
  )
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (select 1 from chased c where c.id = t.object_id);

  -- (5) NEW: an open overdue notification whose waiting period has run. The
  -- debt is now claimable, so the policyholder is told they may file and
  -- claims is told to expect it. Neither is a claim: only the policyholder
  -- decides that a debt is a loss.
  for v_row in
    select n.id, n.policy_id, n.entity_id, n.first_due_date, n.overdue_amount,
           n.currency_code, p.policy_number, p.waiting_period_days,
           (n.first_due_date + p.waiting_period_days) as claimable_from
    from tci.overdue_notifications n
    join tci.policies p on p.id = n.policy_id
    where n.status = 'open'
      and current_date >= n.first_due_date + p.waiting_period_days
      and not exists (
        select 1 from tci.claims c
         where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
  loop
    perform tci.open_task(
      'noa_matured_to_claim', 'overdue_notification', v_row.id,
      'agenda.tasks.noa_matured_to_claim',
      jsonb_build_object(
        'noa_id', v_row.id,
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'entity_id', v_row.entity_id,
        'amount', v_row.overdue_amount,
        'currency', v_row.currency_code,
        'claimable_from', v_row.claimable_from),
      'claims'::tci.user_role, null, v_row.claimable_from::timestamptz, 'normal', null);
    v_opened := v_opened + 1;

    -- Addressed to the individual portal users, never to the client role:
    -- every policyholder holds that role, so a role-targeted task would show
    -- them each other's files.
    for v_client in select tci.policyholder_user_ids(v_row.policy_id) loop
      perform tci.open_task(
        'claim_ready_to_file', 'overdue_notification', v_row.id,
        'agenda.tasks.claim_ready_to_file',
        jsonb_build_object(
          'noa_id', v_row.id,
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'entity_id', v_row.entity_id,
          'amount', v_row.overdue_amount,
          'currency', v_row.currency_code,
          'claimable_from', v_row.claimable_from),
        null, v_client, v_row.claimable_from::timestamptz, 'normal', null);
      v_opened := v_opened + 1;
    end loop;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('noa_matured_to_claim', 'claim_ready_to_file')
     and t.status = 'open'
     and not exists (
       select 1 from tci.overdue_notifications n
        where n.id = t.object_id
          and n.status = 'open'
          and not exists (
            select 1 from tci.claims c
             where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
     );

  -- (6) NEW: retire the reinstatement review once the buyer holds a live limit
  -- again, or the claim file is closed. The credit underwriter's decision IS
  -- the completion signal, so this type needs no button either.
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        join tci.v_effective_limits v
          on v.policy_id = c.policy_id and v.entity_id = c.entity_id
       where c.id = t.object_id
         and v.outcome in ('approved', 'partial')
     );
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        where c.id = t.object_id and c.status in ('closed', 'withdrawn')
     );

  -- (7) NEW (Phase 6): a group whose exposure has crossed the warning share of
  -- its group limit. Keyed on the ULTIMATE PARENT, which is the group's
  -- identity - there is no group record to key on.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           gl.max_amount, gl.currency_code,
           tci.to_uzs(gl.max_amount, gl.currency_code) as limit_uzs
      from tci.v_group_exposure ge
      join tci.group_limits gl
        on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
       and gl.valid_from <= current_date
       and (gl.valid_to is null or gl.valid_to >= current_date)
     where tci.to_uzs(gl.max_amount, gl.currency_code) > 0
       and ge.exposure_uzs
           >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
  loop
    perform tci.open_task(
      'group_exposure_near_limit', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_exposure_near_limit',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'exposure_uzs', v_row.exposure_uzs,
        'limit_uzs', v_row.limit_uzs,
        'utilisation_pct', round(v_row.exposure_uzs * 100 / v_row.limit_uzs, 1)),
      'credit_underwriter'::tci.user_role, null, null, 'high', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_exposure_near_limit'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_group_exposure ge
        join tci.group_limits gl
          on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
         and gl.valid_from <= current_date
         and (gl.valid_to is null or gl.valid_to >= current_date)
       where ge.ultimate_parent_id = t.object_id
         and tci.to_uzs(gl.max_amount, gl.currency_code) > 0
         and ge.exposure_uzs
             >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
     );

  -- (8) NEW (Phase 6): a group carrying limits with NO group limit set. Not an
  -- error - most single-company "groups" never need one - so it is only raised
  -- where the group actually has more than one member.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           ge.members_with_limits
      from tci.v_group_exposure ge
     where ge.members_with_limits > 1
       and not exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = ge.ultimate_parent_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
  loop
    perform tci.open_task(
      'group_limit_missing', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_limit_missing',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'members_with_limits', v_row.members_with_limits,
        'exposure_uzs', v_row.exposure_uzs),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_limit_missing'
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = t.object_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
       or not exists (
         select 1 from tci.v_group_exposure ge
          where ge.ultimate_parent_id = t.object_id and ge.members_with_limits > 1)
     );

  -- (9) 0055: new statements since the rating. A buyer with live credit
  -- business whose latest statements cover a LATER period than the ones its
  -- current rating was calculated on: the rating is a period behind. The
  -- params carry what the system note says — which statements, who added
  -- them and when, and what the current rating rests on.
  for v_row in
    select w.entity_id, w.assessment_id, w.grade, w.rated_at, w.rated_period_end,
           w.limits_in_force, ca.rating_score,
           fs.id as statement_id, fs.statement_kind, fs.fiscal_year, fs.fiscal_quarter,
           fs.period_end_date, fs.report_type, fs.created_by, fs.created_at
      from tci.v_rating_worklist w
      left join tci.credit_assessments ca on ca.id = w.assessment_id
      join lateral (
        select s.* from tci.financial_statements s
         where s.entity_id = w.entity_id
         order by s.period_end_date desc, s.created_at desc
         limit 1
      ) fs on true
     where w.reason = 'new_statement'
  loop
    perform tci.open_task(
      'rating_new_statements', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_new_statements',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'statement_id', v_row.statement_id,
        'statement_kind', v_row.statement_kind,
        'fiscal_year', v_row.fiscal_year,
        'fiscal_quarter', v_row.fiscal_quarter,
        'period_end', v_row.period_end_date,
        'report_type', v_row.report_type,
        'added_by', v_row.created_by,
        'added_at', v_row.created_at,
        'assessment_id', v_row.assessment_id,
        'grade', v_row.grade,
        'score', v_row.rating_score,
        'rated_at', v_row.rated_at,
        'rated_period_end', v_row.rated_period_end,
        'limits_in_force', v_row.limits_in_force),
      'credit_underwriter'::tci.user_role, null,
      -- The clock starts when the Agenda first sees the work, not when the
      -- statements were typed in: a backlog must not arrive months overdue.
      greatest(v_row.created_at, now()) + interval '7 days',
      case when v_row.limits_in_force > 0 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- Rated since (done), or no longer live business / statements removed
  -- (cancelled).
  update tci.tasks t
     set status = case when exists (
                          select 1 from tci.credit_assessments a
                           where a.entity_id = t.object_id and a.created_at >= t.created_at)
                       then 'done' else 'cancelled' end::tci.task_status,
         completed_at = now()
   where t.task_type = 'rating_new_statements'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_rating_worklist w
        where w.entity_id = t.object_id and w.reason = 'new_statement');

  -- (0058) Commercial offers close to, or past, their last valid day.
  v_opened := v_opened + tci.refresh_offer_tasks();
  v_opened := v_opened + tci.refresh_adt_tasks();
  -- (0085) The quarterly sector reviews; sanctions reviews of limits gone.
  v_opened := v_opened + tci.refresh_sector_tasks();
  perform tci.retire_sanction_tasks();

  return v_opened;
end;
$function$;

-- A sanctions review of a limit closes by itself once nothing is in force on
-- that request any more (revoked, superseded by a decline, expired).
create function tci.retire_sanction_tasks() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tci.require_staff_or_internal();
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'sanctions_limit_review' and t.status = 'open'
     and not exists (select 1 from tci.v_effective_limits v
                      where v.request_id = t.object_id and v.outcome in ('approved', 'partial'));
end $$;
revoke all on function tci.retire_sanction_tasks() from public, anon;
grant execute on function tci.retire_sanction_tasks() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Concentration of a policy or a submission
-- ---------------------------------------------------------------------------

-- The book of one policy (its in-force limits) or one submission (its
-- buyers with a company, at the amounts asked for), split by sector grade
-- and by country category, with the shares in C/D sectors and in categories
-- 5–7, the warning against workflow_settings.concentration_warn_pct, the
-- one-C/D-sector case, the parties without cover, and an exposure-weighted
-- premium loading HINT (never a price).
create function tci.cover_concentration(p_policy uuid default null, p_submission uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_warn numeric;
  v_out jsonb;
begin
  perform tci.require_staff();
  if (p_policy is null) = (p_submission is null) then
    raise exception 'concentration_scope: name a policy or a submission' using errcode = 'P0001';
  end if;
  select s.concentration_warn_pct into v_warn from tci.workflow_settings s where s.id;

  with buyers as (
    select v.entity_id, sum(tci.to_uzs(v.approved_amount, v.currency_code)) as amount_uzs
      from tci.v_effective_limits v
     where p_policy is not null and v.policy_id = p_policy and v.outcome in ('approved', 'partial')
     group by v.entity_id
    union all
    select b.entity_id, sum(tci.to_uzs(b.requested_amount, r.currency_code))
      from tci.insurance_request_buyers b
      join tci.insurance_requests r on r.id = b.request_id
     where p_submission is not null and b.request_id = p_submission and b.entity_id is not null
     group by b.entity_id
  ),
  rows as (
    select b.entity_id, coalesce(b.amount_uzs, 0) as amount_uzs, b.amount_uzs is null as rate_missing,
           coalesce(tci.entity_sector_grade(b.entity_id), 'none') as sector_grade,
           e.industry_id,
           -- the country part is silent until an OECD list exists or the
           -- country has an approved internal category, as in the cover matrix
           case when (tci.oecd_latest_import()).id is null
                     and not exists (select 1 from tci.country_risk_overrides o
                                      where o.country_code = e.country_code and o.status = 'approved')
                then 'inactive'
                else coalesce((select r.category::text from tci.country_risk(e.country_code) r), 'unclassified')
           end as country_key,
           tci.cover_block(b.entity_id) as block
      from buyers b join tci.legal_entities e on e.id = b.entity_id
  ),
  tot as (select coalesce(sum(amount_uzs), 0) as total, count(*) as n from rows)
  select jsonb_build_object(
    'buyers', (select n from tot),
    'total_uzs', (select total from tot),
    'rates_missing', (select count(*) from rows where rate_missing),
    'by_sector', coalesce((select jsonb_agg(jsonb_build_object('grade', g, 'buyers', n, 'amount_uzs', a) order by g)
                             from (select sector_grade g, count(*) n, sum(amount_uzs) a from rows group by sector_grade) x), '[]'::jsonb),
    'by_country', coalesce((select jsonb_agg(jsonb_build_object('category', k, 'buyers', n, 'amount_uzs', a) order by k)
                              from (select country_key k, count(*) n, sum(amount_uzs) a from rows group by country_key) x), '[]'::jsonb),
    'share_cd', case when (select total from tot) > 0
                     then round((select coalesce(sum(amount_uzs), 0) from rows where sector_grade in ('C', 'D')) / (select total from tot) * 100, 1) end,
    'share_cat57', case when (select total from tot) > 0
                        then round((select coalesce(sum(amount_uzs), 0) from rows where country_key in ('5', '6', '7')) / (select total from tot) * 100, 1) end,
    'warn_pct', v_warn,
    'single_cd_sector', (select count(*) > 0 and count(distinct industry_id) = 1 and bool_and(sector_grade in ('C', 'D')) from rows),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('entity_id', entity_id, 'block', block)) from rows where block is not null), '[]'::jsonb),
    'loading_hint_pct', case when (select total from tot) > 0 then round(
        (select sum(r.amount_uzs * (coalesce(s.premium_loading_pct, 0) + coalesce(c.premium_loading_pct, 0)))
           from rows r
           left join tci.risk_adjustment_settings s on s.dimension = 'sector' and s.key = r.sector_grade
           left join tci.risk_adjustment_settings c on c.dimension = 'country' and c.key = r.country_key)
        / (select total from tot), 1) end
  ) into v_out;

  return v_out || jsonb_build_object('warn',
    coalesce((v_out ->> 'share_cd')::numeric > v_warn or (v_out ->> 'share_cat57')::numeric > v_warn, false)
    or (v_out ->> 'single_cd_sector')::boolean);
end $$;
revoke all on function tci.cover_concentration(uuid, uuid) from public, anon;
grant execute on function tci.cover_concentration(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. The read side
-- ---------------------------------------------------------------------------

-- Every sector with its grade in force, the review state and the book in
-- it. Staff only (security_invoker over staff-read tables, and said again).
create view tci.v_sector_grades with (security_invoker = true) as
  with cur as (
    select distinct on (r.sector_id) r.*
      from tci.sector_reviews r
     where r.status = 'approved'
     order by r.sector_id, r.decided_at desc, r.created_at desc
  ),
  book as (
    select s.id as sector_id,
           count(distinct v.entity_id) as buyers_with_limits,
           sum(tci.to_uzs(v.approved_amount, v.currency_code)) as exposure_uzs,
           count(*) filter (where tci.to_uzs(v.approved_amount, v.currency_code) is null) as exposure_missing_rates
      from tci.v_effective_limits v
      join tci.legal_entities e on e.id = v.entity_id
      join tci.sectors s on s.industry_code = e.industry_id
     where v.outcome in ('approved', 'partial') and v.policy_id is not null
     group by s.id
  ),
  companies as (
    select s.id as sector_id, count(*) as companies
      from tci.legal_entities e join tci.sectors s on s.industry_code = e.industry_id
     group by s.id
  )
  select s.id as sector_id, s.industry_code, i.name_en, i.name_ru, i.name_uz,
         s.analyst_id,
         cur.id as review_id, cur.grade, cur.outlook, cur.kind, cur.decided_at as reviewed_at, cur.quarter_start,
         cur.id is not null and cur.quarter_start < tci.quarter_start(current_date) as stale,
         not exists (select 1 from tci.sector_reviews r
                      where r.sector_id = s.id and r.quarter_start = tci.quarter_start(current_date)
                        and r.status in ('approved', 'pending'))
           and current_date > tci.quarter_start(current_date)
                              + ((select w.sector_review_due_day from tci.workflow_settings w where w.id) - 1) as overdue,
         exists (select 1 from tci.sector_reviews r where r.sector_id = s.id and r.status = 'pending') as pending,
         coalesce(companies.companies, 0) as companies,
         coalesce(book.buyers_with_limits, 0) as buyers_with_limits,
         book.exposure_uzs,
         coalesce(book.exposure_missing_rates, 0) as exposure_missing_rates
    from tci.sectors s
    join tci.industries i on i.code = s.industry_code
    left join cur on cur.sector_id = s.id
    left join book on book.sector_id = s.id
    left join companies on companies.sector_id = s.id
   where tci.is_staff();
comment on view tci.v_sector_grades is
  'Prompt 31: each sector''s grade in force (latest approved review), stale (reviewed for an earlier quarter), overdue (no review of this quarter past the due day), pending (four-eyes), and the book in it (in-force limits on bound policies, UZS at the latest rate; missing rates counted, never zero). Staff only.';
grant select on tci.v_sector_grades to authenticated, service_role;

-- Every country with its OECD category, the internal override, the one in
-- use, and its sanctions state. Staff only.
create view tci.v_country_risk with (security_invoker = true) as
  with imp as (select * from tci.oecd_latest_import())
  select c.code as country_code, c.name_en, c.name_ru, c.name_uz,
         cl.category as oecd_category,
         case when cl.category is not null then imp.effective_date end as oecd_effective,
         o.category as internal_category, o.id as override_id,
         exists (select 1 from tci.country_risk_overrides p where p.country_code = c.code and p.status = 'pending') as override_pending,
         coalesce(o.category, cl.category) as category,
         case when o.id is not null then 'internal' when cl.category is not null then 'oecd' end as source,
         exists (select 1 from tci.sanction_flags f
                  where f.scope = 'country' and f.country_code = c.code
                    and f.lifted_at is null and f.effective_from <= current_date) as sanctioned,
         imp.effective_date as latest_import_effective,
         imp.imported_at as latest_import_at,
         imp.id is null
           or imp.effective_date < current_date - make_interval(months => (select w.oecd_stale_months from tci.workflow_settings w where w.id)) as import_stale
    from tci.countries c
    left join imp on true
    left join tci.country_risk_classifications cl on cl.import_id = imp.id and cl.country_code = c.code
    left join tci.country_risk_overrides o on o.country_code = c.code and o.status = 'approved'
   where tci.is_staff();
comment on view tci.v_country_risk is
  'Prompt 31: each country''s OECD category (latest import; absent = not classified, never 0), the approved internal override, the category decisions use (internal first), the sanctions state and whether the OECD list is older than workflow_settings.oecd_stale_months. Staff only.';
grant select on tci.v_country_risk to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Checks
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- No client reaches any of the new tables or views through a policy.
  select string_agg(tablename || ':' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'tci'
     and tablename in ('sectors', 'sector_reviews', 'country_risk_imports', 'country_risk_classifications',
                       'country_risk_overrides', 'sanction_flags', 'risk_adjustment_settings')
     and qual not like '%is_staff()%';
  if v_bad is not null then
    raise exception '0085: a risk table is readable beyond staff: %', v_bad;
  end if;
  -- No API role writes them directly.
  select string_agg(t, ', ') into v_bad
    from unnest(array['sectors', 'sector_reviews', 'country_risk_imports', 'country_risk_classifications',
                      'country_risk_overrides', 'sanction_flags', 'risk_adjustment_settings']) t
   where has_table_privilege('authenticated', 'tci.' || t, 'insert')
      or has_table_privilege('authenticated', 'tci.' || t, 'update')
      or has_table_privilege('authenticated', 'tci.' || t, 'delete');
  if v_bad is not null then
    raise exception '0085: authenticated may write %', v_bad;
  end if;
  -- The defaults of the cover matrix.
  if (select string_agg(key || '=' || rank_floor, ',' order by key) from tci.risk_adjustment_settings where dimension = 'country')
     <> '0=0,1=0,2=0,3=0,4=3,5=3,6=4,7=5,unclassified=5' then
    raise exception '0085: the cover matrix defaults moved';
  end if;
  if (select rank_add from tci.risk_adjustment_settings where dimension = 'sector' and key = 'D') <> 1 then
    raise exception '0085: a D sector must add one rank';
  end if;
  -- Every industry has its sector.
  if exists (select 1 from tci.industries i where not exists (select 1 from tci.sectors s where s.industry_code = i.code)) then
    raise exception '0085: an industry has no sector row';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Removal guards (an owner step on canonical, as 0057 section 10: the
--     tooling holds any statement naming the keyword). No API role holds
--     the privilege on these tables; this guards the owner too.
-- ---------------------------------------------------------------------------

create trigger sector_reviews_kept before delete on tci.sector_reviews
  for each row execute function tci.guard_sector_review();
create trigger country_risk_overrides_kept before delete on tci.country_risk_overrides
  for each row execute function tci.guard_country_override();
create trigger country_risk_imports_kept before delete on tci.country_risk_imports
  for each row execute function tci.guard_country_import();
create trigger country_risk_classifications_kept before delete on tci.country_risk_classifications
  for each row execute function tci.guard_country_import();
create trigger sanction_flags_kept before delete on tci.sanction_flags
  for each row execute function tci.guard_sanction_flag();
