-- 0065_admin_technical_only.sql
--
-- What: Admin is a TECHNICAL role everywhere, not only on credit limits
--       (0063). Removed: every admin branch in the business functions —
--       claims (open, status, verdict override, approval, payments,
--       recoveries, documents), turnover declarations (accept, dispute),
--       premium (invoice, payment, reversal, bank import and matching),
--       submissions (advance, withdraw, bind) and their buyers, commercial
--       offers, contract drafts and generated contract documents, data
--       requests (take, hand over, resolve), client buyer proposals,
--       corporate relationships, limit withdrawal, and acting on another
--       department's Agenda task — and admin from every WRITE policy on the
--       business tables (companies, statements, ratings, policies and their
--       status history, submissions, limits, declarations, instalments,
--       overdue notifications, claims and their money, group limits) and the
--       storage policies for claim documents, contract scans and generated
--       contract documents. tci.change_policy_status now names its rule
--       (commercial underwriting only, 42501) instead of answering "not
--       found" to anyone else.
-- Why:  Prompt 29 PR 1 follow-up, asked by the owner on 2026-10-23: 0063 took
--       admin's business rights on limits and left the rest, so an admin
--       could still approve a claim, accept a declaration, record a premium
--       payment or bind a policy.
--
-- What admin KEEPS (the technical role): users, roles, profiles, managers,
-- sessions, lockouts, the sign-in gate, authority grants, the ADT switch,
-- reference data (countries, currencies, industries, fx rates, reporting
-- frameworks and statement forms, IFRS mappings), the insurer's particulars,
-- contract TEMPLATES, bank-statement profiles, the brochure and media library
-- (retired screens), workflow settings — and READ oversight: every SELECT
-- policy is untouched. The assertion at the end lists exactly which tci
-- functions and which write policies may still name 'admin'; a later
-- migration that adds one must add it there deliberately.
--
-- Mechanics: function bodies are the 0064 bodies with only the 'admin'
-- element taken out of each has_role / require_role list (and the bare
-- "or tci.has_role('admin')" clauses removed) and the three refusal texts
-- that named admin reworded; policies are changed with ALTER POLICY, so no
-- policy is dropped and recreated.

