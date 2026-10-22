-- What: contract drafts that are read and edited inside the app, with
--       immutable versions, a status machine and a review task.
--         * tci.contract_drafts              one draft per policy or submission
--                                            (CD-YYYY-NNNN): its status, its
--                                            current version, what is shared
--                                            with the client, the signed scan
--         * tci.contract_versions            APPEND-ONLY: every save is a new
--                                            row (content in the editor's JSON,
--                                            md5 hash, author, change note,
--                                            source generated / manual /
--                                            restored / refreshed, and the
--                                            merge data the DATABASE said at
--                                            that moment)
--         * tci.contract_draft_status_history, tci.contract_draft_comments
--                                            append-only as well
--         * the status machine               draft -> under_review -> agreed
--                                            -> signed; under_review and agreed
--                                            go back to draft (agreed only with
--                                            a reason); signed is final
--         * create_contract_draft / save_contract_version /
--           restore_contract_version / change_contract_status /
--           sign_contract_draft / share_contract_draft / add_contract_comment
--                                            the only writers, each gated
--         * v_client_contract_drafts, v_client_contract_comments,
--           client_comment_contract_draft    the policyholder reads the version
--                                            staff SHARED with it while the
--                                            draft is under review, agreed or
--                                            signed, and may comment while it
--                                            is under review - never edit
--         * storage bucket 'contract-scans'  private, PDF only, the signed scan
--         * task type contract_review        a SIXTH trigger on
--                                            tci.workflow_events opens it for
--                                            commercial underwriting when a
--                                            draft goes under review and closes
--                                            it when the draft leaves review
-- Why:  Prompt 25. A generated contract could only be downloaded; the owner
--       wants it viewed and edited online without the text leaving our
--       infrastructure. The editor runs in the browser (TipTap, open source,
--       lazy-loaded); what the database owns is the history: a version is
--       never overwritten, a restore is a new version, a signed contract is
--       locked forever, and every rule about who may move a draft where lives
--       here, not in the screen. Same discipline as limit decisions.
--
-- NOTHING IS OVERWRITTEN. authenticated holds no INSERT/UPDATE grant on the
-- three history tables (and no policy that would allow one); service_role
-- holds SELECT and INSERT only; a BEFORE UPDATE trigger refuses an in-place
-- change from anyone, the owner included. Section 10 adds the matching guard
-- against removing a row; it is kept apart so it can be applied on its own.
--
-- What is in a version's content is the editor's document (ProseMirror JSON:
-- doc, heading, paragraph, lists, table, pageBreak, mergeField chips carrying
-- the placeholder path and the value printed). Clause numbers are NOT stored:
-- a numbered section heading and a clause paragraph carry a flag, and the
-- number is derived wherever the document is rendered or exported.
--
-- Endorsements (a change to a SIGNED contract) are out of scope: a signed
-- draft is final, and a change will need a new draft as an endorsement.
--
-- Agenda catalogue row (read by catalogue.test.ts):
--
--   contract_review  commercial_underwriter  normal  AUTO contract.status_changed away from under_review

-- ---------------------------------------------------------------------------
-- 1. The new task type
-- ---------------------------------------------------------------------------
-- Added in its own statement; it is only referenced inside plpgsql bodies
-- below, never by this migration's own SQL, because a new enum value cannot
-- be used in the transaction that adds it.

alter type tci.task_type add value 'contract_review';

-- ---------------------------------------------------------------------------
-- 2. Types and the pure rules (mirrored by src/features/contracts/machine.ts)
-- ---------------------------------------------------------------------------

create type tci.contract_draft_status as enum ('draft', 'under_review', 'agreed', 'signed');
create type tci.contract_version_source as enum ('generated', 'manual', 'restored', 'refreshed');

