-- =====================================================================
-- TCI ERP — interim user provisioning by hand
-- =====================================================================
--
-- WHAT: three snippets to run in the Supabase SQL editor of the canonical
--       project (tci_erp, ref reunqrpeumokqgarknge):
--
--         1. CREATE a user  (staff or client)
--         2. RESET a user's password
--         3. DISABLE / ENABLE a user
--
-- WHY:  the normal path is the provisioning API in `services/analytics`,
--       which is the only holder of SUPABASE_SERVICE_ROLE_KEY. That service
--       is not hosted yet, so the admin screens show «Сервис подготовки
--       пользователей недоступен» and no user can be created through the
--       UI. These snippets are the stand-in until it is deployed. They
--       write exactly the same rows the service writes — see
--       `services/analytics/app/users.py`.
--
-- WHO:  the project owner, in the SQL editor, which runs as `postgres`.
--       That role owns these tables, so RLS does not apply and no policy
--       here is being bypassed by accident — it simply is not in play.
--
-- ---------------------------------------------------------------------
-- READ BEFORE RUNNING
-- ---------------------------------------------------------------------
--
-- * These write directly into `auth.users` and `auth.identities`, which
--   GoTrue owns. The column values below were taken from a row GoTrue
--   itself created in this project, not from documentation. If Supabase
--   changes the auth schema, re-check them before trusting this file.
--
-- * The empty strings on the token columns are deliberate. GoTrue stores
--   '' there, never NULL, and some versions fail to scan a NULL into a
--   Go string on sign-in. Do not "tidy" them to NULL.
--
-- * `auth.identities.email` is GENERATED ALWAYS from identity_data.
--   Inserting it explicitly is an error. It is absent below on purpose.
--
-- * Every user created here starts with must_change_password = true, so
--   the password you type is temporary by construction: the app forces a
--   rotation before it will show any screen (`RequirePasswordChange`).
--
-- * Passwords: pick one of at least 16 characters, or generate one with
--   snippet 0. Hand it over out of band. It is never stored in plain text
--   — only the bcrypt hash is written.
--
-- * A client user is only useful once the portal can actually serve them.
--   See "PORTAL READINESS" at the bottom of this file.
--
-- =====================================================================


-- =====================================================================
-- 0. OPTIONAL — generate a temporary password
-- =====================================================================
--
-- Run this on its own, copy the result, paste it into `p_password` below.
-- 20 characters, mixed classes, no look-alike glyphs (no O/0, l/1/I) —
-- these get read off a screen and typed by hand.
--
-- This mirrors the INTENT of `generate_temp_password()` in
-- `services/analytics/app/provisioning_rules.py`. It is a separate
-- implementation, so treat it as a convenience, not as that function.

select string_agg(
         substr('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+?',
                1 + floor(random() * 68)::int, 1),
         '')
  from generate_series(1, 20);


-- =====================================================================
-- 1. CREATE A USER
-- =====================================================================
--
-- Edit the five values in the `EDIT ME` block, then run the whole thing.
-- It is a single DO block, so it is atomic: any refusal below rolls the
-- entire user back, and you never end up with an auth user that has no
-- roles (the failure mode the service unwinds by hand).
--
-- Roles (tci.user_role): admin, sales, commercial_underwriter,
--                        credit_underwriter, claims, information_manager,
--                        client
-- A user may hold SEVERAL roles — access is the union. Pass them as an
-- array. `client` is the exception: it must be alone and it must name a
-- company, exactly as `authorize_create` / `requires_entity` enforce in
-- the service.

do $$
declare
  -- ------------------------- EDIT ME -------------------------------
  p_email       text   := 'person@example.com';
  p_password    text   := 'CHANGE-ME-at-least-16-chars';
  p_full_name   text   := 'Familiya Ism';
  p_roles       text[] := array['sales'];          -- one or more roles
  p_entity_id   uuid   := null;                    -- client users ONLY:
                                                   -- tci.legal_entities.id
  -- Who is recorded as having created this user. Must be an existing
  -- auth user — your own admin account. `auth.uid()` is NULL in the SQL
  -- editor, and policyholder_users.created_by is NOT NULL, so this
  -- cannot be left to the column default.
  p_created_by  uuid   := null;                    -- e.g. your admin id
  -- ----------------------- END EDIT ME -----------------------------

  v_user_id  uuid := gen_random_uuid();
  v_email    text := lower(btrim(p_email));
  v_is_client boolean;
  v_role     text;
