-- What: revoke tci.relationship_signals from public and anon, and assert that
--       no Phase 6 SECURITY DEFINER function is reachable unauthenticated.
-- Why:  0039 granted execute on the writing functions and revoked them from
--       public, but relationship_signals was left with the default PUBLIC
--       grant. It is SECURITY DEFINER and it reads tci.legal_entities, so
--       `anon` could have called /rest/v1/rpc/relationship_signals with two
--       entity ids and read back an address, a contact person and an email
--       domain - registry data the anon role has no policy for anywhere else.
--       Found by the Supabase security advisor after the Phase 6 apply.
--
-- The other helpers added in 0039 (is_free_email_domain, email_domain,
-- normalise_for_match, relationship_signal_score, suggestion_threshold) are
-- pure and SECURITY INVOKER: they read no table, so a PUBLIC grant on them
-- discloses nothing. They are left as they are.

revoke execute on function tci.relationship_signals(uuid, uuid) from public, anon;
grant execute on function tci.relationship_signals(uuid, uuid) to authenticated, service_role;

do $$
declare v_bad text;
begin
  -- Every SECURITY DEFINER function this phase added must be closed to anon.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci'
     and p.prosecdef
     and p.proname in (
       'group_depth_cap', 'group_exposure_warn_pct', 'entity_group',
       'ultimate_parent', 'save_entity_relationship', 'end_entity_relationship',
       'relationship_signals', 'refresh_entity_suggestions',
       'accept_relationship_suggestion', 'reject_relationship_suggestion',
       'current_group_limit', 'set_group_limit', 'end_group_limit',
       'group_exposure_preflight')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0042: these Phase 6 SECURITY DEFINER functions are still anon-executable: %', v_bad;
  end if;
end;
$$;