-- Editing (a new version) is allowed in draft and under review only.
create function tci.contract_draft_editable(p_status tci.contract_draft_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_status in ('draft', 'under_review')
$$;

-- The status machine. 'signed' is reached only through sign_contract_draft,
-- which also records the scan; nothing leaves 'signed'.
create function tci.contract_transition_allowed(p_from tci.contract_draft_status, p_to tci.contract_draft_status)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (p_from::text || '>' || p_to::text) in (
    'draft>under_review',
    'under_review>draft',
    'under_review>agreed',
    'agreed>draft',
    'agreed>signed')
$$;

-- A version's content: an editor document of bounded size.
create function tci.contract_content_ok(p_content jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_content is not null
     and jsonb_typeof(p_content) = 'object'
     and p_content ->> 'type' = 'doc'
     and jsonb_typeof(p_content -> 'content') = 'array'
     and octet_length(p_content::text) <= 2000000
$$;

-- The document with every merge-field VALUE taken out: two versions with the
-- same skeleton differ only in what their fields print. A 'refreshed' version
-- must have its base version's skeleton - a field refresh never touches the
-- words around the fields.
create function tci.contract_skeleton(p jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_out jsonb;
  v_el  jsonb;
begin
  if p is null then
    return null;
  elsif jsonb_typeof(p) = 'array' then
    v_out := '[]'::jsonb;
    for v_el in select a.value from jsonb_array_elements(p) a loop
      v_out := v_out || jsonb_build_array(tci.contract_skeleton(v_el));
    end loop;
    return v_out;
  elsif jsonb_typeof(p) = 'object' then
    if p ->> 'type' = 'mergeField' then
      return p #- '{attrs,value}';
    end if;
    select coalesce(jsonb_object_agg(o.key, tci.contract_skeleton(o.value)), '{}'::jsonb)
      into v_out
      from jsonb_each(p) o;
    return v_out;
  end if;
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

create sequence tci.contract_draft_seq;

create table tci.contract_drafts (
  id                   uuid primary key default gen_random_uuid(),
  draft_number         text not null unique,
  policy_id            uuid references tci.policies (id),
  insurance_request_id uuid references tci.insurance_requests (id),
  -- the template the latest generation used
  template_id          uuid not null references tci.wording_templates (id),
  language             text not null,
  status               tci.contract_draft_status not null default 'draft',
  current_version_id   uuid,
  current_version_no   int not null default 0 check (current_version_no >= 0),
  -- the version the policyholder sees (NULL = not shared)
  shared_version_id    uuid,
  shared_at            timestamptz,
  shared_by            uuid references auth.users (id),
  -- the signed scan, attached to the version that was signed
  signed_version_id    uuid,
  signed_scan_path     text unique,
  signed_scan_name     text,
  signed_at            timestamptz,
  signed_by            uuid references auth.users (id),
  created_by           uuid not null references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint contract_drafts_one_target check ((policy_id is null) <> (insurance_request_id is null)),
  constraint contract_drafts_signed_shape check (
    (status = 'signed') = (signed_version_id is not null and signed_scan_path is not null and signed_at is not null))
);

comment on table tci.contract_drafts is
  'A draft contract edited in the app (0057): one per policy or submission. Current state only - versions, status history and comments are their own append-only tables. Written only through the contract functions of 0057.';

-- One draft per policy and one per submission. A signed draft is final; a
-- later change will be an endorsement (not built).
create unique index contract_drafts_target_uq
  on tci.contract_drafts ((coalesce(policy_id, insurance_request_id)));

create function tci.set_contract_draft_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.draft_number is null or new.draft_number = '' then
    new.draft_number := 'CD-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('tci.contract_draft_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger contract_drafts_number
  before insert on tci.contract_drafts
  for each row execute function tci.set_contract_draft_number();

create trigger contract_drafts_set_updated_at
  before update on tci.contract_drafts
  for each row execute function tci.set_updated_at();

create table tci.contract_versions (
  id                    uuid primary key default gen_random_uuid(),
  draft_id              uuid not null references tci.contract_drafts (id),
  version_no            int not null check (version_no >= 1),
  content               jsonb not null check (tci.contract_content_ok(content)),
  content_hash          text not null,
  source                tci.contract_version_source not null,
  restored_from_version int,
  -- generated: the template it came from
  template_id           uuid references tci.wording_templates (id),
  template_version      int,
  -- what tci.wording_merge_data() said when this version was saved (server-made)
  merge_data            jsonb,
  change_note           text check (change_note is null or char_length(change_note) <= 500),
  author_id             uuid not null references auth.users (id),
  created_at            timestamptz not null default now(),
  constraint contract_versions_no_uq unique (draft_id, version_no),
  constraint contract_versions_restored check ((source = 'restored') = (restored_from_version is not null)),
  constraint contract_versions_generated check (source <> 'generated' or template_id is not null)
);

comment on table tci.contract_versions is
  'Immutable versions of a contract draft (0057). Every save is a new row; a restore copies an old version into a new one; nothing is updated or removed.';

alter table tci.contract_drafts
  add constraint contract_drafts_current_fk foreign key (current_version_id) references tci.contract_versions (id),
  add constraint contract_drafts_shared_fk foreign key (shared_version_id) references tci.contract_versions (id),
  add constraint contract_drafts_signed_fk foreign key (signed_version_id) references tci.contract_versions (id);

create table tci.contract_draft_status_history (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references tci.contract_drafts (id),
  from_status tci.contract_draft_status,
  to_status   tci.contract_draft_status not null,
  -- the version the status applied to
  version_id  uuid not null references tci.contract_versions (id),
  comment     text,
  changed_by  uuid not null references auth.users (id),
  changed_at  timestamptz not null default now()
);

comment on table tci.contract_draft_status_history is
  'How a contract draft moved, and which version each status applied to (0057). Append-only.';

create index contract_draft_status_history_idx on tci.contract_draft_status_history (draft_id, changed_at);

create table tci.contract_draft_comments (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references tci.contract_drafts (id),
  version_id  uuid not null references tci.contract_versions (id),
  author_id   uuid not null references auth.users (id),
  -- staff = a reviewer or a colleague; client = the policyholder, from the portal
  author_side text not null check (author_side in ('staff', 'client')),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);

comment on table tci.contract_draft_comments is
  'Comments on a contract draft (0057): reviewers and the policyholder. Append-only; a correction is a new comment. A client reads only the client-side comments of its own drafts.';

create index contract_draft_comments_idx on tci.contract_draft_comments (draft_id, created_at);
create index contract_versions_draft_idx on tci.contract_versions (draft_id, version_no desc);

-- ---------------------------------------------------------------------------
-- 4. RLS and grants: staff read, nobody writes directly
-- ---------------------------------------------------------------------------

alter table tci.contract_drafts enable row level security;
alter table tci.contract_versions enable row level security;
alter table tci.contract_draft_status_history enable row level security;
alter table tci.contract_draft_comments enable row level security;

create policy "contract_drafts: staff read" on tci.contract_drafts
  for select to authenticated using (tci.is_staff());
create policy "contract_versions: staff read" on tci.contract_versions
  for select to authenticated using (tci.is_staff());
create policy "contract_draft_status_history: staff read" on tci.contract_draft_status_history
  for select to authenticated using (tci.is_staff());
create policy "contract_draft_comments: staff read" on tci.contract_draft_comments
  for select to authenticated using (tci.is_staff());

revoke all on tci.contract_drafts, tci.contract_versions,
              tci.contract_draft_status_history, tci.contract_draft_comments
  from public, anon, authenticated;
grant select on tci.contract_drafts, tci.contract_versions,
                tci.contract_draft_status_history, tci.contract_draft_comments
  to authenticated;
grant select, insert, update on tci.contract_drafts to service_role;
grant select, insert on tci.contract_versions, tci.contract_draft_status_history,
                        tci.contract_draft_comments to service_role;
grant usage on sequence tci.contract_draft_seq to service_role;

-- History is immutable: no in-place change by anyone, the owner included.
create function tci.refuse_contract_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'contract_history_immutable: contract versions, status history and comments are never changed in place'
    using errcode = '42501';
end;
$$;

create trigger contract_versions_immutable
  before update on tci.contract_versions
  for each row execute function tci.refuse_contract_history_change();
create trigger contract_draft_status_history_immutable
  before update on tci.contract_draft_status_history
  for each row execute function tci.refuse_contract_history_change();
create trigger contract_draft_comments_immutable
  before update on tci.contract_draft_comments
  for each row execute function tci.refuse_contract_history_change();

-- A signed draft is final: once signed, no column of it changes again.
create function tci.refuse_signed_contract_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'signed' then
    raise exception 'contract_signed_final: a signed contract is locked; a change needs an endorsement'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger contract_drafts_signed_final
  before update on tci.contract_drafts
  for each row execute function tci.refuse_signed_contract_change();

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------

-- Manual edits since the last generation: a manual or restored version after
-- the newest generated one. Regenerating over them needs confirmation.
-- SECURITY INVOKER: it reads versions under the caller's own row policies.
create function tci.contract_has_manual_edits(p_draft_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from tci.contract_versions v
     where v.draft_id = p_draft_id
       and v.source in ('manual', 'restored')
       and v.version_no > coalesce((select max(g.version_no) from tci.contract_versions g
                                     where g.draft_id = p_draft_id and g.source = 'generated'), 0))
$$;

-- The policy or submission number a draft is for, for events and tasks.
create function tci.contract_draft_reference(p_policy_id uuid, p_request_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select p.policy_number from tci.policies p where p.id = p_policy_id),
                  (select r.request_number from tci.insurance_requests r where r.id = p_request_id))
$$;

-- Inserts a version and moves the draft's pointer. Internal: callers check
-- the draft, the base version and the roles first. Not granted to anyone.
create function tci.append_contract_version(
  p_draft      tci.contract_drafts,
  p_content    jsonb,
  p_source     tci.contract_version_source,
  p_note       text,
  p_template   uuid,
  p_restored   int
)
returns tci.contract_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      tci.contract_versions%rowtype;
  v_template tci.wording_templates%rowtype;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  if not tci.contract_content_ok(p_content) then
    raise exception 'contract_content_invalid: a version must be an editor document of at most 2 MB'
      using errcode = 'P0001';
  end if;
  if p_template is not null then
    select * into v_template from tci.wording_templates where id = p_template;
  end if;

  insert into tci.contract_versions (
    draft_id, version_no, content, content_hash, source, restored_from_version,
    template_id, template_version, merge_data, change_note, author_id
  ) values (
    p_draft.id, p_draft.current_version_no + 1, p_content, md5(p_content::text), p_source, p_restored,
    p_template, v_template.version,
    tci.wording_merge_data(p_draft.policy_id, p_draft.insurance_request_id),
    nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid())
  ) returning * into v_row;

  update tci.contract_drafts
     set current_version_id = v_row.id, current_version_no = v_row.version_no
   where id = p_draft.id;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.version_saved', 'contract_draft', p_draft.id,
    jsonb_build_object('version_no', v_row.version_no, 'source', v_row.source,
                       'draft_number', p_draft.draft_number));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Writers (SECURITY DEFINER: authenticated holds no write grant)