begin
  -- ---- validate ---------------------------------------------------
  if v_email = '' or v_email not like '%@%' then
    raise exception 'p_email does not look like an address: %', p_email;
  end if;

  if length(p_password) < 16 then
    raise exception 'temporary passwords must be at least 16 characters (got %)',
                    length(p_password);
  end if;

  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'at least one role is required';
  end if;

  foreach v_role in array p_roles loop
    if not exists (
      select 1 from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'user_role'
         and t.typnamespace = 'tci'::regnamespace
         and e.enumlabel = v_role
    ) then
      raise exception 'unknown role: %', v_role;
    end if;
  end loop;

  v_is_client := 'client' = any(p_roles);

  -- A client is an external portal user. Mixing that with a staff role
  -- would put one person on both sides of the RLS boundary.
  if v_is_client and cardinality(p_roles) > 1 then
    raise exception 'the client role must be held alone, got %', p_roles;
  end if;

  if v_is_client and p_entity_id is null then
    raise exception 'a client user needs p_entity_id (the company they belong to)';
  end if;

  if not v_is_client and p_entity_id is not null then
    raise exception 'only a client user belongs to a company; clear p_entity_id';
  end if;

  if p_entity_id is not null
     and not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'no such company: %', p_entity_id;
  end if;

  if p_created_by is null then
    raise exception 'set p_created_by to your own auth user id';
  end if;

  if not exists (select 1 from auth.users where id = p_created_by) then
    raise exception 'p_created_by is not an existing auth user: %', p_created_by;
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'a user with that address already exists: %', v_email;
  end if;

  -- ---- auth.users -------------------------------------------------
  -- Column values mirror what GoTrue writes for an email/password user
  -- created through the admin API with email_confirm = true.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token,
    is_super_admin, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    now(),                       -- no SMTP: confirm on creation, as the
    now(),                       -- service does with email_confirm=true
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'must_change_password', true),
    '', '', '', '', '', '', '', '',
    null,                        -- is_super_admin: GoTrue leaves this NULL
    false,                       -- is_sso_user
    false                        -- is_anonymous
  );

  -- ---- auth.identities --------------------------------------------
  -- Without this row the user exists but has no email login attached and
  -- sign-in fails. `email` is a generated column — never insert it.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id::text,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    null, now(), now()
  );

  -- ---- tci.user_roles ---------------------------------------------
  insert into tci.user_roles (user_id, role)
  select v_user_id, r::tci.user_role from unnest(p_roles) as r;

  -- ---- tci.user_profiles ------------------------------------------
  -- must_change_password here is what the app actually reads
  -- (AuthContext selects this column); the user_metadata copy above is
  -- for parity with the service, not for the gate.
  insert into tci.user_profiles (user_id, full_name, must_change_password, created_by)
  values (v_user_id, p_full_name, true, p_created_by);

  -- ---- tci.policyholder_users (clients only) -----------------------
  if v_is_client then
    insert into tci.policyholder_users (entity_id, user_id, created_by)
    values (p_entity_id, v_user_id, p_created_by);
  end if;

  raise notice 'created % with roles % (id %)', v_email, p_roles, v_user_id;
end
$$;

-- Verify — run this after, and read it rather than trusting the notice.
-- Expect: one row, roles as requested, must_change_password = true, and
-- has_identity = true (without it the user cannot sign in).
select u.id,
       u.email,
       u.email_confirmed_at is not null                  as confirmed,
       u.banned_until,
       exists (select 1 from auth.identities i where i.user_id = u.id) as has_identity,
       (select array_agg(r.role::text order by r.role)
          from tci.user_roles r where r.user_id = u.id)   as roles,
       p.full_name,
       p.must_change_password,
       (select array_agg(e.name order by e.name)
          from tci.policyholder_users pu
          join tci.legal_entities e on e.id = pu.entity_id
         where pu.user_id = u.id)                         as client_of
  from auth.users u
  left join tci.user_profiles p on p.user_id = u.id
 where lower(u.email) = lower('person@example.com');   -- <- the address you created