-- ---------------------------------------------------------------------------
-- 1. Business functions without an admin branch
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.accept_declaration(p_declaration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
  v_policy tci.policies%rowtype;
  v_covered numeric(18,2);
  v_amount numeric(18,2);
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('commercial_underwriter') then
    raise exception 'only commercial underwriting may accept a declaration'
      using errcode = '42501';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'accepted') then
    raise exception 'a declaration cannot go from % to accepted', v_dec.status
      using errcode = 'P0001';
  end if;

  select * into v_policy from tci.policies where id = v_dec.policy_id;

  -- Freeze the split exactly as it stands now.
  -- The classification is computed in a subquery over its OWN alias and then
  -- joined back by id: an UPDATE ... FROM LATERAL cannot reference the row
  -- being updated, which is what a lateral over `l` would need.
  update tci.declaration_lines l
     set coverage_basis   = c.coverage_basis,
         covered_amount   = c.covered_amount,
         uncovered_excess = c.uncovered_excess,
         updated_at       = now()
    from (
      select src.id,
             cl.coverage_basis,
             cl.covered_amount,
             cl.uncovered_excess
        from tci.declaration_lines src
        cross join lateral tci.classify_declaration_line(
               tci.buyer_has_effective_limit(v_dec.policy_id, src.entity_id),
               src.insurable_turnover,
               v_policy.discretionary_limit
             ) cl
       where src.declaration_id = p_declaration_id
    ) c
   where l.id = c.id;

  update tci.declarations
     set status = 'accepted',
         accepted_by = (select auth.uid()),
         accepted_at = now(),
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  -- ---- new in 0027: earn the premium -------------------------------------
  -- Premium is earned on COVERED turnover only. Uncovered excess was never
  -- insured, so charging for it would be charging for nothing.
  select coalesce(sum(covered_amount), 0) into v_covered
    from tci.declaration_lines where declaration_id = p_declaration_id;

  v_amount := round(v_covered * v_policy.premium_rate_pct / 100.0, 2);

  insert into tci.premium_entries (
    declaration_id, policy_id, covered_turnover, rate_used, amount, currency_code
  ) values (
    p_declaration_id, v_dec.policy_id, v_covered,
    v_policy.premium_rate_pct, v_amount, v_dec.currency_code
  );
  -- ------------------------------------------------------------------------

  perform tci.emit_workflow_event(
    'declaration.accepted', 'declaration', v_dec.id,
    jsonb_build_object(
      'policy_id', v_dec.policy_id,
      'period_start', v_dec.period_start,
      'premium', v_amount),
    'sales'::tci.user_role);

  -- Shipping outside cover is a commercial conversation, so it is reported
  -- as its own event rather than buried in the acceptance.
  if exists (
    select 1 from tci.v_declaration_lines v
     where v.declaration_id = p_declaration_id
       and v.coverage_basis = 'uncovered_excess'
  ) then
    perform tci.emit_workflow_event(
      'declaration.uncovered_excess', 'declaration', v_dec.id,
      jsonb_build_object(
        'policy_id', v_dec.policy_id,
        'uncovered_excess', (select uncovered_excess from tci.v_declaration_totals
                              where declaration_id = p_declaration_id)),
      'commercial_underwriter'::tci.user_role);
  end if;

  return jsonb_build_object(
    'result', 'accepted', 'declaration_id', v_dec.id, 'premium', v_amount);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.dispute_declaration(p_declaration_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dec tci.declarations%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('commercial_underwriter', 'sales') then
    raise exception 'not allowed to dispute a declaration' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'a dispute needs a reason the policyholder can act on'
      using errcode = 'P0001';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'disputed') then
    raise exception 'a declaration cannot go from % to disputed', v_dec.status
      using errcode = 'P0001';
  end if;

  update tci.declarations
     set status = 'disputed',
         disputed_by = (select auth.uid()),
         disputed_at = now(),
         dispute_note = p_note,
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  perform tci.emit_workflow_event(
    'declaration.disputed', 'declaration', v_dec.id,
    jsonb_build_object('policy_id', v_dec.policy_id, 'note', p_note),
    'client'::tci.user_role);

  return jsonb_build_object('result', 'disputed', 'declaration_id', v_dec.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.advance_insurance_request(p_request_id uuid, p_to_status tci.insurance_request_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.insurance_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
  v_from    tci.insurance_request_status;
  v_ok      boolean := false;
begin
  perform tci.begin_internal_call();
  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'insurance request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  v_from := v_request.status;

  v_ok := case
    when v_from = 'draft'              and p_to_status in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to_status in ('entity_resolution', 'underwriting', 'withdrawn') then true
    when v_from = 'entity_resolution'  and p_to_status in ('underwriting', 'withdrawn') then true
    when v_from = 'underwriting'       and p_to_status in ('commercial_review', 'withdrawn') then true
    when v_from = 'commercial_review'  and p_to_status in ('sales_confirmation', 'withdrawn') then true
    when v_from = 'sales_confirmation' and p_to_status in ('client_review', 'withdrawn') then true
    -- NEW in 0025: the client can hand it back to sales instead of answering.
    when v_from = 'client_review'      and p_to_status in ('accepted', 'declined', 'sales_confirmation', 'withdrawn') then true
    when v_from = 'accepted'           and p_to_status = 'bound' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid insurance request transition: % -> %', v_from, p_to_status
      using errcode = 'P0001';
  end if;

  if p_to_status = 'withdrawn' then
    if not (v_request.created_by = (select auth.uid())) then
      raise exception 'only the creator may withdraw a submission'
        using errcode = '42501';
    end if;
  elsif p_to_status in ('accepted', 'declined') then
    if not tci.has_role('client', 'sales') then
      raise exception 'only the client (or sales on its behalf) may accept or decline'
        using errcode = '42501';
    end if;
  elsif p_to_status = 'client_review' then
    if not tci.has_role('sales') then
      raise exception 'only sales may release a submission to the client'
        using errcode = '42501';
    end if;
  elsif p_to_status = 'sales_confirmation' then
    -- Two ways in, two different gates: commercial underwriting finishing the
    -- review, or the client returning the file for changes.
    if v_from = 'client_review' then
      if not tci.has_role('client', 'sales') then
        raise exception 'only the client (or sales on its behalf) may ask for changes'
          using errcode = '42501';
      end if;
      if coalesce(btrim(p_comment), '') = '' then
        raise exception 'say what should change' using errcode = 'P0001';
      end if;
    elsif not tci.has_role('commercial_underwriter') then
      raise exception 'only commercial underwriting may finish the commercial review'
        using errcode = '42501';
    end if;
  elsif not tci.is_staff() then
    raise exception 'only staff may move a submission' using errcode = '42501';
  end if;

  if p_to_status = 'underwriting' and not tci.request_entities_resolved(p_request_id) then
    raise exception 'every buyer must be resolved to a company before underwriting'
      using errcode = 'P0001';
  end if;
  if p_to_status = 'commercial_review' and not tci.request_credit_complete(p_request_id) then
    raise exception 'every buyer needs a credit decision before the commercial review'
      using errcode = 'P0001';
  end if;
  if p_to_status = 'declined' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'a decline needs a reason' using errcode = 'P0001';
  end if;

  update tci.insurance_requests
     set status = p_to_status,
         submitted_at = case when p_to_status = 'submitted' then now() else submitted_at end,
         decided_at = case when p_to_status in ('accepted', 'declined') then now() else decided_at end,
         decline_reason = case when p_to_status = 'declined' then p_comment else decline_reason end
   where id = p_request_id
   returning * into v_request;

  insert into tci.insurance_request_history (request_id, from_status, to_status, comment)
  values (p_request_id, v_from, p_to_status, p_comment);

  perform tci.emit_workflow_event(
    'request.status_changed', 'insurance_request', p_request_id,
    jsonb_build_object('from', v_from, 'to', p_to_status, 'comment', p_comment),
    case p_to_status
      when 'entity_resolution'  then 'sales'::tci.user_role
      when 'underwriting'       then 'credit_underwriter'::tci.user_role
      when 'commercial_review'  then 'commercial_underwriter'::tci.user_role
      when 'sales_confirmation' then 'sales'::tci.user_role
      when 'client_review'      then 'client'::tci.user_role
      else null
    end
  );

  return v_request;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.bind_insurance_request(p_request_id uuid, p_policy_number text, p_inception_date date, p_expiry_date date)
 RETURNS tci.policies
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
  v_policy  tci.policies%rowtype;
  v_missing text[];
  v_adopted int;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('commercial_underwriter') then
    raise exception 'only commercial underwriting may issue a policy'
      using errcode = '42501';
  end if;

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'submission % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;

  -- Idempotency guard: an explicit refusal, never a second policy.
  if v_request.bound_policy_id is not null then
    raise exception 'submission % is already bound to policy %',
      v_request.request_number, v_request.bound_policy_id using errcode = 'P0001';
  end if;
  if v_request.status <> 'accepted' then
    raise exception 'only an accepted submission can be bound (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  -- Every term the policy table requires must have been agreed. Naming the
  -- missing ones beats a bare not-null violation from the insert.
  v_missing := array_remove(array[
    case when v_request.product_structure is null then 'product_structure' end,
    case when v_request.currency_code is null then 'currency_code' end,
    case when v_request.insured_percentage is null then 'insured_percentage' end,
    case when v_request.nql_amount is null then 'nql_amount' end,
    case when v_request.premium_rate_pct is null then 'premium_rate_pct' end,
    case when v_request.minimum_premium is null then 'minimum_premium' end,
    case when v_request.discretionary_limit is null then 'discretionary_limit' end,
    case when v_request.waiting_period_days is null then 'waiting_period_days' end,
    case when v_request.max_extension_period_days is null then 'max_extension_period_days' end,
    case when v_request.max_payment_terms_days is null then 'max_payment_terms_days' end,
    case when v_request.declaration_frequency is null then 'declaration_frequency' end
  ], null);
  if array_length(v_missing, 1) > 0 then
    raise exception 'the submission is missing agreed terms: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_policy_number), '') = '' then
    raise exception 'a policy needs a number' using errcode = 'P0001';
  end if;
  if p_expiry_date <= p_inception_date then
    raise exception 'the expiry date must be after the inception date'
      using errcode = 'P0001';
  end if;

  insert into tci.policies (
    entity_id, policy_number, product_structure, status,
    inception_date, expiry_date, currency_code, insured_percentage,
    max_liability_amount, max_liability_premium_multiple, nql_amount,
    deductible_each_loss, aggregate_first_loss, premium_rate_pct,
    minimum_premium, estimated_annual_turnover, discretionary_limit,
    waiting_period_days, max_extension_period_days, max_payment_terms_days,
    declaration_frequency, notes
  ) values (
    v_request.entity_id, btrim(p_policy_number), v_request.product_structure, 'draft',
    p_inception_date, p_expiry_date, v_request.currency_code, v_request.insured_percentage,
    v_request.max_liability_amount, v_request.max_liability_premium_multiple, v_request.nql_amount,
    v_request.deductible_each_loss, v_request.aggregate_first_loss, v_request.premium_rate_pct,
    v_request.minimum_premium, v_request.estimated_annual_turnover, v_request.discretionary_limit,
    v_request.waiting_period_days, v_request.max_extension_period_days, v_request.max_payment_terms_days,
    v_request.declaration_frequency,
    -- notes stays the user's field. Provenance is structural - the submission
    -- carries bound_policy_id - and the UI renders it translated; writing an
    -- English sentence in here would leak untranslatable text onto the policy.
    null
  ) returning * into v_policy;

  -- Adopt the package's limits. Their scope moves from the submission to the
  -- policy, which is exactly what the coalesce() key is built to allow.
  update tci.credit_limit_requests
     set policy_id = v_policy.id
   where insurance_request_id = p_request_id
     and policy_id is null;
  get diagnostics v_adopted = row_count;

  update tci.insurance_requests
     set bound_policy_id = v_policy.id
   where id = p_request_id;

  -- The status machine owns the transition, its history row and its event.
  -- No comment: the history row already says `bound`, and a rendered English
  -- sentence would show up untranslated in every locale's timeline. The
  -- policy number travels on the request.bound payload below instead.
  perform tci.advance_insurance_request(p_request_id, 'bound', null);

  perform tci.emit_workflow_event(
    'request.bound', 'insurance_request', p_request_id,
    jsonb_build_object(
      'policy_id', v_policy.id,
      'policy_number', v_policy.policy_number,
      'limits_adopted', v_adopted),
    'sales'::tci.user_role);

  return v_policy;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.append_contract_version(p_draft tci.contract_drafts, p_content jsonb, p_source tci.contract_version_source, p_note text, p_template uuid, p_restored integer)
 RETURNS tci.contract_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row      tci.contract_versions%rowtype;
  v_template tci.wording_templates%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.change_contract_status(p_draft_id uuid, p_to text, p_comment text DEFAULT NULL::text)
 RETURNS tci.contract_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft   tci.contract_drafts%rowtype;
  v_from    tci.contract_draft_status;
  v_to      tci.contract_draft_status;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
  if (v_to = 'agreed' or v_from = 'agreed') and not tci.has_role('commercial_underwriter') then
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
$function$
;

CREATE OR REPLACE FUNCTION tci.create_contract_draft(p_policy_id uuid, p_request_id uuid, p_template_id uuid, p_content jsonb, p_change_note text DEFAULT NULL::text)
 RETURNS tci.contract_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_template tci.wording_templates%rowtype;
  v_draft    tci.contract_drafts%rowtype;
  v_status   text;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.restore_contract_version(p_draft_id uuid, p_base_version_no integer, p_version_no integer, p_change_note text DEFAULT NULL::text)
 RETURNS tci.contract_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft tci.contract_drafts%rowtype;
  v_old   tci.contract_versions%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.save_contract_version(p_draft_id uuid, p_base_version_no integer, p_content jsonb, p_source text, p_change_note text DEFAULT NULL::text, p_template_id uuid DEFAULT NULL::uuid, p_confirm_replace boolean DEFAULT false)
 RETURNS tci.contract_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft    tci.contract_drafts%rowtype;
  v_current  tci.contract_versions%rowtype;
  v_template tci.wording_templates%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.share_contract_draft(p_draft_id uuid, p_share boolean)
 RETURNS tci.contract_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft tci.contract_drafts%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.sign_contract_draft(p_draft_id uuid, p_version_no integer, p_storage_path text, p_file_name text)
 RETURNS tci.contract_drafts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft  tci.contract_drafts%rowtype;
  v_owner  text;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.register_policy_document(p_id uuid, p_policy_id uuid, p_request_id uuid, p_template_id uuid, p_storage_path text, p_file_name text)
 RETURNS tci.policy_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_template tci.wording_templates%rowtype;
  v_object   record;
  v_row      tci.policy_documents%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'sales');
  if (p_policy_id is null) = (p_request_id is null) then
    raise exception 'name exactly one of a policy or a submission' using errcode = 'P0001';
  end if;
  select * into v_template from tci.wording_templates where id = p_template_id;
  if not found then
    raise exception 'template not found' using errcode = 'P0002';
  end if;
  if v_template.status <> 'active' then
    raise exception 'wording_template_not_active: only an active template generates a document'
      using errcode = 'P0001';
  end if;
  if p_storage_path is distinct from format('documents/%s/%s.docx', coalesce(p_policy_id, p_request_id), p_id) then
    raise exception 'a generated document must be stored at documents/<policy or submission>/<id>.docx'
      using errcode = 'P0001';
  end if;
  select o.owner_id into v_object
    from storage.objects o where o.bucket_id = 'wording' and o.name = p_storage_path;
  if not found then
    raise exception 'the generated document was not found in storage' using errcode = 'P0002';
  end if;
  if v_object.owner_id is distinct from (select auth.uid())::text then
    raise exception 'only the generator may register a document' using errcode = '42501';
  end if;

  insert into tci.policy_documents (
    id, policy_id, insurance_request_id, template_id, template_version, language,
    storage_path, file_name, merge_data, generated_by
  ) values (
    p_id, p_policy_id, p_request_id, p_template_id, v_template.version, v_template.language,
    p_storage_path, p_file_name,
    tci.wording_merge_data(p_policy_id, p_request_id), (select auth.uid())
  ) returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.approve_claim(p_claim_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim  tci.claims%rowtype;
  v_calc   jsonb;
  v_payable numeric(18,2);
  v_to     tci.claim_status;
  v_suspension uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('claims') then
    raise exception 'only the claims department may approve a claim' using errcode = '42501';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('submitted', 'under_assessment', 'info_requested') then
    raise exception 'a % claim cannot be approved', v_claim.status using errcode = 'P0001';
  end if;

  -- Always assess against fresh verdicts: an invoice added or edited since the
  -- last recompute must not be approved on stale coverage.
  perform tci.verify_claim_coverage(p_claim_id);
  v_calc := tci.calculate_indemnity(p_claim_id);
  v_payable := (v_calc ->> 'payable')::numeric;

  -- Nothing covered at all, and a covered loss too small to qualify, are
  -- different facts. Say which.
  if coalesce((v_calc ->> 'covered_amount')::numeric, 0) <= 0 then
    raise exception 'this claim computes to nothing payable - decline it with a reason instead'
      using errcode = 'P0001';
  end if;
  if not (v_calc ->> 'nql_met')::boolean then
    raise exception 'the covered loss (%) is below the non-qualifying loss threshold (%) - this claim is not indemnifiable',
      (v_calc ->> 'covered_amount'), (v_calc ->> 'nql_amount')
      using errcode = 'P0001', detail = 'claims.indemnity.belowNql';
  end if;
  if coalesce(v_payable, 0) <= 0 then
    raise exception 'this claim computes to nothing payable - decline it with a reason instead'
      using errcode = 'P0001';
  end if;

  v_to := case when (v_calc ->> 'fully_covered')::boolean
               then 'approved'::tci.claim_status
               else 'partially_approved'::tci.claim_status end;

  update tci.claims
     set approved_indemnity = v_payable,
         afl_consumed = (v_calc ->> 'afl_consumed')::numeric,
         indemnity_trace = v_calc,
         updated_at = now()
   where id = p_claim_id;

  -- An approved claim means the buyer did not pay. The limit stays down;
  -- reinstating it is a fresh credit decision, and 0036 raises the task for it.
  v_suspension := tci.suspend_limit_for_claim(p_claim_id);

  v_claim := tci.change_claim_status(p_claim_id, v_to, p_comment);

  perform tci.emit_workflow_event(
    'claim.approved', 'claim', p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'policy_id', v_claim.policy_id,
      'entity_id', v_claim.entity_id,
      'status', v_to,
      'indemnity', v_payable,
      'currency', v_claim.currency_code,
      'suspension_decision_id', v_suspension),
    'credit_underwriter'::tci.user_role);

  return v_claim;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.change_claim_status(p_claim_id uuid, p_to tci.claim_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim tci.claims%rowtype;
  v_from  tci.claim_status;
  v_ok    boolean := false;
  v_blockers text[];
begin
  perform tci.begin_trusted_call();
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  -- A client may only ever see its own claim; refusing with "not found"
  -- rather than "forbidden" keeps other policyholders' claim ids private.
  if tci.has_role('client') and not tci.claim_actor_may_act(v_claim, true) then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if not tci.is_staff() and not tci.has_role('client') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  v_from := v_claim.status;

  v_ok := case
    when v_from = 'draft'              and p_to in ('submitted', 'withdrawn') then true
    when v_from = 'submitted'          and p_to in ('under_assessment', 'info_requested', 'declined', 'withdrawn') then true
    when v_from = 'under_assessment'   and p_to in ('info_requested', 'approved', 'partially_approved', 'declined') then true
    when v_from = 'info_requested'     and p_to in ('under_assessment', 'declined', 'withdrawn') then true
    when v_from in ('approved', 'partially_approved') and p_to in ('paid', 'closed') then true
    when v_from = 'paid'               and p_to = 'closed' then true
    when v_from = 'declined'           and p_to = 'closed' then true
    when v_from = 'withdrawn'          and p_to = 'closed' then true
    else false
  end;
  if not v_ok then
    raise exception 'invalid claim transition: % -> %', v_from, p_to
      using errcode = 'P0001';
  end if;

  -- Who may drive which transition
  if p_to = 'submitted' then
    -- The policyholder files. Sales files on their behalf when they phone in;
    -- claims can too, to enter a paper filing.
    if not (tci.claim_actor_may_act(v_claim, true) or tci.has_role('sales')) then
      raise exception 'only the policyholder, sales or claims may file a claim'
        using errcode = '42501';
    end if;
    v_blockers := tci.claim_submission_blockers(p_claim_id);
    if array_length(v_blockers, 1) > 0 then
      raise exception 'this claim is not ready to be filed: %', array_to_string(v_blockers, ', ')
        using errcode = 'P0001', detail = array_to_string(v_blockers, ',');
    end if;
  elsif p_to = 'withdrawn' then
    if not (tci.claim_actor_may_act(v_claim, true) or tci.has_role('sales')) then
      raise exception 'only the policyholder, sales or claims may withdraw a claim'
        using errcode = '42501';
    end if;
  elsif p_to = 'under_assessment' and v_from = 'info_requested' then
    -- Answering an information request is the policyholder's move; claims may
    -- also resume assessment itself when the answer arrives another way.
    if not tci.claim_actor_may_act(v_claim, true) then
      raise exception 'only the policyholder or claims may resume assessment'
        using errcode = '42501';
    end if;
  else
    if not tci.has_role('claims') then
      raise exception 'only the claims department may move a claim to %', p_to
        using errcode = '42501';
    end if;
  end if;

  -- A refusal needs a reason on the record. A PARTIAL approval does not: its
  -- justification is the coverage verdicts and the indemnity trace, which are
  -- richer than any sentence and are frozen onto the claim by 0034.
  if p_to = 'declined'
     and coalesce(trim(coalesce(p_comment, v_claim.decision_reason)), '') = '' then
    raise exception 'declining a claim requires a reason' using errcode = 'P0001';
  end if;

  update tci.claims
     set status = p_to,
         filed_at = case when p_to = 'submitted' then now() else filed_at end,
         filed_by = case when p_to = 'submitted' then coalesce(filed_by, (select auth.uid())) else filed_by end,
         assessed_by = case when p_to in ('approved', 'partially_approved', 'declined')
                            then (select auth.uid()) else assessed_by end,
         assessed_at = case when p_to in ('approved', 'partially_approved', 'declined')
                            then now() else assessed_at end,
         decision_reason = case when p_to in ('approved', 'partially_approved', 'declined')
                                then coalesce(p_comment, decision_reason) else decision_reason end,
         -- The ageing clock: opening a pause stamps it, closing one banks it.
         info_requested_at = case when p_to = 'info_requested' then now() else null end,
         assessment_paused = case
           when v_from = 'info_requested' and info_requested_at is not null
             then assessment_paused + (now() - info_requested_at)
           else assessment_paused
         end,
         updated_at = now()
   where id = p_claim_id
   returning * into v_claim;

  insert into tci.claim_status_history (claim_id, from_status, to_status, changed_by, comment)
  values (p_claim_id, v_from, p_to, (select auth.uid()), p_comment);

  perform tci.emit_workflow_event(
    'claim.status_changed', 'claim', p_claim_id,
    jsonb_build_object(
      'from', v_from, 'to', p_to, 'comment', p_comment,
      'claim_number', v_claim.claim_number,
      'policy_id', v_claim.policy_id,
      'entity_id', v_claim.entity_id,
      'claimed_amount', v_claim.claimed_amount,
      'currency', v_claim.currency_code),
    case
      when p_to in ('submitted', 'under_assessment') then 'claims'::tci.user_role
      when p_to in ('info_requested', 'approved', 'partially_approved', 'declined', 'paid')
        then 'client'::tci.user_role
      else null
    end);

  return v_claim;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.claim_actor_may_act(p_claim tci.claims, p_client_ok boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when tci.has_role('claims') then true
    when p_client_ok and tci.has_role('client') then exists (
      select 1 from tci.policies p
       where p.id = p_claim.policy_id
         and p.entity_id in (select tci.my_client_entities())
    )
    else false
  end
$function$
;

CREATE OR REPLACE FUNCTION tci.clear_claim_verdict_override(p_claim_invoice_id uuid)
 RETURNS tci.claim_invoice_verdicts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.claim_invoice_verdicts%rowtype;
begin
  if not tci.has_role('claims') then
    raise exception 'only the claims department may clear an override'
      using errcode = '42501';
  end if;
  update tci.claim_invoice_verdicts
     set override_verdict = null, override_covered_amount = null,
         override_justification = null, overridden_by = null, overridden_at = null
   where claim_invoice_id = p_claim_invoice_id
   returning * into v_row;
  if not found then
    raise exception 'verdict not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.override_claim_verdict(p_claim_invoice_id uuid, p_verdict tci.coverage_verdict, p_covered_amount numeric, p_justification text)
 RETURNS tci.claim_invoice_verdicts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row tci.claim_invoice_verdicts%rowtype;
  v_inv tci.claim_invoices%rowtype;
  v_claim tci.claims%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('claims') then
    raise exception 'only the claims department may override a coverage verdict'
      using errcode = '42501';
  end if;
  if coalesce(trim(coalesce(p_justification, '')), '') = '' then
    raise exception 'an override needs a justification on the record'
      using errcode = 'P0001';
  end if;

  select * into v_inv from tci.claim_invoices where id = p_claim_invoice_id;
  if not found then
    raise exception 'claim invoice not found' using errcode = 'P0002';
  end if;
  select * into v_claim from tci.claims where id = v_inv.claim_id;
  if v_claim.status in ('paid', 'closed', 'withdrawn') then
    raise exception 'this claim is % and can no longer be reassessed', v_claim.status
      using errcode = 'P0001';
  end if;
  if coalesce(p_covered_amount, 0) > coalesce(v_inv.claimable_amount, 0) then
    raise exception 'the covered amount cannot exceed what is claimable on the invoice'
      using errcode = 'P0001';
  end if;
  if p_verdict = 'not_covered' and coalesce(p_covered_amount, 0) <> 0 then
    raise exception 'a not_covered verdict covers nothing' using errcode = 'P0001';
  end if;

  update tci.claim_invoice_verdicts
     set override_verdict = p_verdict,
         override_covered_amount = coalesce(p_covered_amount, 0),
         override_justification = trim(p_justification),
         overridden_by = (select auth.uid()),
         overridden_at = now()
   where claim_invoice_id = p_claim_invoice_id
   returning * into v_row;
  if not found then
    raise exception 'this invoice has no verdict yet - verify the claim first'
      using errcode = 'P0001';
  end if;

  perform tci.emit_workflow_event(
    'claim.verdict_overridden', 'claim', v_inv.claim_id,
    jsonb_build_object(
      'claim_invoice_id', p_claim_invoice_id,
      'invoice_number', v_inv.invoice_number,
      'system_verdict', v_row.system_verdict,
      'system_covered_amount', v_row.system_covered_amount,
      'override_verdict', p_verdict,
      'override_covered_amount', coalesce(p_covered_amount, 0)),
    'claims'::tci.user_role);

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.delete_claim_document(p_document_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_doc tci.claim_documents%rowtype;
begin
  select * into v_doc from tci.claim_documents where id = p_document_id;
  if not found then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  -- The uploader may take back their own file while the claim is still theirs
  -- to assemble; claims may remove anything.
  if not (tci.has_role('claims')
          or (v_doc.uploaded_by = (select auth.uid())
              and tci.may_upload_to_claim(v_doc.claim_id))) then
    raise exception 'not permitted to remove this document' using errcode = '42501';
  end if;
  delete from tci.claim_documents where id = p_document_id;
  return v_doc.storage_path;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.may_edit_claim_content(p_claim_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    -- Staff may correct the file until it has been decided. After a decision
    -- the invoices must not move: the indemnity was frozen from them.
    when tci.has_role('claims', 'sales') then exists (
      select 1 from tci.claims
       where id = p_claim_id
         and status in ('draft', 'submitted', 'under_assessment', 'info_requested'))
    -- The policyholder edits while the ball is theirs.
    when tci.has_role('client') then exists (
      select 1 from tci.claims c
      join tci.policies p on p.id = c.policy_id
      where c.id = p_claim_id
        and p.entity_id in (select tci.my_client_entities())
        and c.status in ('draft', 'info_requested'))
    else false
  end
$function$
;

CREATE OR REPLACE FUNCTION tci.may_upload_to_claim(p_claim_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when p_claim_id is null then false
    when tci.has_role('claims', 'sales') then exists (
      select 1 from tci.claims where id = p_claim_id)
    when tci.has_role('client') then exists (
      select 1 from tci.claims c
      join tci.policies p on p.id = c.policy_id
      where c.id = p_claim_id
        and p.entity_id in (select tci.my_client_entities())
        and c.status in ('draft', 'submitted', 'info_requested'))
    else false
  end
$function$
;

CREATE OR REPLACE FUNCTION tci.open_claim(p_policy_id uuid, p_entity_id uuid, p_cause tci.claim_cause_of_loss DEFAULT 'protracted_default'::tci.claim_cause_of_loss, p_noa_id uuid DEFAULT NULL::uuid, p_insolvency_reference text DEFAULT NULL::text)
 RETURNS tci.claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_claim  tci.claims%rowtype;
  v_noa    tci.overdue_notifications%rowtype;
begin
  perform tci.begin_trusted_call();
  if not (tci.has_role('claims', 'sales') or tci.has_role('client')) then
    raise exception 'not permitted to open a claim' using errcode = '42501';
  end if;

  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  if tci.has_role('client')
     and v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  -- Cover has to have existed. A claim under a draft policy is nonsense; a
  -- claim under an expired or cancelled one is normal - the loss happened
  -- while it was in force.
  if v_policy.status = 'draft' then
    raise exception 'a claim needs a policy that was in force' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'buyer not found' using errcode = 'P0002';
  end if;

  if p_noa_id is not null then
    select * into v_noa from tci.overdue_notifications where id = p_noa_id;
    if not found then
      raise exception 'overdue notification not found' using errcode = 'P0002';
    end if;
    if v_noa.policy_id <> p_policy_id or v_noa.entity_id <> p_entity_id then
      raise exception 'that overdue notification belongs to a different policy or buyer'
        using errcode = 'P0001';
    end if;
  end if;

  insert into tci.claims (
    policy_id, entity_id, overdue_notification_id, cause_of_loss,
    insolvency_reference, currency_code
  ) values (
    p_policy_id, p_entity_id, p_noa_id, p_cause,
    nullif(trim(coalesce(p_insolvency_reference, '')), ''), v_policy.currency_code
  ) returning * into v_claim;

  perform tci.emit_workflow_event(
    'claim.created', 'claim', v_claim.id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'policy_id', p_policy_id, 'entity_id', p_entity_id,
      'cause_of_loss', p_cause, 'noa_id', p_noa_id),
    null);

  return v_claim;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.record_claim_payment(p_claim_id uuid, p_amount numeric, p_paid_at date DEFAULT CURRENT_DATE, p_reference text DEFAULT NULL::text)
 RETURNS tci.claim_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim tci.claims%rowtype;
  v_paid  numeric(18,2);
  v_row   tci.claim_payments%rowtype;
begin
  if not tci.has_role('claims') then
    raise exception 'only the claims department may record an indemnity payment'
      using errcode = '42501';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('approved', 'partially_approved', 'paid') then
    raise exception 'nothing has been approved on this claim yet' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'a payment needs a positive amount' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from tci.claim_payments where claim_id = p_claim_id;
  if v_paid + p_amount > v_claim.approved_indemnity + 0.005 then
    raise exception 'this payment would exceed the approved indemnity (% already paid of %)',
      v_paid, v_claim.approved_indemnity using errcode = 'P0001';
  end if;

  insert into tci.claim_payments (claim_id, amount, currency_code, paid_at, reference)
  values (p_claim_id, p_amount, v_claim.currency_code, coalesce(p_paid_at, current_date), p_reference)
  returning * into v_row;

  -- Settled in full: the claim moves itself, so `paid` can never disagree with
  -- the payments behind it.
  if v_paid + p_amount >= v_claim.approved_indemnity - 0.005
     and v_claim.status <> 'paid' then
    perform tci.change_claim_status(p_claim_id, 'paid', null);
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.record_recovery(p_claim_id uuid, p_gross numeric, p_costs numeric DEFAULT 0, p_received_at date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text)
 RETURNS tci.recoveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claim   tci.claims%rowtype;
  v_tot     record;
  v_paid    numeric(18,2);
  v_ins_borne numeric(18,2);
  v_ph_borne  numeric(18,2);
  v_total_borne numeric(18,2);
  v_net     numeric(18,2);
  v_ins     numeric(18,2);
  v_row     tci.recoveries%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('claims') then
    raise exception 'only the claims department may record a recovery' using errcode = '42501';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if coalesce(p_gross, 0) <= 0 then
    raise exception 'a recovery needs a positive gross amount' using errcode = 'P0001';
  end if;
  if coalesce(p_costs, 0) < 0 or coalesce(p_costs, 0) > p_gross then
    raise exception 'recovery costs must be between zero and the gross amount'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from tci.claim_payments where claim_id = p_claim_id;
  select * into v_tot from tci.claim_covered_totals(p_claim_id);

  v_ins_borne   := round(v_paid, 2);
  v_ph_borne    := greatest(round(coalesce(v_tot.claimable_amount, 0) - v_paid, 2), 0);
  v_total_borne := v_ins_borne + v_ph_borne;
  v_net := round(p_gross - coalesce(p_costs, 0), 2);

  if v_total_borne <= 0 or v_ins_borne <= 0 then
    -- The insurer carried none of this loss - it paid nothing - so it takes
    -- none of the recovery.
    v_ins := 0;
  else
    v_ins := round(v_net * v_ins_borne / v_total_borne, 2);
    v_ins := least(v_ins, v_net);
  end if;

  insert into tci.recoveries (
    claim_id, received_at, gross_amount, recovery_costs,
    insurer_share, policyholder_share, insurer_borne, policyholder_borne,
    currency_code, note
  ) values (
    p_claim_id, coalesce(p_received_at, current_date), p_gross, coalesce(p_costs, 0),
    v_ins, v_net - v_ins, v_ins_borne, v_ph_borne,
    v_claim.currency_code, p_note
  ) returning * into v_row;

  perform tci.emit_workflow_event(
    'claim.recovery_recorded', 'claim', p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'gross', p_gross, 'costs', coalesce(p_costs, 0), 'net', v_net,
      'insurer_share', v_ins, 'policyholder_share', v_net - v_ins,
      'currency', v_claim.currency_code),
    'claims'::tci.user_role);

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.assign_bank_line(p_line_id uuid, p_policy_id uuid)
 RETURNS tci.bank_statement_lines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line    tci.bank_statement_lines%rowtype;
  v_refusal text;
begin
  perform tci.require_role('commercial_underwriter');
  select * into v_line from tci.bank_statement_lines where id = p_line_id;
  if not found then
    raise exception 'statement_line_not_found' using errcode = 'P0002';
  end if;
  perform tci.begin_trusted_call();
  v_refusal := tci.confirm_statement_line(p_line_id, p_policy_id);
  if v_refusal is not null then
    raise exception '%: the payment cannot be recorded on this policy', v_refusal using errcode = 'P0001';
  end if;
  update tci.bank_statement_lines set match_reason = 'assigned' where id = p_line_id;
  perform tci.sync_unmatched_payments_task(v_line.import_id);
  select * into v_line from tci.bank_statement_lines where id = p_line_id;
  return v_line;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.confirm_bank_lines(p_line_ids uuid[])
 RETURNS TABLE(line_id uuid, result text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line    tci.bank_statement_lines%rowtype;
  v_imports uuid[] := '{}';
  v_refusal text;
  v_import  uuid;
begin
  perform tci.require_role('commercial_underwriter');
  perform tci.begin_trusted_call();
  for v_line in
    select * from tci.bank_statement_lines l
     where l.id = any (p_line_ids)
     order by l.import_id, l.line_no
  loop
    line_id := v_line.id;
    if v_line.status not in ('matched', 'suggested') or v_line.match_policy_id is null then
      result := 'statement_line_not_matched';
    else
      v_refusal := tci.confirm_statement_line(v_line.id, v_line.match_policy_id);
      result := coalesce(v_refusal, 'recorded');
    end if;
    v_imports := array_append(v_imports, v_line.import_id);
    return next;
  end loop;
  foreach v_import in array coalesce((select array_agg(distinct x) from unnest(v_imports) x), '{}'::uuid[])
  loop
    perform tci.sync_unmatched_payments_task(v_import);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.ignore_bank_line(p_line_id uuid, p_reason text)
 RETURNS tci.bank_statement_lines
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_line tci.bank_statement_lines%rowtype;
begin
  perform tci.require_role('commercial_underwriter');
  select * into v_line from tci.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'statement_line_not_found' using errcode = 'P0002';
  end if;
  if v_line.status not in ('matched', 'suggested', 'unmatched') then
    raise exception 'statement_line_resolved: this line has already been resolved' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'ignore_reason_required: say why this line is not a premium payment' using errcode = 'P0001';
  end if;
  update tci.bank_statement_lines
     set status = 'ignored', ignore_reason = btrim(p_reason), resolved_by = auth.uid(), resolved_at = now()
   where id = p_line_id
  returning * into v_line;
  perform tci.begin_trusted_call();
  perform tci.sync_unmatched_payments_task(v_line.import_id);
  return v_line;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.import_bank_statement(p_profile_id uuid, p_file_name text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id     uuid;
  v_counts jsonb;
begin
  perform tci.require_role('commercial_underwriter');
  perform tci.begin_trusted_call();
  insert into tci.bank_statement_imports (profile_id, source, file_name, imported_by)
  values (p_profile_id, 'bank_import', nullif(btrim(p_file_name), ''), auth.uid())
  returning id into v_id;
  v_counts := tci.import_statement_lines(v_id, p_lines);
  perform tci.emit_workflow_event('premium.statement_imported', 'bank_statement_import', v_id, v_counts);
  return jsonb_build_object('import_id', v_id) || v_counts;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.invoice_premium_instalment(p_instalment_id uuid, p_invoice_number text, p_invoice_date date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS SETOF tci.v_premium_instalments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row    tci.v_premium_instalments%rowtype;
  v_number text := nullif(btrim(p_invoice_number), '');
begin
  perform tci.require_role('commercial_underwriter');

  -- (filtered by policy first: the allocation is a window per policy)
  select * into v_row from tci.v_premium_instalments vi
   where vi.policy_id = (select pi.policy_id from tci.premium_instalments pi where pi.id = p_instalment_id)
     and vi.id = p_instalment_id;
  if not found then
    raise exception 'instalment_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'instalment_cancelled: a cancelled instalment is not billed' using errcode = 'P0001';
  end if;
  if v_row.invoiced_at is not null then
    raise exception 'instalment_already_invoiced: this instalment was invoiced as %', v_row.invoice_number
      using errcode = 'P0001';
  end if;
  if v_row.outstanding <= 0 then
    raise exception 'instalment_already_paid: nothing is owed on this instalment' using errcode = 'P0001';
  end if;
  if v_number is null then
    raise exception 'invoice_number_required: an invoice needs its number' using errcode = 'P0001';
  end if;
  if length(v_number) > 64 then
    raise exception 'invoice_number_too_long: at most 64 characters' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.premium_instalments where lower(invoice_number) = lower(v_number)) then
    raise exception 'invoice_number_taken: % is already the number of another invoice', v_number
      using errcode = 'P0001';
  end if;
  if coalesce(p_invoice_date, current_date) > current_date then
    raise exception 'invoice_date_in_future: an invoice is dated today or earlier' using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  update tci.premium_instalments
     set status         = 'invoiced',
         invoiced_at    = now(),
         invoice_date   = coalesce(p_invoice_date, current_date),
         invoice_number = v_number,
         invoiced_by    = auth.uid(),
         invoice_note   = nullif(btrim(p_note), '')
   where id = p_instalment_id;

  perform tci.emit_workflow_event(
    'premium.instalment_invoiced', 'premium_instalment', p_instalment_id,
    jsonb_build_object('policy_id', v_row.policy_id, 'invoice_number', v_number, 'amount', v_row.amount));
  return query
    select * from tci.v_premium_instalments vi where vi.policy_id = v_row.policy_id order by vi.sequence;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.record_premium_payment(p_policy_id uuid, p_amount numeric, p_payment_date date, p_currency text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_source tci.premium_payment_source DEFAULT 'manual'::tci.premium_payment_source, p_note text DEFAULT NULL::text)
 RETURNS SETOF tci.v_premium_instalments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_role('commercial_underwriter');
  perform tci.begin_trusted_call();
  perform tci.record_premium_payment_internal(
    p_policy_id, 'payment', p_amount,
    coalesce(p_currency, (select currency_code from tci.policies where id = p_policy_id)),
    p_payment_date, p_reference, coalesce(p_source, 'manual'), p_note, null, null, null);
  return query
    select * from tci.v_premium_instalments vi where vi.policy_id = p_policy_id order by vi.sequence;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.reverse_premium_payment(p_payment_id uuid, p_reason text)
 RETURNS SETOF tci.v_premium_instalments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment tci.premium_payments%rowtype;
begin
  perform tci.require_role('commercial_underwriter');

  select * into v_payment from tci.premium_payments where id = p_payment_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_payment.kind = 'reversal' then
    raise exception 'payment_is_reversal: a reversal cannot itself be reversed' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.premium_payments where reverses_id = p_payment_id) then
    raise exception 'payment_already_reversed: this payment has already been reversed' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reversal_reason_required: say why the payment is reversed' using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  perform tci.record_premium_payment_internal(
    v_payment.policy_id, 'reversal', v_payment.amount, v_payment.currency_code, current_date,
    v_payment.reference, v_payment.source, p_reason, p_payment_id, null, null);
  return query
    select * from tci.v_premium_instalments vi where vi.policy_id = v_payment.policy_id order by vi.sequence;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.create_commercial_offer(p_request_id uuid, p_language text, p_texts jsonb, p_valid_until date DEFAULT NULL::date, p_include_brochure boolean DEFAULT true)
 RETURNS tci.commercial_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request tci.insurance_requests%rowtype;
  v_offer   tci.commercial_offers%rowtype;
  v_until   date := coalesce(p_valid_until, tci.offer_today() + 30);
begin
  perform tci.require_role('sales', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_request from tci.insurance_requests where id = p_request_id for update;
  if not found then
    raise exception 'insurance request not found' using errcode = 'P0002';
  end if;
  if not tci.offer_request_status_ok(v_request.status) then
    raise exception 'offer_request_status: an offer is prepared during the commercial review, sales confirmation or client review (the submission is %)', v_request.status
      using errcode = 'P0001';
  end if;
  if v_request.currency_code is null or v_request.premium_rate_pct is null
     or v_request.minimum_premium is null or v_request.product_structure is null then
    raise exception 'offer_terms_missing: the proposed terms (structure, currency, rate, minimum premium) are not filled in yet'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.commercial_offers o
              where o.insurance_request_id = p_request_id and tci.offer_is_live(o.status)) then
    raise exception 'offer_exists: this submission already has a live offer; edit it or withdraw it first'
      using errcode = 'P0001';
  end if;
  if p_language not in ('en', 'ru', 'uz') then
    raise exception 'offer_language: % is not an offer language', p_language using errcode = 'P0001';
  end if;
  if v_until < tci.offer_today() then
    raise exception 'offer_valid_until_past: an offer cannot be valid until a day that has passed'
      using errcode = 'P0001';
  end if;
  if not tci.offer_texts_ok(p_texts) then
    raise exception 'offer_texts_invalid' using errcode = 'P0001';
  end if;

  insert into tci.commercial_offers (insurance_request_id, entity_id, language, valid_until, created_by)
  values (p_request_id, v_request.entity_id, p_language, v_until, (select auth.uid()))
  returning * into v_offer;

  perform tci.append_offer_version(v_offer, p_texts, v_until, p_include_brochure, null);

  perform tci.emit_workflow_event('offer.created', 'commercial_offer', v_offer.id,
    jsonb_build_object('offer_number', v_offer.offer_number, 'request_id', p_request_id,
                       'request_number', v_request.request_number, 'language', p_language),
    null);

  select * into v_offer from tci.commercial_offers where id = v_offer.id;
  return v_offer;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.publish_offer(p_offer_id uuid)
 RETURNS tci.commercial_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_offer   tci.commercial_offers%rowtype;
  v_request tci.insurance_requests%rowtype;
  v_version tci.commercial_offer_versions%rowtype;
  v_republish boolean;
begin
  perform tci.require_role('sales');
  perform tci.begin_trusted_call();

  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found then
    raise exception 'commercial offer not found' using errcode = 'P0002';
  end if;
  if not tci.offer_is_live(v_offer.status) then
    raise exception 'offer_closed: the offer is % and cannot be published', v_offer.status
      using errcode = 'P0001';
  end if;
  select * into v_version from tci.commercial_offer_versions where id = v_offer.current_version_id;
  if v_offer.status in ('published', 'viewed') and v_offer.published_version_id = v_version.id then
    raise exception 'offer_nothing_new: the latest version is already published'
      using errcode = 'P0001';
  end if;
  if v_version.valid_until < tci.offer_today() then
    raise exception 'offer_valid_until_past: the latest version expired on %; save a version with a new date', v_version.valid_until
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.insurance_requests where id = v_offer.insurance_request_id for update;
  if v_request.status = 'sales_confirmation' then
    perform tci.advance_insurance_request(v_request.id, 'client_review', null);
  elsif v_request.status <> 'client_review' then
    raise exception 'offer_request_status: an offer is published from sales confirmation (the submission is %)', v_request.status
      using errcode = 'P0001';
  end if;

  v_republish := v_offer.published_version_id is not null;
  update tci.commercial_offers
     set status = 'published',
         published_version_id = v_version.id,
         valid_until = v_version.valid_until,
         published_at = now(),
         published_by = (select auth.uid()),
         published_viewed_at = null,
         answered_at = null
   where id = p_offer_id
   returning * into v_offer;

  perform tci.emit_workflow_event('offer.published', 'commercial_offer', p_offer_id,
    jsonb_build_object('offer_number', v_offer.offer_number, 'request_id', v_request.id,
                       'request_number', v_request.request_number,
                       'version_no', v_version.version_no, 'valid_until', v_version.valid_until,
                       'republished', v_republish),
    null);
  return v_offer;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.save_offer_version(p_offer_id uuid, p_base_version_no integer, p_texts jsonb, p_valid_until date, p_include_brochure boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS tci.commercial_offer_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_offer   tci.commercial_offers%rowtype;
  v_request tci.insurance_requests%rowtype;
  v_latest  int;
begin
  perform tci.require_role('sales', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found then
    raise exception 'commercial offer not found' using errcode = 'P0002';
  end if;
  if not tci.offer_is_live(v_offer.status) then
    raise exception 'offer_closed: the offer is % and cannot be changed', v_offer.status
      using errcode = 'P0001';
  end if;
  select * into v_request from tci.insurance_requests where id = v_offer.insurance_request_id;
  if not tci.offer_request_status_ok(v_request.status) then
    raise exception 'offer_request_status: the submission is % — an offer is not edited at this step', v_request.status
      using errcode = 'P0001';
  end if;
  select max(version_no) into v_latest from tci.commercial_offer_versions where offer_id = p_offer_id;
  if p_base_version_no is distinct from v_latest then
    raise exception 'offer_version_conflict: version % was saved since you opened version %', v_latest, p_base_version_no
      using errcode = 'P0001';
  end if;
  if p_valid_until is null or p_valid_until < tci.offer_today() then
    raise exception 'offer_valid_until_past: an offer cannot be valid until a day that has passed'
      using errcode = 'P0001';
  end if;
  if not tci.offer_texts_ok(p_texts) then
    raise exception 'offer_texts_invalid' using errcode = 'P0001';
  end if;

  return tci.append_offer_version(v_offer, p_texts, p_valid_until, coalesce(p_include_brochure, true), p_note);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.withdraw_offer(p_offer_id uuid, p_reason text)
 RETURNS tci.commercial_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_offer   tci.commercial_offers%rowtype;
  v_request tci.insurance_requests%rowtype;
  v_was     tci.offer_status;
begin
  perform tci.require_role('sales');
  perform tci.begin_trusted_call();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'offer_withdraw_reason: say why the offer is withdrawn' using errcode = 'P0001';
  end if;
  select * into v_offer from tci.commercial_offers where id = p_offer_id for update;
  if not found then
    raise exception 'commercial offer not found' using errcode = 'P0002';
  end if;
  if not tci.offer_is_live(v_offer.status) then
    raise exception 'offer_closed: the offer is % and cannot be withdrawn', v_offer.status
      using errcode = 'P0001';
  end if;
  v_was := v_offer.status;

  update tci.commercial_offers
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = (select auth.uid()),
         withdraw_reason = btrim(p_reason)
   where id = p_offer_id
   returning * into v_offer;

  select * into v_request from tci.insurance_requests where id = v_offer.insurance_request_id for update;
  if v_was in ('published', 'viewed') and v_request.status = 'client_review' then
    perform tci.advance_insurance_request(v_request.id, 'sales_confirmation', btrim(p_reason));
  end if;

  perform tci.emit_workflow_event('offer.withdrawn', 'commercial_offer', p_offer_id,
    jsonb_build_object('offer_number', v_offer.offer_number, 'request_id', v_request.id,
                       'request_number', v_request.request_number, 'from', v_was),
    null);
  return v_offer;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.assign_entity_request(p_request_id uuid, p_user_id uuid)
 RETURNS tci.entity_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.entity_requests%rowtype;
begin
  perform tci.require_role('information_manager');
  select * into v_row from tci.entity_requests where id = p_request_id for update;
  if not found then
    raise exception 'request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'in_progress') then
    raise exception 'this data request is already % (%)', v_row.status, v_row.request_number using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.user_roles ur
                  where ur.user_id = p_user_id and ur.role = 'information_manager') then
    raise exception 'the assignee must hold the information_manager role' using errcode = 'P0001';
  end if;
  if v_row.assigned_to = p_user_id then
    return v_row;
  end if;

  perform tci.begin_trusted_call();
  update tci.entity_requests
     set assigned_to = p_user_id, assigned_at = now(), status = 'new'
   where id = p_request_id
   returning * into v_row;
  perform tci.emit_workflow_event('data.entity_request_assigned', 'entity_request', p_request_id,
    jsonb_build_object('to', p_user_id, 'kind', v_row.kind, 'name', v_row.requested_name,
                       'country', v_row.country_code, 'request_number', v_row.request_number),
    null, p_user_id);
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.resolve_entity_request(p_request_id uuid, p_outcome text, p_entity_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS tci.entity_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row    tci.entity_requests%rowtype;
  v_entity uuid;
  v_note   text := nullif(btrim(p_note), '');
begin
  perform tci.require_role('information_manager');
  select * into v_row from tci.entity_requests where id = p_request_id for update;
  if not found then
    raise exception 'request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'in_progress') then
    raise exception 'this data request is already % (%)', v_row.status, v_row.request_number using errcode = 'P0001';
  end if;
  if p_outcome not in ('created', 'linked', 'updated', 'rejected') then
    raise exception 'unknown outcome %', p_outcome using errcode = 'P0001';
  end if;
  if p_outcome in ('created', 'linked') and v_row.kind <> 'new_company' then
    raise exception 'a statements request ends as updated or rejected' using errcode = 'P0001';
  end if;
  if p_outcome = 'updated' and v_row.kind <> 'statements_update' then
    raise exception 'a company request ends as created, linked or rejected' using errcode = 'P0001';
  end if;
  if p_outcome = 'rejected' and v_note is null then
    raise exception 'a rejected request needs a reason' using errcode = 'P0001';
  end if;

  v_entity := case when p_outcome = 'updated' then v_row.entity_id else p_entity_id end;
  if p_outcome in ('created', 'linked') then
    if v_entity is null or not exists (select 1 from tci.legal_entities e where e.id = v_entity) then
      raise exception 'name the company the request was resolved with' using errcode = 'P0001';
    end if;
  end if;

  perform tci.begin_trusted_call();
  update tci.entity_requests
     set status = p_outcome::tci.entity_request_status,
         entity_id = coalesce(v_entity, entity_id),
         resolved_by = (select auth.uid()),
         resolved_at = now(),
         resolution_note = v_note,
         assigned_to = coalesce(assigned_to, (select auth.uid()))
   where id = p_request_id
   returning * into v_row;

  perform tci.emit_workflow_event('data.entity_request_resolved', 'entity_request', p_request_id,
    jsonb_build_object('outcome', p_outcome, 'kind', v_row.kind, 'name', v_row.requested_name,
                       'entity_id', v_row.entity_id, 'request_number', v_row.request_number,
                       'requested_by', v_row.requested_by),
    null, v_row.requested_by);
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.take_entity_request(p_request_id uuid)
 RETURNS tci.entity_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row  tci.entity_requests%rowtype;
  v_me   uuid := (select auth.uid());
begin
  perform tci.require_role('information_manager');
  select * into v_row from tci.entity_requests where id = p_request_id for update;
  if not found then
    raise exception 'request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'in_progress') then
    raise exception 'this data request is already % (%)', v_row.status, v_row.request_number using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  if v_row.assigned_to is distinct from v_me then
    update tci.entity_requests
       set assigned_to = v_me, assigned_at = now(), status = 'in_progress'
     where id = p_request_id
     returning * into v_row;
    perform tci.emit_workflow_event('data.entity_request_assigned', 'entity_request', p_request_id,
      jsonb_build_object('to', v_me, 'kind', v_row.kind, 'name', v_row.requested_name,
                         'country', v_row.country_code, 'request_number', v_row.request_number),
      null, v_me);
  elsif v_row.status = 'new' then
    update tci.entity_requests set status = 'in_progress' where id = p_request_id
     returning * into v_row;
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.reject_buyer_proposal(p_proposal_id uuid, p_reason text)
 RETURNS tci.client_buyer_proposals
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_proposal tci.client_buyer_proposals%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = '42501';
  end if;
  if coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'a rejection needs a reason' using errcode = 'P0001';
  end if;

  update tci.client_buyer_proposals
     set status = 'rejected', reject_reason = btrim(p_reason),
         resolved_by = (select auth.uid()), resolved_at = now()
   where id = p_proposal_id and status = 'pending_entity'
   returning * into v_proposal;
  if not found then
    raise exception 'proposal % not found or already resolved', p_proposal_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'client.buyer_proposal_resolved', 'client_buyer_proposal', p_proposal_id,
    jsonb_build_object('rejected', true), null);

  return v_proposal;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.resolve_buyer_proposal(p_proposal_id uuid, p_entity_id uuid DEFAULT NULL::uuid, p_new_name text DEFAULT NULL::text, p_new_country character DEFAULT NULL::bpchar, p_new_registration_number text DEFAULT NULL::text, p_new_legal_form text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_proposal tci.client_buyer_proposals%rowtype;
  v_entity_id uuid;
  v_request tci.credit_limit_requests%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('information_manager', 'sales', 'credit_underwriter') then
    raise exception 'not allowed to resolve buyer proposals' using errcode = '42501';
  end if;

  select * into v_proposal from tci.client_buyer_proposals
   where id = p_proposal_id for update;
  if not found then
    raise exception 'proposal % not found', p_proposal_id using errcode = 'P0002';
  end if;
  if v_proposal.status <> 'pending_entity' then
    raise exception 'this proposal is already %', v_proposal.status using errcode = 'P0001';
  end if;

  if p_entity_id is not null then
    v_entity_id := p_entity_id;
    if not exists (select 1 from tci.legal_entities where id = v_entity_id) then
      raise exception 'company not found' using errcode = 'P0002';
    end if;
  else
    if coalesce(btrim(coalesce(p_new_name, '')), '') = '' then
      raise exception 'either pick a company or give the new one a name'
        using errcode = 'P0001';
    end if;
    insert into tci.legal_entities (name, country_code, registration_number, legal_form)
    values (btrim(p_new_name),
            coalesce(p_new_country, v_proposal.proposed_country_code, 'UZ'),
            nullif(btrim(coalesce(p_new_registration_number,
                                  v_proposal.proposed_registration_number, '')), ''),
            p_new_legal_form)
    returning id into v_entity_id;
  end if;

  if exists (
    select 1 from tci.credit_limit_requests r
     where tci.limit_scope(r.policy_id, r.insurance_request_id) = v_proposal.policy_id
       and r.entity_id = v_entity_id
       and r.status in ('draft', 'submitted', 'under_review', 'escalated')
  ) then
    raise exception 'there is already an open limit request for this buyer on that policy'
      using errcode = 'P0001';
  end if;

  insert into tci.credit_limit_requests (
    policy_id, entity_id, requested_amount, currency_code,
    requested_payment_terms_days, justification, status, submitted_at
  ) values (
    v_proposal.policy_id, v_entity_id, v_proposal.requested_amount,
    v_proposal.currency_code, v_proposal.requested_payment_terms_days,
    v_proposal.justification, 'submitted', now()
  ) returning * into v_request;

  update tci.client_buyer_proposals
     set status = 'resolved',
         resolved_entity_id = v_entity_id,
         resolved_request_id = v_request.id,
         resolved_by = (select auth.uid()),
         resolved_at = now()
   where id = p_proposal_id;

  -- Closes the information manager's task...
  perform tci.emit_workflow_event(
    'client.buyer_proposal_resolved', 'client_buyer_proposal', p_proposal_id,
    jsonb_build_object('entity_id', v_entity_id, 'request_id', v_request.id),
    'credit_underwriter'::tci.user_role);
  -- ...and opens credit underwriting's, exactly as any other request would.
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', v_request.id,
    jsonb_build_object(
      'entity_id', v_entity_id,
      'amount', v_request.requested_amount,
      'currency', v_request.currency_code,
      'from_proposal', p_proposal_id),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object('entity_id', v_entity_id, 'request_id', v_request.id);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.resolve_request_buyer(p_buyer_row_id uuid, p_entity_id uuid)
 RETURNS tci.insurance_request_buyers
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_row tci.insurance_request_buyers%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('sales', 'information_manager', 'credit_underwriter') then
    raise exception 'not allowed to resolve submission buyers' using errcode = '42501';
  end if;

  update tci.insurance_request_buyers
     set entity_id = p_entity_id, resolution_status = 'ready'
   where id = p_buyer_row_id
   returning * into v_row;
  if not found then
    raise exception 'package buyer % not found or not accessible', p_buyer_row_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'request.buyer_resolved', 'insurance_request', v_row.request_id,
    jsonb_build_object('buyer_row_id', v_row.id, 'entity_id', p_entity_id),
    'credit_underwriter'::tci.user_role
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.may_edit_relationships()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select tci.has_role('information_manager',
                      'credit_underwriter', 'commercial_underwriter')
$function$
;

CREATE OR REPLACE FUNCTION tci.withdraw_limit_request(p_request_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.credit_limit_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.credit_limit_requests%rowtype;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('draft', 'submitted', 'under_review', 'escalated') then
    raise exception 'request is already % and cannot be withdrawn', v_request.status
      using errcode = 'P0001';
  end if;

  -- The requester, or anyone who may decide (credit underwriting).
  if not (v_request.requested_by = (select auth.uid())
          or tci.has_role('credit_underwriter')) then
    raise exception 'only the requester or credit underwriting may withdraw'
      using errcode = '42501';
  end if;

  update tci.credit_limit_requests
     set status = 'withdrawn', withdrawn_at = now(), withdraw_comment = p_comment
   where id = p_request_id
   returning * into v_request;
  return v_request;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.task_is_mine(p_target_role tci.user_role, p_target_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_target_user = (select auth.uid())
      or (p_target_role is not null and p_target_role in (select tci.current_user_roles()))
$function$
;

-- ---------------------------------------------------------------------------
-- 2. Policy status: commercial underwriting, by name
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.change_policy_status(p_policy_id uuid, p_to_status tci.policy_status, p_comment text DEFAULT NULL::text)
 RETURNS tci.policies
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_policy tci.policies%rowtype;
  v_from   tci.policy_status;
begin
  -- 0047: the status machine is the only path to a status change; it marks
  -- the transaction so the guard triggers let its writes through.
  perform tci.begin_internal_call();
  -- 0065: commercial underwriting only, said by name. Without this line the
  -- policies RLS would still refuse anyone else, but as "not found" (SELECT
  -- ... FOR UPDATE consults the UPDATE policy), which reads as a missing row.
  if not tci.has_role('commercial_underwriter') then
    raise exception 'policy_status_commercial_only: only commercial underwriting changes a policy''s status'
      using errcode = '42501';
  end if;
  select * into v_policy from tci.policies where id = p_policy_id for update;
  if not found then
    raise exception 'policy % not found or not accessible', p_policy_id
      using errcode = 'P0002';
  end if;

  if not (
    (v_policy.status = 'draft'     and p_to_status = 'active')
    or (v_policy.status = 'active'    and p_to_status in ('suspended', 'cancelled', 'expired', 'annulled'))
    or (v_policy.status = 'suspended' and p_to_status in ('active', 'cancelled', 'annulled'))
  ) then
    raise exception 'invalid policy status transition: % -> %', v_policy.status, p_to_status
      using errcode = 'P0001';
  end if;

  if p_to_status = 'annulled' and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'annulment requires a comment (reason for voiding the policy)'
      using errcode = 'P0001';
  end if;

  v_from := v_policy.status;

  update tci.policies
     set status = p_to_status
   where id = p_policy_id
   returning * into v_policy;

  insert into tci.policy_status_history (policy_id, from_status, to_status, comment)
  values (p_policy_id, v_from, p_to_status, p_comment);

  return v_policy;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 3. Write policies on business tables without admin
-- ---------------------------------------------------------------------------

alter policy "legal_entities: staff write" on tci.legal_entities
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'commercial_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'commercial_underwriter'::tci.user_role]));

alter policy "financial_statements: data write" on tci.financial_statements
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "balance_sheets: data write" on tci.balance_sheets
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "income_statements: data write" on tci.income_statements
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "local_statement_values: data write" on tci.local_statement_values
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "credit_assessments: credit write" on tci.credit_assessments
  using (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]));

alter policy "policies: commercial write" on tci.policies
  using (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]));

alter policy "policy_status_history: commercial write" on tci.policy_status_history
  using (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]));

alter policy "limit_requests: workflow write" on tci.credit_limit_requests
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "limit_decisions: credit write" on tci.credit_limit_decisions
  using (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]));

