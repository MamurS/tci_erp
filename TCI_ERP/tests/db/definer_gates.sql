-- tests/db/definer_gates.sql — run against a database that has replayed the
-- migration chain (the local harness, a Supabase branch, or canonical in a
-- read-only session):
--
--   psql "$DB" -v ON_ERROR_STOP=1 -f tests/db/definer_gates.sql
--
-- It fails loudly when the security-closure invariants of migration 0043 no
-- longer hold. Read-only: nothing is written. Each check mirrors one line of
-- the acceptance criteria of audit Phase A.
\set ON_ERROR_STOP on

do $$
declare v_bad text; v_n int; v_total int;
begin
  -- 1. Every SECURITY DEFINER function executable by `authenticated` is gated,
  --    a trigger function, or on tci.definer_gate_allowlist().
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_bad, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prorettype <> 'trigger'::regtype
     and p.prosrc !~* 'tci\.require_(staff|role|claim_access|staff_or_internal|internal_call)\(|tci\.has_role\(|tci\.is_staff\(|tci\.may_edit_relationships\(|tci\.may_access_claim\(|tci\.may_upload_to_claim\(|tci\.may_edit_claim_content\(|tci\.client_policy_guard\(|tci\.my_client_entities\('
     and p.proname not in (select proname from tci.definer_gate_allowlist());
  if v_n > 0 then
    raise exception 'definer_gates: % ungated SECURITY DEFINER function(s) executable by authenticated: %', v_n, v_bad;
  end if;

  -- 2. The allow-list contains nothing that is not still a SECURITY DEFINER function.
  select string_agg(a.proname, ', ') into v_bad
    from tci.definer_gate_allowlist() a
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'tci' and p.proname = a.proname and p.prosecdef);
  if v_bad is not null then
    raise exception 'definer_gates: stale allow-list entries: %', v_bad;
  end if;

  -- 3. No SECURITY DEFINER function is executable by anon.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'definer_gates: anon-executable SECURITY DEFINER functions: %', v_bad;
  end if;

  -- 4. No function raises P0004 (assert_failure).
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosrc like '%''P0004''%';
  if v_bad is not null then
    raise exception 'definer_gates: P0004 still raised by: %', v_bad;
  end if;

  -- 5. The token machinery is closed to the API roles.
  if has_function_privilege('authenticated', 'tci.begin_trusted_call()', 'execute')
     or has_function_privilege('authenticated', 'tci.internal_call_token()', 'execute')
     or has_function_privilege('authenticated', 'tci.internal_call_ok()', 'execute')
     or has_table_privilege('authenticated', 'tci.internal_secrets', 'select')
     or has_table_privilege('anon', 'tci.internal_secrets', 'select') then
    raise exception 'definer_gates: the internal-call token is reachable by an API role';
  end if;

  -- 6. Every SECURITY DEFINER function pins its search_path (so does set_updated_at).
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
     and (p.prosecdef or p.proname = 'set_updated_at')
     and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%';
  if v_bad is not null then
    raise exception 'definer_gates: functions without a pinned search_path: %', v_bad;
  end if;

  -- 7. has_role / is_staff honour the password rotation.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'tci' and p.proname = 'has_role') not like '%password_rotation_pending%'
     or (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'tci' and p.proname = 'is_staff') not like '%password_rotation_pending%' then
    raise exception 'definer_gates: has_role/is_staff no longer enforce must_change_password';
  end if;

  -- 8. Every tci function a security_invoker view calls is executable by
  --    authenticated. Those views run as the querying user, so a revoke that
  --    reaches one of these functions breaks the screen with "permission
  --    denied for function" — which is exactly what revoking the PUBLIC
  --    default would have done to v_claims, v_claim_position and
  --    v_policy_liability had 0043 not restated the grant first.
  select string_agg(distinct p.proname, ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.pronamespace = n.oid
   where n.nspname = 'tci' and c.relkind = 'v'
     and exists (select 1 from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker' and option_value = 'true')
     and pg_get_viewdef(c.oid) ~ ('tci\.' || p.proname || '\(')
     and not has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'definer_gates: functions used by security_invoker views but not executable by authenticated: %', v_bad;
  end if;

  select count(*) into v_total
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute');
  raise notice 'definer_gates: OK — % SECURITY DEFINER functions executable by authenticated, 0 ungated, % allow-listed',
    v_total, (select count(*) from tci.definer_gate_allowlist());
end;
$$;