-- ---------------------------------------------------------------------------

-- The first version of a draft, generated from an active template.
create function tci.create_contract_draft(
  p_policy_id   uuid,
  p_request_id  uuid,
  p_template_id uuid,
  p_content     jsonb,
  p_change_note text default null
)
returns tci.contract_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template tci.wording_templates%rowtype;
  v_draft    tci.contract_drafts%rowtype;
  v_status   text;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  if (p_policy_id is null) = (p_request_id is null) then
    raise exception 'name exactly one of a policy or a submission' using errcode = 'P0001';
  end if;
  if p_policy_id is not null then
    if not exists (select 1 from tci.policies p where p.id = p_policy_id) then
      raise exception 'policy not found' using errcode = 'P0002';
    end if;
  else
    select r.status::text into v_status from tci.insurance_requests r where r.id = p_request_id;
    if not found then
      raise exception 'submission not found' using errcode = 'P0002';
    end if;
    -- the same rule as src/features/wording/contracts.ts
    if v_status in ('draft', 'declined', 'withdrawn') then
      raise exception 'contract_target_not_live: no contract is drafted for a submission that is %', v_status
        using errcode = 'P0001';
    end if;
  end if;
  select * into v_template from tci.wording_templates where id = p_template_id;
  if not found then
    raise exception 'template not found' using errcode = 'P0002';
  end if;
  if v_template.status <> 'active' then
    raise exception 'wording_template_not_active: only an active template generates a document'
      using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('contract:' || coalesce(p_policy_id, p_request_id)::text));
  if exists (select 1 from tci.contract_drafts d
              where coalesce(d.policy_id, d.insurance_request_id) = coalesce(p_policy_id, p_request_id)) then
    raise exception 'contract_draft_exists: this policy or submission already has a draft contract; generate a new version of it'
      using errcode = 'P0001';
  end if;

  insert into tci.contract_drafts (policy_id, insurance_request_id, template_id, language, created_by)
  values (p_policy_id, p_request_id, p_template_id, v_template.language, (select auth.uid()))
  returning * into v_draft;

  perform tci.append_contract_version(v_draft, p_content, 'generated', p_change_note, p_template_id, null);

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.draft_created', 'contract_draft', v_draft.id,
    jsonb_build_object('draft_number', v_draft.draft_number, 'policy_id', p_policy_id,
                       'request_id', p_request_id, 'template_id', p_template_id,
                       'reference', tci.contract_draft_reference(p_policy_id, p_request_id)));

  select * into v_draft from tci.contract_drafts where id = v_draft.id;
  return v_draft;