alter policy "decision_conditions: credit write" on tci.decision_conditions
  using (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]));

alter policy "insurance_requests: workflow write" on tci.insurance_requests
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "request_buyers: workflow write" on tci.insurance_request_buyers
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "limit_decisions: commercial inserts adjustments" on tci.credit_limit_decisions
  with check ((tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]) AND (stage = 'commercial'::tci.decision_stage)));

alter policy "limit_decisions: commercial supersedes its own adjustments" on tci.credit_limit_decisions
  using ((tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]) AND (stage = 'commercial'::tci.decision_stage)))
  with check ((tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]) AND (stage = 'commercial'::tci.decision_stage)));

alter policy "limit_decisions: sales release/hold" on tci.credit_limit_decisions
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role]));

alter policy "buyer_proposals: resolver writes" on tci.client_buyer_proposals
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'sales'::tci.user_role, 'credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'sales'::tci.user_role, 'credit_underwriter'::tci.user_role]));

alter policy "declarations: staff write" on tci.declarations
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]));

alter policy "declarations: staff update" on tci.declarations
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]));

alter policy "declaration_lines: staff write" on tci.declaration_lines
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]));

alter policy "declaration_lines: staff update" on tci.declaration_lines
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]));

alter policy "declaration_lines: staff delete" on tci.declaration_lines
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role]));

