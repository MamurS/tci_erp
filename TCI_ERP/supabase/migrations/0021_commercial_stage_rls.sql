-- 0021_commercial_stage_rls.sql
-- What: let commercial underwriting actually write its own stage.
-- Why:  0020 introduced the commercial stage but left the decision-table
--       RLS as credit-only, so tci.adjust_limit_commercial could neither
--       lock its input row (SELECT ... FOR UPDATE additionally requires an
--       UPDATE policy) nor insert the adjustment. Found by the Phase 3c-1
--       live smoke.
--
-- The new policies are deliberately narrow: commercial underwriting may
-- insert ONLY stage='commercial' rows and may update ONLY stage='commercial'
-- rows (to supersede its own previous adjustment). Credit-stage decisions
-- stay untouchable by commercial - the rating, conditions and validity of a
-- credit decision remain the credit underwriter's alone, which is exactly
-- what the two-stage rule requires.

create policy "limit_decisions: commercial inserts adjustments"
  on tci.credit_limit_decisions for insert to authenticated
  with check (
    tci.has_role('admin', 'commercial_underwriter')
    and stage = 'commercial'
  );

create policy "limit_decisions: commercial supersedes its own adjustments"
  on tci.credit_limit_decisions for update to authenticated
  using (
    tci.has_role('admin', 'commercial_underwriter')
    and stage = 'commercial'
  )
  with check (
    tci.has_role('admin', 'commercial_underwriter')
    and stage = 'commercial'
  );

-- Sales release/hold touches any decision row, but only through the
-- column-level grant (released_at, release_kind, held, hold_comment) added
-- in 0020 - so a row-level UPDATE policy is still required for them.
create policy "limit_decisions: sales release/hold"
  on tci.credit_limit_decisions for update to authenticated
  using (tci.has_role('admin', 'sales'))
  with check (tci.has_role('admin', 'sales'));

-- The credit decision is only READ here, never modified, so no row lock is
-- needed (and FOR UPDATE would demand write rights the commercial role must
-- not have). A concurrent second adjustment is harmless: the supersede step
-- below retires whichever commercial row was effective first.
create or replace function tci.adjust_limit_commercial(
  p_decision_id        uuid,
  p_new_amount         numeric,
  p_new_payment_terms  int default null,
  p_comment            text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_credit   tci.credit_limit_decisions%rowtype;
  v_new      tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_is_reduction boolean;
begin
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may adjust a limit'
      using errcode = 'P0004';
  end if;

  select * into v_credit from tci.credit_limit_decisions where id = p_decision_id;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_credit.stage <> 'credit' then
    raise exception 'only a credit-stage decision can be adjusted commercially'
      using errcode = 'P0001';
  end if;
  if v_credit.lifecycle <> 'effective' then
    raise exception 'decision is % and can no longer be adjusted', v_credit.lifecycle
      using errcode = 'P0001';
  end if;
  if v_credit.outcome not in ('approved', 'partial') then
    raise exception 'only an approved or partial limit can be adjusted'
      using errcode = 'P0001';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'the adjusted amount must be positive' using errcode = 'P0001';
  end if;

  v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);
  if not tci.has_role('admin') then
    v_amount_uzs := tci.to_uzs(p_new_amount, v_credit.currency_code);
    select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
      into v_authority_uzs
      from tci.authority_grants g
     where g.user_id = (select auth.uid())
       and g.applies_to = 'commercial'
       and g.grade_band = v_band
       and g.valid_from <= current_date
       and (g.valid_to is null or g.valid_to >= current_date);
    if v_amount_uzs > v_authority_uzs then
      raise exception 'adjustment exceeds your commercial authority for grade band % (% > %)',
        v_band, v_amount_uzs, v_authority_uzs using errcode = 'P0004';
    end if;
  end if;

  v_is_reduction := p_new_amount < v_credit.approved_amount;

  update tci.credit_limit_decisions
     set lifecycle = 'superseded'
   where adjusts_decision_id = p_decision_id
     and lifecycle = 'effective';

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, valid_until,
    based_on_assessment_id, comment, stage, adjusts_decision_id, payment_terms_days,
    released_at, release_kind
  ) values (
    v_credit.request_id, v_credit.outcome, p_new_amount, v_credit.currency_code,
    v_credit.valid_from, v_credit.valid_until,
    v_credit.based_on_assessment_id, p_comment, 'commercial', p_decision_id,
    coalesce(p_new_payment_terms, v_credit.payment_terms_days),
    case when v_is_reduction then now() else null end,
    case when v_is_reduction then 'immediate'::tci.release_kind else null end
  ) returning * into v_new;

  perform tci.emit_workflow_event(
    'limit.commercial_adjusted', 'credit_limit_decision', v_new.id,
    jsonb_build_object(
      'credit_decision_id', p_decision_id,
      'from_amount', v_credit.approved_amount,
      'to_amount', p_new_amount,
      'grade_band', v_band,
      'is_reduction', v_is_reduction
    ),
    case when v_is_reduction then 'client'::tci.user_role else 'sales'::tci.user_role end
  );

  return jsonb_build_object(
    'result', 'adjusted',
    'decision_id', v_new.id,
    'grade_band', v_band,
    'is_reduction', v_is_reduction,
    'released_immediately', v_is_reduction
  );
end;
$$;

-- Same reasoning for the hold: sales read the row, they do not lock it.
create or replace function tci.hold_decision(p_decision_id uuid, p_comment text)
returns tci.credit_limit_decisions
language plpgsql
security invoker
set search_path = ''
as $$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  if not tci.has_role('admin', 'sales') then
    raise exception 'only sales may hold a decision' using errcode = 'P0004';
  end if;
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'a hold needs a comment saying what must be discussed'
      using errcode = 'P0001';
  end if;

  select * into v_row from tci.credit_limit_decisions where id = p_decision_id;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_row.released_at is not null then
    raise exception 'the client has already seen this decision - it cannot be held'
      using errcode = 'P0001';
  end if;

  update tci.credit_limit_decisions
     set held = true, hold_comment = p_comment
   where id = p_decision_id
   returning * into v_row;

  perform tci.emit_workflow_event(
    'limit.held', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('comment', p_comment),
    'commercial_underwriter'::tci.user_role
  );
  return v_row;
end;
$$;