end;
$$;

-- A new version: a manual save, a regeneration from a template, or a refresh
-- of the merge fields. p_base_version_no is the version the editor started
-- from; anything else means someone saved in the meantime.
create function tci.save_contract_version(
  p_draft_id         uuid,
  p_base_version_no  int,
  p_content          jsonb,
  p_source           text,
  p_change_note      text default null,
  p_template_id      uuid default null,
  p_confirm_replace  boolean default false
)
returns tci.contract_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft    tci.contract_drafts%rowtype;
  v_current  tci.contract_versions%rowtype;
  v_template tci.wording_templates%rowtype;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  select * into v_draft from tci.contract_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if not tci.contract_draft_editable(v_draft.status) then
    raise exception 'contract_not_editable: a draft can be edited in draft or under review, this one is %', v_draft.status
      using errcode = 'P0001';
  end if;
  if p_base_version_no is distinct from v_draft.current_version_no then
    raise exception 'contract_version_conflict: version % was saved since you started from version %',
      v_draft.current_version_no, p_base_version_no using errcode = 'P0001';
  end if;
  if p_source not in ('manual', 'generated', 'refreshed') then
    raise exception 'contract_source_invalid: a version is saved as manual, generated or refreshed (restore has its own function)'
      using errcode = 'P0001';
  end if;
  if not tci.contract_content_ok(p_content) then
    raise exception 'contract_content_invalid: a version must be an editor document of at most 2 MB'
      using errcode = 'P0001';
  end if;

  select * into v_current from tci.contract_versions where id = v_draft.current_version_id;
  if md5(p_content::text) = v_current.content_hash then
    raise exception 'contract_version_unchanged: the document is the same as version %', v_current.version_no
      using errcode = 'P0001';
  end if;

  if p_source = 'generated' then
    select * into v_template from tci.wording_templates where id = p_template_id;
    if not found then
      raise exception 'template not found' using errcode = 'P0002';
    end if;
    if v_template.status <> 'active' then
      raise exception 'wording_template_not_active: only an active template generates a document'
        using errcode = 'P0001';
    end if;
    if tci.contract_has_manual_edits(p_draft_id) and not coalesce(p_confirm_replace, false) then
      raise exception 'contract_manual_edits_unconfirmed: the current version has manual edits that a new generation would replace'
        using errcode = 'P0001';
    end if;
    update tci.contract_drafts
       set template_id = v_template.id, language = v_template.language
     where id = p_draft_id
     returning * into v_draft;
  elsif p_source = 'refreshed' then
    -- A field refresh changes what the fields print, never the words around them.
    if tci.contract_skeleton(p_content) is distinct from tci.contract_skeleton(v_current.content) then
      raise exception 'contract_refresh_changed_text: a field refresh may change merge-field values only'
        using errcode = 'P0001';
    end if;
  end if;

  return tci.append_contract_version(
    v_draft, p_content, p_source::tci.contract_version_source, p_change_note,
    case when p_source = 'generated' then p_template_id end, null);
end;
$$;

-- Restore = a NEW version carrying an old version's content. History is
-- never rewound. The content is copied here, not taken from the browser.
create function tci.restore_contract_version(
  p_draft_id        uuid,
  p_base_version_no int,
  p_version_no      int,
  p_change_note     text default null
)
returns tci.contract_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft tci.contract_drafts%rowtype;
  v_old   tci.contract_versions%rowtype;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  select * into v_draft from tci.contract_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if not tci.contract_draft_editable(v_draft.status) then
    raise exception 'contract_not_editable: a draft can be edited in draft or under review, this one is %', v_draft.status
      using errcode = 'P0001';
  end if;
  if p_base_version_no is distinct from v_draft.current_version_no then
    raise exception 'contract_version_conflict: version % was saved since you started from version %',
      v_draft.current_version_no, p_base_version_no using errcode = 'P0001';
  end if;
  select * into v_old from tci.contract_versions where draft_id = p_draft_id and version_no = p_version_no;
  if not found then
    raise exception 'contract version not found' using errcode = 'P0002';
  end if;
  if v_old.version_no = v_draft.current_version_no
     or v_old.content_hash = (select v.content_hash from tci.contract_versions v where v.id = v_draft.current_version_id) then
    raise exception 'contract_version_unchanged: the document is the same as version %', v_draft.current_version_no
      using errcode = 'P0001';
  end if;

  return tci.append_contract_version(
    v_draft, v_old.content, 'restored',
    coalesce(nullif(btrim(coalesce(p_change_note, '')), ''), null), null, v_old.version_no);