alter policy "premium_instalments: commercial writes" on tci.premium_instalments
  with check (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]));

alter policy "premium_instalments: commercial updates" on tci.premium_instalments
  using (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]));

alter policy "premium_instalments: commercial deletes" on tci.premium_instalments
  using (tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role]));

alter policy "overdue_notifications: staff write" on tci.overdue_notifications
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role, 'claims'::tci.user_role]));

alter policy "overdue_notifications: staff update" on tci.overdue_notifications
  using (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role, 'claims'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['sales'::tci.user_role, 'commercial_underwriter'::tci.user_role, 'credit_underwriter'::tci.user_role, 'claims'::tci.user_role]));

alter policy "claims: staff write" on tci.claims
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role, 'sales'::tci.user_role]));

alter policy "claims: staff update" on tci.claims
  using (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]));

alter policy "claim_invoices: staff write" on tci.claim_invoices
  using (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role, 'sales'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role, 'sales'::tci.user_role]));

alter policy "claim_invoice_verdicts: claims write" on tci.claim_invoice_verdicts
  using (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]));

alter policy "claim_payments: claims write" on tci.claim_payments
  using (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]));

alter policy "recoveries: claims write" on tci.recoveries
  using (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]));

alter policy "claim documents: claims may replace" on storage.objects
  using (((bucket_id = 'claim-documents'::text) AND tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]) AND tci.may_access_claim(tci.claim_id_from_storage_path(name))))
  with check (((bucket_id = 'claim-documents'::text) AND tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]) AND tci.may_access_claim(tci.claim_id_from_storage_path(name))));