-- =====================================================================
-- 2. RESET A PASSWORD
-- =====================================================================
--
-- Sets a new temporary password and re-arms the forced rotation, the same
-- pair of writes the service's /users/{id}/reset-password performs.
--
-- It also deletes the user's sessions and refresh tokens. The service
-- does not do this explicitly — it relies on GoTrue's own behaviour on an
-- admin password update. Doing it here is deliberate: a reset usually
-- means the account is suspect, and an already-open browser session
-- should not survive it. Delete the two lines if you disagree.

do $$
declare
  -- ------------------------- EDIT ME -------------------------------
  p_email    text := 'person@example.com';
  p_password text := 'CHANGE-ME-at-least-16-chars';
  -- ----------------------- END EDIT ME -----------------------------
  v_user_id uuid;
begin
  if length(p_password) < 16 then
    raise exception 'temporary passwords must be at least 16 characters (got %)',
                    length(p_password);
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no such user: %', p_email;
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('must_change_password', true),
         recovery_token     = '',
         recovery_sent_at   = null,
         updated_at         = now()
   where id = v_user_id;

  -- The app gates on this column, so it is the one that matters.
  insert into tci.user_profiles (user_id, must_change_password)
  values (v_user_id, true)
  on conflict (user_id) do update
    set must_change_password = true,
        updated_at           = now();

  delete from auth.refresh_tokens where user_id = v_user_id::text;
  delete from auth.sessions       where user_id = v_user_id;

  raise notice 'reset password for % (id %)', p_email, v_user_id;
end
$$;


-- =====================================================================
-- 3. DISABLE / ENABLE A USER
-- =====================================================================
--
-- Disabling bans the account far into the future. Supabase has no
-- "forever", so the service passes 876000h (~100 years) and this matches
-- it. Sign-in is refused while banned_until is in the future.
--
-- This does NOT remove roles or delete anything: it is reversible, and
-- the user's history stays intact and attributable.

-- --- disable ---------------------------------------------------------
do $$
declare
  p_email text := 'person@example.com';   -- EDIT ME
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no such user: %', p_email;
  end if;

  update auth.users
     set banned_until = now() + interval '100 years',
         updated_at   = now()
   where id = v_user_id;

  -- End any session already open, or the ban only takes effect when
  -- their current token expires.
  delete from auth.refresh_tokens where user_id = v_user_id::text;
  delete from auth.sessions       where user_id = v_user_id;

  raise notice 'disabled % (id %)', p_email, v_user_id;
end
$$;

-- --- enable ----------------------------------------------------------
do $$
declare
  p_email text := 'person@example.com';   -- EDIT ME
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'no such user: %', p_email;
  end if;

  update auth.users
     set banned_until = null,
         updated_at   = now()
   where id = v_user_id;

  raise notice 'enabled % (id %)', p_email, v_user_id;
end
$$;


-- =====================================================================
-- PORTAL READINESS — read before creating a `client` user
-- =====================================================================
--
-- A client created here CAN sign in and the portal will show them their
-- own data correctly: every client read goes through a tci.v_client_*
-- view and every write through a tci.client_* function (migration 0025),
-- none of which touch the analytics service.
--
-- What does NOT work until that service is hosted:
--
--   * sales and commercial underwriting cannot invite their own clients
--     from the company card — that screen calls the provisioning API and
--     shows the unavailable state. Every client account has to come
--     through this file, run by whoever holds database access.
--   * password reset for a client is likewise manual (snippet 2), so a
--     client who locks themselves out waits for the owner.
--
-- Which is why the portal should not be opened to real policyholders yet:
-- onboarding and lockout recovery both route through one person with a
-- SQL editor. Use it with internal test accounts until the service is
-- deployed, then create clients through the UI as designed.
--
-- =====================================================================
-- CLEANING UP A TEST USER
-- =====================================================================
-- auth.users cascades to auth.identities, and the tci tables reference
-- auth.users, so this removes every row the snippets above created.

-- do $$
-- declare
--   p_email text := 'person@example.com';   -- EDIT ME
--   v_user_id uuid;
-- begin
--   select id into v_user_id from auth.users where lower(email) = lower(btrim(p_email));
--   if v_user_id is null then
--     raise notice 'no such user: %', p_email;
--     return;
--   end if;
--   delete from tci.policyholder_users where user_id = v_user_id;
--   delete from tci.user_profiles      where user_id = v_user_id;
--   delete from tci.user_roles         where user_id = v_user_id;
--   delete from auth.users             where id      = v_user_id;
--   raise notice 'deleted % (id %)', p_email, v_user_id;
-- end
-- $$;