end;
$$;

-- Moves a draft along the machine. Signing has its own function (it needs
-- the scan). Agreeing a draft, and reopening an agreed one, is commercial
-- underwriting's (or an admin's); reopening an agreed draft needs a reason.
create function tci.change_contract_status(p_draft_id uuid, p_to text, p_comment text default null)
returns tci.contract_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft   tci.contract_drafts%rowtype;
  v_from    tci.contract_draft_status;
  v_to      tci.contract_draft_status;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  select * into v_draft from tci.contract_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if p_to not in ('draft', 'under_review', 'agreed', 'signed') then
    raise exception 'contract_transition_not_allowed: unknown status %', p_to using errcode = 'P0001';
  end if;
  v_from := v_draft.status;
  v_to := p_to::tci.contract_draft_status;
  if v_from = 'signed' then
    raise exception 'contract_signed_final: a signed contract is locked; a change needs an endorsement'
      using errcode = 'P0001';
  end if;
  if v_to = 'signed' then
    raise exception 'contract_sign_needs_scan: a contract is signed by attaching the signed scan'
      using errcode = 'P0001';
  end if;
  if not tci.contract_transition_allowed(v_from, v_to) then
    raise exception 'contract_transition_not_allowed: a draft cannot go from % to %', v_from, v_to
      using errcode = 'P0001';
  end if;
  if (v_to = 'agreed' or v_from = 'agreed') and not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may agree a contract or reopen an agreed one'
      using errcode = '42501';
  end if;
  if v_from = 'agreed' and v_to = 'draft' and v_comment is null then
    raise exception 'contract_reason_required: reopening an agreed contract needs a reason'
      using errcode = 'P0001';
  end if;

  update tci.contract_drafts set status = v_to where id = p_draft_id returning * into v_draft;
  insert into tci.contract_draft_status_history (draft_id, from_status, to_status, version_id, comment, changed_by)
  values (p_draft_id, v_from, v_to, v_draft.current_version_id, v_comment, (select auth.uid()));

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.status_changed', 'contract_draft', p_draft_id,
    jsonb_build_object('from', v_from, 'to', v_to, 'comment', v_comment,
                       'version_no', v_draft.current_version_no, 'draft_number', v_draft.draft_number,
                       'policy_id', v_draft.policy_id, 'request_id', v_draft.insurance_request_id,
                       'reference', tci.contract_draft_reference(v_draft.policy_id, v_draft.insurance_request_id)),
    case when v_to = 'under_review' then 'commercial_underwriter'::tci.user_role end);
  return v_draft;
end;
$$;

-- Agreed -> signed, with the signed scan already in Storage at
-- contract-scans/<draft id>/<file>.pdf, uploaded by the caller.
create function tci.sign_contract_draft(
  p_draft_id     uuid,
  p_version_no   int,
  p_storage_path text,
  p_file_name    text
)
returns tci.contract_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft  tci.contract_drafts%rowtype;
  v_owner  text;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  select * into v_draft from tci.contract_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if v_draft.status = 'signed' then
    raise exception 'contract_signed_final: a signed contract is locked; a change needs an endorsement'
      using errcode = 'P0001';
  end if;
  if v_draft.status <> 'agreed' then
    raise exception 'contract_transition_not_allowed: a draft cannot go from % to signed', v_draft.status
      using errcode = 'P0001';
  end if;
  if p_version_no is distinct from v_draft.current_version_no then
    raise exception 'contract_version_conflict: version % was saved since you started from version %',
      v_draft.current_version_no, p_version_no using errcode = 'P0001';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^' || p_draft_id::text || '/[^/]+\.pdf$')
     or coalesce(btrim(p_file_name), '') = '' then
    raise exception 'contract_scan_invalid_path: the signed scan is a PDF stored at <draft>/<file>.pdf'
      using errcode = 'P0001';
  end if;
  select o.owner_id into v_owner
    from storage.objects o where o.bucket_id = 'contract-scans' and o.name = p_storage_path;
  if not found then
    raise exception 'contract_scan_missing: the signed scan was not found in storage' using errcode = 'P0002';
  end if;
  if v_owner is distinct from (select auth.uid())::text then
    raise exception 'only the uploader may attach a signed scan' using errcode = '42501';
  end if;

  update tci.contract_drafts
     set status = 'signed', signed_version_id = current_version_id, signed_scan_path = p_storage_path,
         signed_scan_name = btrim(p_file_name), signed_at = now(), signed_by = (select auth.uid())
   where id = p_draft_id
   returning * into v_draft;
  insert into tci.contract_draft_status_history (draft_id, from_status, to_status, version_id, comment, changed_by)
  values (p_draft_id, 'agreed', 'signed', v_draft.current_version_id, null, (select auth.uid()));

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.status_changed', 'contract_draft', p_draft_id,
    jsonb_build_object('from', 'agreed', 'to', 'signed', 'version_no', v_draft.current_version_no,
                       'draft_number', v_draft.draft_number, 'policy_id', v_draft.policy_id,
                       'request_id', v_draft.insurance_request_id,
                       'reference', tci.contract_draft_reference(v_draft.policy_id, v_draft.insurance_request_id)));
  return v_draft;
end;
$$;