alter policy "claim documents: claims may delete" on storage.objects
  using (((bucket_id = 'claim-documents'::text) AND tci.has_role(VARIADIC ARRAY['claims'::tci.user_role]) AND tci.may_access_claim(tci.claim_id_from_storage_path(name))));

alter policy "claim_documents: staff write" on tci.claim_documents
  using (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role, 'sales'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['claims'::tci.user_role, 'sales'::tci.user_role]));

alter policy "group_limits: credit write" on tci.group_limits
  using (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['credit_underwriter'::tci.user_role]));

alter policy "wording: upload documents" on storage.objects
  with check (((bucket_id = 'wording'::text) AND (name ~~ 'documents/%'::text) AND tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role, 'sales'::tci.user_role])));

alter policy "contract scans: upload for an agreed draft" on storage.objects
  with check (((bucket_id = 'contract-scans'::text) AND tci.has_role(VARIADIC ARRAY['commercial_underwriter'::tci.user_role, 'sales'::tci.user_role]) AND (name ~* '^[0-9a-f-]{36}/[^/]+\.pdf$'::text) AND (EXISTS ( SELECT 1
   FROM tci.contract_drafts d
  WHERE (((d.id)::text = split_part(objects.name, '/'::text, 1)) AND (d.status = 'agreed'::tci.contract_draft_status))))));

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_extra text;
begin
  -- Exactly these tci functions may still name 'admin': the technical role.
  select string_agg(p.proname, ', ' order by p.proname) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.prosrc like '%''admin''%'
     and p.proname not in (
       -- users, sessions, sign-in
       'admin_user_failures', 'mfa_satisfied', 'my_auth_status', 'prune_auth_data',
       'revoke_user_sessions', 'set_login_gate_enforced', 'set_user_manager',
       'unlock_account', 'user_managers',
       -- settings (the ADT switch) and read-only oversight
       'auto_decision_settings', 'set_auto_decision_settings', 'buyer_adt_state',
       'limit_validation_history',
       -- configuration: contract templates, bank-statement profiles, brochure and media
       'register_wording_template', 'set_wording_template_status', 'save_bank_statement_profile',
       'save_brochure_version', 'publish_brochure_version',
       'register_media_asset', 'update_media_asset', 'retire_media_asset');
  if v_extra is not null then
    raise exception '0065: these functions still give admin a business right: %', v_extra;
  end if;

  -- Exactly these write policies may still name admin: users, authority,
  -- reference data, settings, templates and media.
  select string_agg(schemaname || '.' || tablename || ' "' || policyname || '"', ', ') into v_extra
    from pg_policies
   where schemaname in ('tci', 'storage') and cmd <> 'SELECT'
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%admin%'
     and not (schemaname = 'tci' and tablename in (
           'authority_grants', 'countries', 'country_reporting_frameworks', 'currencies',
           'fx_rates', 'ifrs_mappings', 'industries', 'insurer_profile', 'policyholder_users',
           'reporting_frameworks', 'statement_template_lines', 'statement_templates',
           'user_profiles', 'user_roles', 'workflow_settings'))
     and not (schemaname = 'storage' and policyname in (
           'wording: upload templates', 'media assets: admin and sales upload'));
  if v_extra is not null then
    raise exception '0065: these write policies still let admin write business data: %', v_extra;
  end if;

  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'tci' and p.proname = 'change_policy_status')
     not like '%policy_status_commercial_only%' then
    raise exception '0065: change_policy_status does not name its role rule';
  end if;

  -- The technical role is untouched.
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'tci' and p.proname = 'set_user_manager') not like '%require_role(''admin'')%' then
    raise exception '0065: admin lost a technical right (set_user_manager)';
  end if;
end;
$$;
