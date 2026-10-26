-- 0079_rating_scorecard.sql
--
-- What: a grade set by a person is built from SUB-GRADES (owner, 2026-10-26,
--       after Allianz Trade's underwriting practice). Every rating proposal
--       — approved alone, sent to a colleague or escalated (0078) — carries a
--       scorecard of four pillars:
--         * general        — soft information: ownership and group,
--                            management, track record, market position,
--                            sector and country, quality of information;
--         * balance_sheet  — equity and debt: solvency, leverage, liquidity,
--                            working capital;
--         * profit_loss    — performance: revenue, margins, interest cover,
--                            stability of results;
--         * payment        — payment behaviour and experience: our own and
--                            the market's (overdue notices, claims, trade
--                            references).
--       Each pillar has a grade of the scale (or is «not assessed», weight 0
--       — e.g. no statements), a WEIGHT in per cent and a REASON from a fixed
--       list (tci.rating_scorecard_reasons), plus an optional comment. The
--       weights of the graded pillars sum to 100; the database computes the
--       WEIGHTED grade (the scale's position A1 = 1 … D = 7, weighted mean,
--       a half rounds to the WORSE grade). The overall grade is the weighted
--       one or an adjustment of it; the overall reason comes from a fixed
--       list — `consistent_with_subgrades` exactly when the grade is the
--       weighted one, an upgrade reason only above it, a downgrade reason
--       only below it — and the free-text justification stays required
--       (rating_proposals.reason).
--       * tci.submit_rating_scorecard(entity, scorecard, justification, route,
--         colleague?, assessment?, statement?) is the entry point; it hands
--         the normalised scorecard to submit_rating (0078) through the
--         transaction-local setting `tci.rating_scorecard`.
--       * A BEFORE INSERT trigger on rating_proposals stores it
--         (rating_proposals.scorecard, normalised again) and REFUSES a
--         proposal without one (`rating_scorecard_required`).
--       * The default weights are admin's (workflow_settings.
--         rating_pillar_weights, 25 / 30 / 25 / 20); the rater may change
--         them per rating.
--       * tci.rating_scorecard_of(assessment) finds the scorecard behind a
--         grade in force (security invoker: the credit desk's RLS decides).
-- Why:  one grade with one sentence of reasoning did not show HOW the analyst
--       got there; a grade composed from pillars with standard reasons is
--       comparable across analysts and reviewable by the colleague or the
--       level that confirms it.
-- Applied AT MERGE: from this migration on a proposal without a scorecard is
-- refused, and the screens deployed before it send none.
-- Nothing is removed: submit_rating and propose_rating keep their bodies and
-- signatures; the table gains a column.

-- ---------------------------------------------------------------------------
-- 1. The scale, the pillars and the reasons
-- ---------------------------------------------------------------------------

-- The grades of the scale, best first (credit_engine GRADE_BANDS; mirrored by
-- src/lib/gradeCatalogue.ts, both contract-tested).
create or replace function tci.rating_scale_codes()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D']
$$;

create or replace function tci.rating_scorecard_pillars()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['general', 'balance_sheet', 'profit_loss', 'payment']
$$;

-- The standard reasons. A pillar reason is `pos`, `neg` or `neutral`;
-- `not_assessed` (`na`) is the reason of a pillar left without a grade.
-- The overall reasons are `consistent`, `up`, `down` or `either`.
-- src/features/entities/rating/scorecard.ts mirrors this list (contract-tested).
create or replace function tci.rating_scorecard_reasons()
returns table (pillar text, code text, polarity text)
language sql
immutable
set search_path = ''
as $$
  values
    ('general',       'long_track_record',            'pos'),
    ('general',       'strong_group_support',         'pos'),
    ('general',       'experienced_management',       'pos'),
    ('general',       'strong_market_position',       'pos'),
    ('general',       'diversified_customer_base',    'pos'),
    ('general',       'short_track_record',           'neg'),
    ('general',       'opaque_ownership',             'neg'),
    ('general',       'key_person_dependency',        'neg'),
    ('general',       'weak_market_position',         'neg'),
    ('general',       'customer_concentration',       'neg'),
    ('general',       'adverse_information',          'neg'),
    ('general',       'difficult_sector_or_country',  'neg'),
    ('general',       'limited_information',          'neutral'),
    ('general',       'in_line_with_peers',           'neutral'),
    ('general',       'not_assessed',                 'na'),
    ('balance_sheet', 'strong_equity_base',           'pos'),
    ('balance_sheet', 'low_leverage',                 'pos'),
    ('balance_sheet', 'strong_liquidity',             'pos'),
    ('balance_sheet', 'sound_working_capital',        'pos'),
    ('balance_sheet', 'thin_equity',                  'neg'),
    ('balance_sheet', 'negative_equity',              'neg'),
    ('balance_sheet', 'high_leverage',                'neg'),
    ('balance_sheet', 'tight_liquidity',              'neg'),
    ('balance_sheet', 'stretched_working_capital',    'neg'),
    ('balance_sheet', 'weak_asset_quality',           'neg'),
    ('balance_sheet', 'outdated_statements',          'neutral'),
    ('balance_sheet', 'in_line_with_peers',           'neutral'),
    ('balance_sheet', 'not_assessed',                 'na'),
    ('profit_loss',   'revenue_growth',               'pos'),
    ('profit_loss',   'solid_profitability',          'pos'),
    ('profit_loss',   'strong_interest_cover',        'pos'),
    ('profit_loss',   'stable_results',               'pos'),
    ('profit_loss',   'revenue_decline',              'neg'),
    ('profit_loss',   'margin_pressure',              'neg'),
    ('profit_loss',   'loss_making',                  'neg'),
    ('profit_loss',   'weak_interest_cover',          'neg'),
    ('profit_loss',   'volatile_results',             'neg'),
    ('profit_loss',   'one_off_items',                'neutral'),
    ('profit_loss',   'in_line_with_peers',           'neutral'),
    ('profit_loss',   'not_assessed',                 'na'),
    ('payment',       'prompt_payment',               'pos'),
    ('payment',       'no_negative_experience',       'pos'),
    ('payment',       'good_trade_references',        'pos'),
    ('payment',       'payment_delays',               'neg'),
    ('payment',       'overdue_notifications',        'neg'),
    ('payment',       'claims_history',               'neg'),
    ('payment',       'collection_or_court_cases',    'neg'),
    ('payment',       'limited_payment_experience',   'neutral'),
    ('payment',       'not_assessed',                 'na'),
    ('overall',       'consistent_with_subgrades',    'consistent'),
    ('overall',       'group_support',                'up'),
    ('overall',       'positive_recent_developments', 'up'),
    ('overall',       'group_weakness',               'down'),
    ('overall',       'country_or_sector_risk',       'down'),
    ('overall',       'negative_recent_developments', 'down'),
    ('overall',       'limited_information',          'down'),
    ('overall',       'payment_behaviour',            'down'),
    ('overall',       'analyst_judgement',            'either')
$$;

-- Admin's default weights: the four pillars, whole per cents, summing to 100.
create or replace function tci.rating_pillar_weights_valid(p_weights jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_key text;
  v_val jsonb;
begin
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p_weights)) <> cardinality(tci.rating_scorecard_pillars()) then
    return false;
  end if;
  for v_key, v_val in select k, v from jsonb_each(p_weights) e(k, v) loop
    if not v_key = any (tci.rating_scorecard_pillars()) or jsonb_typeof(v_val) <> 'number'
       or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric not between 0 and 100 then
      return false;
    end if;
    v_sum := v_sum + (v_val #>> '{}')::integer;
  end loop;
  return v_sum = 100;
end;
$$;

alter table tci.workflow_settings
  add column if not exists rating_pillar_weights jsonb not null
    default '{"general": 25, "balance_sheet": 30, "profit_loss": 25, "payment": 20}'::jsonb
    check (tci.rating_pillar_weights_valid(rating_pillar_weights));
comment on column tci.workflow_settings.rating_pillar_weights is
  'Default weights (per cent) of the rating scorecard pillars, summing to 100 (0079); the rater may change them per rating.';

-- ---------------------------------------------------------------------------
-- 2. The scorecard, checked and completed by the database
-- ---------------------------------------------------------------------------

-- Takes what the screen sent and returns the stored form:
--   {version, pillars: [{pillar, grade, weight, reason, comment}] in the fixed
--    order, weighted_value, weighted_grade, grade, reason}
-- p_grade is the grade the proposal carries; the scorecard's grade must be it.
create or replace function tci.rating_scorecard_normalised(p_card jsonb, p_grade text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_codes    text[] := tci.rating_scale_codes();
  v_pillar   text;
  v_in       jsonb;
  v_grade    text;
  v_weight   numeric;
  v_reason   text;
  v_comment  text;
  v_out      jsonb := '[]'::jsonb;
  v_sum_w    numeric := 0;
  v_sum_gw   numeric := 0;
  v_value    numeric;
  v_weighted text;
  v_final    text;
  v_overall  text;
  v_polarity text;
  v_pos_w    integer;
  v_pos_f    integer;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' or jsonb_typeof(p_card -> 'pillars') <> 'array' then
    raise exception 'rating_scorecard_invalid: the scorecard must list its pillars' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_card -> 'pillars') <> cardinality(tci.rating_scorecard_pillars())
     or exists (select 1 from jsonb_array_elements(p_card -> 'pillars') e
                 where jsonb_typeof(e) <> 'object' or not (e ->> 'pillar') = any (tci.rating_scorecard_pillars()))
     or (select count(distinct e ->> 'pillar') from jsonb_array_elements(p_card -> 'pillars') e)
        <> cardinality(tci.rating_scorecard_pillars()) then
    raise exception 'rating_scorecard_invalid: every pillar exactly once (%)',
      array_to_string(tci.rating_scorecard_pillars(), ', ') using errcode = 'P0001';
  end if;

  foreach v_pillar in array tci.rating_scorecard_pillars() loop
    select e into v_in from jsonb_array_elements(p_card -> 'pillars') e where e ->> 'pillar' = v_pillar;
    v_grade   := nullif(upper(btrim(coalesce(v_in ->> 'grade', ''))), '');
    v_reason  := nullif(btrim(coalesce(v_in ->> 'reason', '')), '');
    v_comment := nullif(btrim(coalesce(v_in ->> 'comment', '')), '');
    if jsonb_typeof(v_in -> 'weight') is distinct from 'number' then
      raise exception 'rating_scorecard_weights: the weight of % must be a whole per cent', v_pillar using errcode = 'P0001';
    end if;
    v_weight := (v_in ->> 'weight')::numeric;
    if v_weight <> trunc(v_weight) or v_weight not between 0 and 100 then
      raise exception 'rating_scorecard_weights: the weight of % must be a whole per cent', v_pillar using errcode = 'P0001';
    end if;
    if v_comment is not null and length(v_comment) > 500 then
      raise exception 'rating_scorecard_invalid: the comment on % is longer than 500 characters', v_pillar using errcode = 'P0001';
    end if;

    if v_grade is null then
      -- Not assessed: no weight, and the reason says so.
      if v_weight <> 0 then
        raise exception 'rating_scorecard_weights: % is not graded, so it carries no weight', v_pillar using errcode = 'P0001';
      end if;
      v_reason := 'not_assessed';
    else
      if not v_grade = any (v_codes) then
        raise exception 'rating_scorecard_grade_invalid: % is not a grade of the scale', v_grade using errcode = 'P0001';
      end if;
      if v_weight = 0 then
        raise exception 'rating_scorecard_weights: % is graded, so it needs a weight', v_pillar using errcode = 'P0001';
      end if;
      if v_reason is null or not exists (
           select 1 from tci.rating_scorecard_reasons() r
            where r.pillar = v_pillar and r.code = v_reason and r.polarity <> 'na') then
        raise exception 'rating_scorecard_reason_invalid: % needs a reason from its list', v_pillar using errcode = 'P0001';
      end if;
      v_sum_w  := v_sum_w + v_weight;
      v_sum_gw := v_sum_gw + v_weight * array_position(v_codes, v_grade);
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'pillar', v_pillar, 'grade', v_grade, 'weight', v_weight::integer,
      'reason', v_reason, 'comment', v_comment));
  end loop;

  if v_sum_w = 0 then
    raise exception 'rating_scorecard_empty: grade at least one pillar' using errcode = 'P0001';
  end if;
  if v_sum_w <> 100 then
    raise exception 'rating_scorecard_weights: the weights of the graded pillars add up to % %%, not 100 %%', v_sum_w
      using errcode = 'P0001';
  end if;

  -- The weighted grade: the mean position on the scale; a half goes to the
  -- worse grade (prudence).
  v_value    := v_sum_gw / v_sum_w;
  v_pos_w    := least(greatest(floor(v_value + 0.5)::integer, 1), cardinality(v_codes));
  v_weighted := v_codes[v_pos_w];

  v_final   := nullif(upper(btrim(coalesce(p_card ->> 'grade', ''))), '');
  v_overall := nullif(btrim(coalesce(p_card ->> 'reason', '')), '');
  if v_final is null or not v_final = any (v_codes) then
    raise exception 'rating_scorecard_grade_invalid: % is not a grade of the scale', coalesce(v_final, '') using errcode = 'P0001';
  end if;
  if v_final is distinct from tci.rating_grade_normalised(p_grade) then
    raise exception 'rating_scorecard_grade_mismatch: the scorecard says % but the proposal %', v_final, coalesce(p_grade, '')
      using errcode = 'P0001';
  end if;
  select r.polarity into v_polarity from tci.rating_scorecard_reasons() r
   where r.pillar = 'overall' and r.code = v_overall;
  if v_polarity is null then
    raise exception 'rating_scorecard_reason_invalid: the overall grade needs a reason from its list' using errcode = 'P0001';
  end if;
  v_pos_f := array_position(v_codes, v_final);
  if (v_pos_f = v_pos_w) <> (v_polarity = 'consistent')
     or (v_polarity = 'up' and v_pos_f >= v_pos_w)
     or (v_polarity = 'down' and v_pos_f <= v_pos_w) then
    raise exception 'rating_scorecard_adjustment_reason: % against the weighted % needs a reason that says so', v_final, v_weighted
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'version', 1,
    'pillars', v_out,
    'weighted_value', round(v_value, 2),
    'weighted_grade', v_weighted,
    'grade', v_final,
    'reason', v_overall);