-- Shares the CURRENT version with the policyholder (or stops sharing). A
-- later save does not move what the client sees until it is shared again.
create function tci.share_contract_draft(p_draft_id uuid, p_share boolean)
returns tci.contract_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft tci.contract_drafts%rowtype;
begin
  perform tci.require_role('admin', 'commercial_underwriter', 'sales');
  select * into v_draft from tci.contract_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if coalesce(p_share, false) and v_draft.status not in ('under_review', 'agreed') then
    raise exception 'contract_share_not_allowed: a draft is shared with the policyholder once it is under review'
      using errcode = 'P0001';
  end if;

  if coalesce(p_share, false) then
    update tci.contract_drafts
       set shared_version_id = current_version_id, shared_at = now(), shared_by = (select auth.uid())
     where id = p_draft_id
     returning * into v_draft;
  else
    update tci.contract_drafts
       set shared_version_id = null, shared_at = null, shared_by = null
     where id = p_draft_id
     returning * into v_draft;
  end if;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.shared', 'contract_draft', p_draft_id,
    jsonb_build_object('shared', coalesce(p_share, false), 'version_no', v_draft.current_version_no,
                       'draft_number', v_draft.draft_number));
  return v_draft;
end;
$$;

-- A reviewer's (or any colleague's) comment on the current version.
create function tci.add_contract_comment(p_draft_id uuid, p_body text)
returns tci.contract_draft_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft   tci.contract_drafts%rowtype;
  v_comment tci.contract_draft_comments%rowtype;
begin
  perform tci.require_staff();
  select * into v_draft from tci.contract_drafts where id = p_draft_id;
  if not found then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'contract_comment_empty' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_body)) > 2000 then
    raise exception 'contract_comment_too_long' using errcode = 'P0001';
  end if;

  insert into tci.contract_draft_comments (draft_id, version_id, author_id, author_side, body)
  values (p_draft_id, v_draft.current_version_id, (select auth.uid()), 'staff', btrim(p_body))
  returning * into v_comment;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.commented', 'contract_draft', p_draft_id,
    jsonb_build_object('comment_id', v_comment.id, 'draft_number', v_draft.draft_number));
  return v_comment;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The client portal: read the shared version, comment while under review
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER views over BASE tables only (0030: a client view must not
-- read through a security_invoker view), each carrying its own client gate.

create view tci.v_client_contract_drafts as
select
  d.id,
  d.draft_number,
  d.policy_id,
  d.insurance_request_id,
  coalesce(p.policy_number, r.request_number) as reference,
  d.status,
  d.language,
  v.version_no,
  v.content,
  v.created_at as version_created_at,
  d.shared_at,
  d.signed_at
from tci.contract_drafts d
join tci.contract_versions v on v.id = d.shared_version_id
left join tci.policies p on p.id = d.policy_id
left join tci.insurance_requests r on r.id = d.insurance_request_id
where tci.has_role('client')
  and d.status in ('under_review', 'agreed', 'signed')
  and coalesce(p.entity_id, r.entity_id) in (select tci.my_client_entities());

comment on view tci.v_client_contract_drafts is
  'A policyholder''s shared contract drafts (0057): the SHARED version only, while under review, agreed or signed. No author, no internal comment, no merge-data snapshot.';

create view tci.v_client_contract_comments as
select
  c.id,
  c.draft_id,
  v.version_no,
  c.body,
  c.created_at,
  c.author_id = (select auth.uid()) as mine
from tci.contract_draft_comments c
join tci.contract_versions v on v.id = c.version_id
join tci.contract_drafts d on d.id = c.draft_id
left join tci.policies p on p.id = d.policy_id
left join tci.insurance_requests r on r.id = d.insurance_request_id
where tci.has_role('client')
  and c.author_side = 'client'
  and d.shared_version_id is not null
  and d.status in ('under_review', 'agreed', 'signed')
  and coalesce(p.entity_id, r.entity_id) in (select tci.my_client_entities());

comment on view tci.v_client_contract_comments is
  'The policyholder''s own side of the conversation on a shared draft (0057). Staff comments are internal and never shown.';

revoke all on tci.v_client_contract_drafts, tci.v_client_contract_comments from public, anon;
grant select on tci.v_client_contract_drafts, tci.v_client_contract_comments to authenticated, service_role;

create function tci.client_comment_contract_draft(p_draft_id uuid, p_body text)
returns tci.contract_draft_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft   tci.contract_drafts%rowtype;
  v_entity  uuid;
  v_comment tci.contract_draft_comments%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'only a portal user may comment on a shared contract this way' using errcode = '42501';
  end if;
  select d.* into v_draft from tci.contract_drafts d where d.id = p_draft_id;
  v_entity := coalesce((select p.entity_id from tci.policies p where p.id = v_draft.policy_id),
                       (select r.entity_id from tci.insurance_requests r where r.id = v_draft.insurance_request_id));
  if v_draft.id is null or v_draft.shared_version_id is null
     or v_draft.status not in ('under_review', 'agreed', 'signed')
     or v_entity is null or v_entity not in (select tci.my_client_entities()) then
    raise exception 'contract draft not found' using errcode = 'P0002';
  end if;
  if v_draft.status <> 'under_review' then
    raise exception 'contract_comment_closed: comments are taken while the draft is under review'
      using errcode = 'P0001';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'contract_comment_empty' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_body)) > 2000 then
    raise exception 'contract_comment_too_long' using errcode = 'P0001';
  end if;

  insert into tci.contract_draft_comments (draft_id, version_id, author_id, author_side, body)
  values (p_draft_id, v_draft.shared_version_id, (select auth.uid()), 'client', btrim(p_body))
  returning * into v_comment;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event('contract.client_commented', 'contract_draft', p_draft_id,
    jsonb_build_object('comment_id', v_comment.id, 'draft_number', v_draft.draft_number,
                       'body', v_comment.body),
    'commercial_underwriter'::tci.user_role);
  return v_comment;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The Agenda mapping - a SIXTH trigger on tci.workflow_events
-- ---------------------------------------------------------------------------

create function tci.handle_contract_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_type <> 'contract_draft'
     or new.event_type not in ('contract.status_changed', 'contract.client_commented') then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'contract.status_changed' then
    if new.payload ->> 'from' = 'under_review' then
      perform tci.close_tasks(array['contract_review']::tci.task_type[], new.object_id, 'done');
    end if;
    if new.payload ->> 'to' = 'under_review' then
      perform tci.open_task(
        'contract_review', 'contract_draft', new.object_id,
        'agenda.tasks.contract_review',
        jsonb_build_object('draft_number', new.payload ->> 'draft_number',
                           'reference', new.payload ->> 'reference',
                           -- the Agenda names a policy or a submission by these
                           'policy_number', case when new.payload ->> 'policy_id' is not null
                                                 then new.payload ->> 'reference' end,
                           'request_number', case when new.payload ->> 'request_id' is not null
                                                  then new.payload ->> 'reference' end,
                           'policy_id', new.payload ->> 'policy_id',
                           'request_id', new.payload ->> 'request_id',
                           'version_no', (new.payload ->> 'version_no')::int,
                           'comment', new.payload ->> 'comment'),
        'commercial_underwriter'::tci.user_role, null,
        now() + interval '2 days', 'normal', new.id);
    end if;

  elsif new.event_type = 'contract.client_commented' then
    -- The policyholder's latest word rides on the review task, where the
    -- Agenda shows it as the origin comment.
    update tci.tasks t
       set params = t.params || jsonb_build_object('client_comment', new.payload ->> 'body')
     where t.object_id = new.object_id
       and t.task_type = 'contract_review'
       and t.status = 'open';
  end if;
  return null;
end;
$$;

create trigger workflow_events_to_contract_tasks
  after insert on tci.workflow_events
  for each row execute function tci.handle_contract_event();

comment on function tci.handle_contract_event() is
  'Agenda mapping for contract drafts (0057): opens contract_review for commercial underwriting when a draft goes under review, closes it when the draft leaves review, and carries the policyholder''s latest comment on it.';

-- ---------------------------------------------------------------------------
-- 9. Storage: the signed scan - private, PDF only, never replaced
-- ---------------------------------------------------------------------------

-- A new bucket (the closing assertion checks it is private).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-scans', 'contract-scans', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy "contract scans: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'contract-scans' and tci.is_staff());

-- Only while the draft is AGREED, only under its own folder.
create policy "contract scans: upload for an agreed draft" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contract-scans'
    and tci.has_role('admin', 'commercial_underwriter', 'sales')
    and name ~* '^[0-9a-f-]{36}/[^/]+\.pdf$'
    and exists (select 1 from tci.contract_drafts d
                 where d.id::text = split_part(name, '/', 1) and d.status = 'agreed'));

-- ---------------------------------------------------------------------------
-- Grants: every new function revokes PUBLIC and anon explicitly
-- ---------------------------------------------------------------------------

revoke all on function tci.contract_draft_editable(tci.contract_draft_status) from public, anon;
revoke all on function tci.contract_transition_allowed(tci.contract_draft_status, tci.contract_draft_status) from public, anon;
revoke all on function tci.contract_content_ok(jsonb) from public, anon;
revoke all on function tci.contract_skeleton(jsonb) from public, anon;
revoke all on function tci.contract_has_manual_edits(uuid) from public, anon;
revoke all on function tci.contract_draft_reference(uuid, uuid) from public, anon;
revoke all on function tci.create_contract_draft(uuid, uuid, uuid, jsonb, text) from public, anon;
revoke all on function tci.save_contract_version(uuid, int, jsonb, text, text, uuid, boolean) from public, anon;
revoke all on function tci.restore_contract_version(uuid, int, int, text) from public, anon;
revoke all on function tci.change_contract_status(uuid, text, text) from public, anon;
revoke all on function tci.sign_contract_draft(uuid, int, text, text) from public, anon;
revoke all on function tci.share_contract_draft(uuid, boolean) from public, anon;
revoke all on function tci.add_contract_comment(uuid, text) from public, anon;
revoke all on function tci.client_comment_contract_draft(uuid, text) from public, anon;
-- internal and trigger functions: no API role at all
revoke all on function tci.append_contract_version(tci.contract_drafts, jsonb, tci.contract_version_source, text, uuid, int)
  from public, anon, authenticated;
revoke all on function tci.set_contract_draft_number() from public, anon, authenticated;
revoke all on function tci.refuse_contract_history_change() from public, anon, authenticated;
revoke all on function tci.refuse_signed_contract_change() from public, anon, authenticated;
revoke all on function tci.handle_contract_event() from public, anon, authenticated;