end;
$$;

alter table tci.rating_proposals
  add column if not exists scorecard jsonb;
comment on column tci.rating_proposals.scorecard is
  'The sub-grades the proposed grade was built from (0079): pillars with grade, weight and reason, the weighted grade and the overall reason. NULL only on proposals made before 0079.';

-- Every new proposal carries its scorecard; submit_rating_scorecard hands it
-- over in the transaction-local setting and this takes it, once.
create or replace function tci.attach_rating_scorecard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_raw text := nullif(current_setting('tci.rating_scorecard', true), '');
begin
  if v_raw is null then
    raise exception 'rating_scorecard_required: a grade is set from its sub-grades — fill in the scorecard'
      using errcode = 'P0001';
  end if;
  new.scorecard := tci.rating_scorecard_normalised(v_raw::jsonb, new.proposed_grade);
  perform set_config('tci.rating_scorecard', '', true);
  return new;
end;
$$;

create trigger rating_proposals_scorecard before insert on tci.rating_proposals
  for each row execute function tci.attach_rating_scorecard();

-- ---------------------------------------------------------------------------
-- 3. The entry point and the readers
-- ---------------------------------------------------------------------------

create or replace function tci.submit_rating_scorecard(
  p_entity_id uuid,
  p_scorecard jsonb,
  p_reason text,
  p_route text,
  p_colleague uuid default null,
  p_assessment_id uuid default null,
  p_statement_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card jsonb;
begin
  perform tci.require_staff();
  -- Checked here so a wrong scorecard is refused before anything else; the
  -- insert trigger checks it again against the proposal it lands on.
  v_card := tci.rating_scorecard_normalised(p_scorecard, p_scorecard ->> 'grade');
  perform set_config('tci.rating_scorecard', v_card::text, true);
  return tci.submit_rating(p_entity_id, v_card ->> 'grade', p_reason, p_route, p_colleague,
                           p_assessment_id, p_statement_id);
end;
$$;

-- The scorecard behind a grade in force: the proposal a step's approval
-- turned into this assessment, or a proposal its rater approved alone (on
-- this engine rating, or as this manual one — written in the same
-- transaction). SECURITY INVOKER: whoever may not read proposals gets NULL.
create or replace function tci.rating_scorecard_of(p_assessment_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select p.scorecard || jsonb_build_object('proposal_id', p.id, 'proposed_grade', p.proposed_grade,
                                           'justification', p.reason, 'proposed_at', p.created_at)
    from tci.credit_assessments a
    join tci.rating_proposals p on p.entity_id = a.entity_id
   where a.id = p_assessment_id
     and p.scorecard is not null
     and (exists (select 1 from tci.rating_proposal_steps s
                   where s.proposal_id = p.id and s.result_assessment_id = a.id)
          or (p.self_approved
              and (p.assessment_id = a.id
                   or (p.assessment_id is null and a.source = 'manual'
                       and a.created_by = p.proposed_by and a.created_at = p.created_at))))
   -- A step that wrote this very assessment first; then the latest.
   order by exists (select 1 from tci.rating_proposal_steps s
                     where s.proposal_id = p.id and s.result_assessment_id = a.id) desc,
            p.created_at desc
   limit 1
$$;

-- The default weights, for the scorecard form.
create or replace function tci.rating_scorecard_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- SECURITY DEFINER: workflow_settings is not readable by every role.
  perform tci.require_staff();
  return jsonb_build_object(
    'weights', coalesce((select s.rating_pillar_weights from tci.workflow_settings s where s.id),
                        '{"general": 25, "balance_sheet": 30, "profit_loss": 25, "payment": 20}'::jsonb));
end;
$$;

create or replace function tci.set_rating_pillar_weights(p_weights jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A technical setting, like the credit analysis mode: admin's.
  perform tci.require_role('admin');
  if not tci.rating_pillar_weights_valid(p_weights) then
    raise exception 'rating_scorecard_weights: the default weights are four whole per cents adding up to 100'
      using errcode = 'P0001';
  end if;
  update tci.workflow_settings
     set rating_pillar_weights = p_weights,
         updated_by = (select auth.uid()), updated_at = now()
   where id;
  return tci.rating_scorecard_settings();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants and assertions
-- ---------------------------------------------------------------------------

revoke all on function tci.rating_scale_codes() from public, anon;
revoke all on function tci.rating_scorecard_pillars() from public, anon;
revoke all on function tci.rating_scorecard_reasons() from public, anon;
revoke all on function tci.rating_pillar_weights_valid(jsonb) from public, anon;
revoke all on function tci.rating_scorecard_normalised(jsonb, text) from public, anon;
revoke all on function tci.attach_rating_scorecard() from public, anon, authenticated;
revoke all on function tci.submit_rating_scorecard(uuid, jsonb, text, text, uuid, uuid, uuid) from public, anon;
revoke all on function tci.rating_scorecard_of(uuid) from public, anon;
revoke all on function tci.rating_scorecard_settings() from public, anon;
revoke all on function tci.set_rating_pillar_weights(jsonb) from public, anon;
grant execute on function tci.rating_scale_codes() to authenticated, service_role;
grant execute on function tci.rating_scorecard_pillars() to authenticated, service_role;
grant execute on function tci.rating_scorecard_reasons() to authenticated, service_role;
grant execute on function tci.rating_pillar_weights_valid(jsonb) to authenticated, service_role;
grant execute on function tci.rating_scorecard_normalised(jsonb, text) to authenticated, service_role;
grant execute on function tci.submit_rating_scorecard(uuid, jsonb, text, text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function tci.rating_scorecard_of(uuid) to authenticated, service_role;
grant execute on function tci.rating_scorecard_settings() to authenticated, service_role;
grant execute on function tci.set_rating_pillar_weights(jsonb) to authenticated, service_role;

do $$
declare
  v_bad  text;
  v_card jsonb;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('submit_rating_scorecard', 'rating_scorecard_settings', 'set_rating_pillar_weights')
     and p.prosrc !~ 'perform tci\.require_(staff|role|staff_or_internal)\(';
  if v_bad is not null then
    raise exception '0079: ungated: %', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace
     and p.proname in ('rating_scale_codes', 'rating_scorecard_pillars', 'rating_scorecard_reasons',
                       'rating_pillar_weights_valid', 'rating_scorecard_normalised', 'attach_rating_scorecard',
                       'submit_rating_scorecard', 'rating_scorecard_of', 'rating_scorecard_settings',
                       'set_rating_pillar_weights')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0079: anon can execute %', v_bad;
  end if;

  -- Every pillar has «not assessed» and some reason of each kind; no code twice.
  if exists (select r.pillar, r.code from tci.rating_scorecard_reasons() r group by 1, 2 having count(*) > 1)
     or exists (select 1 from unnest(tci.rating_scorecard_pillars()) p
                 where not exists (select 1 from tci.rating_scorecard_reasons() r where r.pillar = p and r.polarity = 'na')
                    or not exists (select 1 from tci.rating_scorecard_reasons() r where r.pillar = p and r.polarity = 'pos')
                    or not exists (select 1 from tci.rating_scorecard_reasons() r where r.pillar = p and r.polarity = 'neg')) then
    raise exception '0079: the reason catalogue is incomplete';
  end if;
  if not tci.rating_pillar_weights_valid((select s.rating_pillar_weights from tci.workflow_settings s where s.id)) then
    raise exception '0079: the default weights are not valid';
  end if;

  -- The arithmetic: B1 (3) × 25 + B2 (4) × 30 + B1 (3) × 25 + C1 (5) × 20 = 3.70 → B2;
  -- a half (3.5) goes to the worse grade.
  v_card := tci.rating_scorecard_normalised(jsonb_build_object(
    'grade', 'B2', 'reason', 'consistent_with_subgrades',
    'pillars', jsonb_build_array(
      jsonb_build_object('pillar', 'general', 'grade', 'B1', 'weight', 25, 'reason', 'long_track_record'),
      jsonb_build_object('pillar', 'balance_sheet', 'grade', 'B2', 'weight', 30, 'reason', 'high_leverage'),
      jsonb_build_object('pillar', 'profit_loss', 'grade', 'B1', 'weight', 25, 'reason', 'stable_results'),
      jsonb_build_object('pillar', 'payment', 'grade', 'C1', 'weight', 20, 'reason', 'payment_delays'))), 'B2');
  if v_card ->> 'weighted_grade' <> 'B2' or (v_card ->> 'weighted_value')::numeric <> 3.70 then
    raise exception '0079: weighted grade %', v_card;
  end if;
  v_card := tci.rating_scorecard_normalised(jsonb_build_object(
    'grade', 'B2', 'reason', 'consistent_with_subgrades',
    'pillars', jsonb_build_array(
      jsonb_build_object('pillar', 'general', 'grade', 'B1', 'weight', 50, 'reason', 'long_track_record'),
      jsonb_build_object('pillar', 'balance_sheet', 'grade', 'B2', 'weight', 50, 'reason', 'high_leverage'),
      jsonb_build_object('pillar', 'profit_loss', 'grade', null, 'weight', 0),
      jsonb_build_object('pillar', 'payment', 'weight', 0))), 'B2');
  if v_card ->> 'weighted_grade' <> 'B2' or v_card -> 'pillars' -> 3 ->> 'reason' <> 'not_assessed' then
    raise exception '0079: a half must go to the worse grade: %', v_card;
  end if;
end;
$$;