grant execute on function tci.contract_draft_editable(tci.contract_draft_status) to authenticated, service_role;
grant execute on function tci.contract_transition_allowed(tci.contract_draft_status, tci.contract_draft_status) to authenticated, service_role;
grant execute on function tci.contract_content_ok(jsonb) to authenticated, service_role;
grant execute on function tci.contract_skeleton(jsonb) to authenticated, service_role;
grant execute on function tci.contract_has_manual_edits(uuid) to authenticated, service_role;
grant execute on function tci.contract_draft_reference(uuid, uuid) to authenticated, service_role;
grant execute on function tci.create_contract_draft(uuid, uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function tci.save_contract_version(uuid, int, jsonb, text, text, uuid, boolean) to authenticated, service_role;
grant execute on function tci.restore_contract_version(uuid, int, int, text) to authenticated, service_role;
grant execute on function tci.change_contract_status(uuid, text, text) to authenticated, service_role;
grant execute on function tci.sign_contract_draft(uuid, int, text, text) to authenticated, service_role;
grant execute on function tci.share_contract_draft(uuid, boolean) to authenticated, service_role;
grant execute on function tci.add_contract_comment(uuid, text) to authenticated, service_role;
grant execute on function tci.client_comment_contract_draft(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- the API writes none of the four tables directly, on any column
  select string_agg(t, ', ') into v_bad
    from unnest(array['tci.contract_drafts', 'tci.contract_versions',
                      'tci.contract_draft_status_history', 'tci.contract_draft_comments']) t
   where has_any_column_privilege('authenticated', t, 'INSERT')
      or has_any_column_privilege('authenticated', t, 'UPDATE')
      or has_any_column_privilege('anon', t, 'SELECT');
  if v_bad is not null then
    raise exception '0057: the API can write or anon can read: %', v_bad;
  end if;
  if has_any_column_privilege('service_role', 'tci.contract_versions', 'UPDATE') then
    raise exception '0057: service_role must not update a contract version';
  end if;

  -- history is immutable in place, for everyone
  select string_agg(t, ', ') into v_bad
    from unnest(array['contract_versions_immutable', 'contract_draft_status_history_immutable',
                      'contract_draft_comments_immutable', 'contract_drafts_signed_final']) t
   where not exists (select 1 from pg_trigger g where g.tgname = t);
  if v_bad is not null then
    raise exception '0057: missing immutability trigger(s): %', v_bad;
  end if;

  -- every definer function executable by authenticated opens with its gate
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('create_contract_draft', 'save_contract_version', 'restore_contract_version',
                       'change_contract_status', 'sign_contract_draft', 'share_contract_draft',
                       'add_contract_comment', 'append_contract_version')
     and p.prosrc !~ '^\s*declare[\s\S]*?begin\s+perform tci\.require_(role|staff)\(';
  if v_bad is not null then
    raise exception '0057: ungated definer function(s): %', v_bad;
  end if;
  if (select prosrc from pg_proc where oid = 'tci.client_comment_contract_draft(uuid, text)'::regprocedure)
     !~ '^\s*declare[\s\S]*?begin\s+if not tci\.has_role\(''client''\)' then
    raise exception '0057: client_comment_contract_draft must open with its client gate';
  end if;

  -- the internal writer and the trigger functions are closed to the API
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace
     and p.proname in ('append_contract_version', 'set_contract_draft_number', 'refuse_contract_history_change',
                       'refuse_signed_contract_change', 'handle_contract_event')
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0057: authenticated can execute internal function(s): %', v_bad;
  end if;

  -- nothing new is reachable by anon
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0057: anon can execute: %', v_bad;
  end if;

  -- the client views are definer views (they read base tables as the owner)
  if exists (select 1 from pg_class c where c.relnamespace = 'tci'::regnamespace
              and c.relname in ('v_client_contract_drafts', 'v_client_contract_comments')
              and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))) then
    raise exception '0057: the client contract views must not be security_invoker';
  end if;

  -- the machine: exactly the five edges, nothing out of signed
  if not tci.contract_transition_allowed('agreed', 'signed')
     or tci.contract_transition_allowed('signed', 'draft')
     or tci.contract_transition_allowed('draft', 'agreed')
     or tci.contract_draft_editable('agreed') or tci.contract_draft_editable('signed')
     or not tci.contract_draft_editable('under_review') then
    raise exception '0057: the contract status machine is not the documented one';
  end if;

  -- a field refresh is judged without the field values
  if tci.contract_skeleton('{"type":"doc","content":[{"type":"mergeField","attrs":{"path":"policy.number","value":"A"}}]}')
     is distinct from
     tci.contract_skeleton('{"type":"doc","content":[{"type":"mergeField","attrs":{"path":"policy.number","value":"B"}}]}') then
    raise exception '0057: contract_skeleton must ignore merge-field values';
  end if;

  if exists (select 1 from storage.buckets where id = 'contract-scans' and public) then
    raise exception '0057: the contract-scans bucket must be private';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. OWNER SCRIPT: the removal guard on the history tables
-- ---------------------------------------------------------------------------
-- Kept apart: the canonical tooling holds any statement naming row removal.
-- The grants already refuse it to every API role (authenticated and
-- service_role hold no such privilege); these triggers refuse it to the
-- owner as well, as task_comments does (0055).

create trigger contract_versions_no_removal
  before delete on tci.contract_versions
  for each row execute function tci.refuse_contract_history_change();
create trigger contract_draft_status_history_no_removal
  before delete on tci.contract_draft_status_history
  for each row execute function tci.refuse_contract_history_change();
create trigger contract_draft_comments_no_removal
  before delete on tci.contract_draft_comments
  for each row execute function tci.refuse_contract_history_change();
