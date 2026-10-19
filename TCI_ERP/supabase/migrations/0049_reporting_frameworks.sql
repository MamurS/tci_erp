-- What: reporting frameworks per country. A country now points at the
--       accounting framework its companies file statutory accounts under
--       (tci.country_reporting_frameworks -> tci.reporting_frameworks), and a
--       framework owns the statement templates (Russia's RAS forms, the EU
--       Directive layout shared by twenty-seven countries, ...). The local
--       form's own arithmetic (subtotal formulas), its cross-checks against
--       the computed IFRS totals and its deduction lines move from TypeScript
--       constants into the template rows, so a new country is DATA ONLY.
--       Countries whose statutory accounts are IFRS or IFRS-converged with no
--       separate form (Kyrgyzstan, Mongolia, Nepal, ...) are linked too, and
--       are entered directly on the IFRS form under their own label.
--       tci.seed_statement_framework(jsonb) loads one framework document
--       (owner-only); it is idempotent and never removes or re-keys a line,
--       so values already entered against UZ NAS keep their line ids.
-- Why:  the manual entry form must follow the buyer's country, and the
--       Uzbek-only design hard-coded both the template choice
--       (country_code) and the cross-check tables (mapping.ts). Statements
--       are still analysed and shown in IFRS everywhere; the local form is
--       only how they are typed in and kept as the audit trail.
--
-- Also fixes a latent false warning: UZ NAS line 770 was cross-checked to
-- IFRS total liabilities, but line 470 (provisions shown in equity) is
-- reclassified to liabilities under IFRS, so any statement with a 470 amount
-- warned. 400 and 780 still reconcile and stay checked.

-- ---------------------------------------------------------------------------
-- 1. Frameworks and the country link
-- ---------------------------------------------------------------------------
create table tci.reporting_frameworks (
  code        text primary key check (code ~ '^[A-Z0-9_]+$'),
  -- ifrs:          statutory accounts ARE IFRS (or IFRS for SMEs); entered on the IFRS form
  -- ifrs_based:    a national standard converged with IFRS but with its own prescribed form
  -- national_gaap: a national GAAP with its own form
  kind        text not null check (kind in ('ifrs', 'ifrs_based', 'national_gaap')),
  short_en    text not null,
  short_ru    text not null,
  short_uz    text not null,
  name_en     text not null,
  name_ru     text not null,
  name_uz     text not null,
  legal_basis text,
  is_active   boolean not null default true
);
comment on table tci.reporting_frameworks is
  'Accounting frameworks under which buyers file statutory accounts. A framework with templates gets its own entry form; kind = ifrs is entered on the IFRS form.';

create table tci.country_reporting_frameworks (
  country_code   char(2) primary key references tci.countries (code),
  framework_code text not null references tci.reporting_frameworks (code)
);
comment on table tci.country_reporting_frameworks is
  'Which framework a country''s companies report under. A country with no row is entered on the IFRS form.';

-- ---------------------------------------------------------------------------
-- 2. Templates belong to a framework; lines carry their own arithmetic
-- ---------------------------------------------------------------------------
alter table tci.statement_templates
  alter column country_code drop not null,
  add column framework_code text references tci.reporting_frameworks (code),
  add column fidelity text check (fidelity in ('official_codes', 'prescribed_captions', 'framework_layout')),
  add column local_language text,
  add column name_local text;
comment on column tci.statement_templates.fidelity is
  'official_codes: line codes are the statutory form''s own; prescribed_captions: captions prescribed by law, codes assigned; framework_layout: customary layout, nothing prescribed.';

alter table tci.statement_template_lines
  add column name_local text,
  add column is_deduction boolean not null default false,
  add column formula jsonb,
  add column crosscheck_column text,
  add column note text,
  add constraint statement_template_lines_section check (section in (
    'assets_long_term', 'assets_current', 'equity', 'liabilities_long_term', 'liabilities_current',
    'operating', 'financial', 'result')),
  add constraint statement_template_lines_formula check (
    formula is null or (jsonb_typeof(formula -> 'plus') = 'array' and jsonb_typeof(formula -> 'minus') = 'array')),
  add constraint statement_template_lines_crosscheck check (
    crosscheck_column is null or crosscheck_column in ('total_non_current_assets', 'total_current_assets', 'total_assets', 'total_equity', 'total_non_current_liabilities', 'total_current_liabilities', 'total_liabilities', 'total_equity_and_liabilities', 'gross_profit', 'operating_profit', 'profit_before_tax', 'net_profit'));
comment on column tci.statement_template_lines.is_deduction is
  'The form prints this line in parentheses or with a minus: it is typed as a positive amount and subtracted by the formulas.';
comment on column tci.statement_template_lines.formula is
  'The form''s own arithmetic for this line: {"plus": [line codes], "minus": [line codes]}. Checked live as an amber warning.';
comment on column tci.statement_template_lines.crosscheck_column is
  'The computed IFRS total this local total must agree with after mapping (amber warning when it does not).';

alter table tci.ifrs_mappings
  add constraint ifrs_mappings_target_column check (
    (target_table = 'balance_sheet' and target_column in ('property_plant_equipment', 'intangible_assets', 'goodwill', 'investment_property', 'long_term_investments', 'deferred_tax_assets', 'other_non_current_assets', 'inventories', 'trade_receivables', 'other_receivables', 'short_term_investments', 'cash_and_equivalents', 'other_current_assets', 'share_capital', 'retained_earnings', 'other_reserves', 'non_controlling_interests', 'long_term_borrowings', 'deferred_tax_liabilities', 'long_term_provisions', 'other_non_current_liabilities', 'short_term_borrowings', 'trade_payables', 'other_payables', 'current_tax_liabilities', 'short_term_provisions', 'other_current_liabilities'))
    or (target_table = 'income_statement' and target_column in ('revenue', 'cost_of_sales', 'distribution_expenses', 'administrative_expenses', 'other_operating_income', 'other_operating_expenses', 'finance_income', 'finance_costs', 'other_non_operating', 'income_tax', 'depreciation_amortization')));

-- ---------------------------------------------------------------------------
-- 3. RLS: reference data, staff read, admin write
-- ---------------------------------------------------------------------------
alter table tci.reporting_frameworks enable row level security;
alter table tci.country_reporting_frameworks enable row level security;

create policy "reporting_frameworks: staff read" on tci.reporting_frameworks
  for select to authenticated using (tci.is_staff());
create policy "reporting_frameworks: admin write" on tci.reporting_frameworks
  for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));
create policy "country_reporting_frameworks: staff read" on tci.country_reporting_frameworks
  for select to authenticated using (tci.is_staff());
create policy "country_reporting_frameworks: admin write" on tci.country_reporting_frameworks
  for all to authenticated
  using (tci.has_role('admin')) with check (tci.has_role('admin'));

grant select, insert, update on tci.reporting_frameworks, tci.country_reporting_frameworks to authenticated;
grant all on tci.reporting_frameworks, tci.country_reporting_frameworks to service_role;

-- ---------------------------------------------------------------------------
-- 4. The loader (owner-only: migrations call it, no API role can)
-- ---------------------------------------------------------------------------
create function tci.seed_statement_framework(p jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  fw      jsonb := p -> 'framework';
  t       jsonb;
  l       jsonb;
  c       text;
  v_tpl   uuid;
  v_line  uuid;
  v_order int;
  v_single char(2);
begin
  insert into tci.reporting_frameworks (code, kind, short_en, short_ru, short_uz, name_en, name_ru, name_uz, legal_basis)
  values (fw ->> 'code', fw ->> 'kind', fw -> 'short' ->> 'en', fw -> 'short' ->> 'ru', fw -> 'short' ->> 'uz',
          fw -> 'name' ->> 'en', fw -> 'name' ->> 'ru', fw -> 'name' ->> 'uz', fw ->> 'legal_basis')
  on conflict (code) do update
    set kind = excluded.kind, short_en = excluded.short_en, short_ru = excluded.short_ru,
        short_uz = excluded.short_uz, name_en = excluded.name_en, name_ru = excluded.name_ru,
        name_uz = excluded.name_uz, legal_basis = excluded.legal_basis;

  for c in select jsonb_array_elements_text(coalesce(fw -> 'countries', '[]'::jsonb)) loop
    insert into tci.country_reporting_frameworks (country_code, framework_code)
    values (c, fw ->> 'code')
    on conflict (country_code) do update set framework_code = excluded.framework_code;
  end loop;

  -- A template keeps a country only when exactly one country files on it.
  v_single := case when jsonb_array_length(coalesce(fw -> 'countries', '[]'::jsonb)) = 1
                   then fw -> 'countries' ->> 0 end;

  for t in select jsonb_array_elements(coalesce(p -> 'templates', '[]'::jsonb)) loop
    insert into tci.statement_templates
      (country_code, form_kind, code, name_en, name_ru, name_uz, name_local,
       framework_code, fidelity, local_language)
    values
      (v_single, (t ->> 'form_kind')::tci.form_kind, t ->> 'code',
       t -> 'name' ->> 'en', t -> 'name' ->> 'ru', t -> 'name' ->> 'uz', t -> 'name' ->> 'local',
       fw ->> 'code', t ->> 'fidelity', t ->> 'local_language')
    on conflict (code) do update
      set name_en = excluded.name_en, name_ru = excluded.name_ru, name_uz = excluded.name_uz,
          name_local = excluded.name_local, framework_code = excluded.framework_code,
          fidelity = excluded.fidelity, local_language = excluded.local_language
    returning id into v_tpl;

    v_order := 0;
    for l in select jsonb_array_elements(t -> 'lines') loop
      v_order := v_order + 10;
      insert into tci.statement_template_lines
        (template_id, line_code, name_en, name_ru, name_uz, name_local, section, display_order,
         is_subtotal, indent_level, is_deduction, formula, crosscheck_column, note)
      values
        (v_tpl, l ->> 'code', l -> 'name' ->> 'en', l -> 'name' ->> 'ru', l -> 'name' ->> 'uz',
         l -> 'name' ->> 'local', l ->> 'section', v_order,
         coalesce((l ->> 'subtotal')::boolean, false), coalesce((l ->> 'indent')::int, 0),
         coalesce((l ->> 'negative')::boolean, false),
         case when jsonb_typeof(l -> 'formula') = 'object' then l -> 'formula' end,
         nullif(l ->> 'check', ''), nullif(l ->> 'note', ''))
      on conflict (template_id, line_code) do update
        set name_en = excluded.name_en, name_ru = excluded.name_ru, name_uz = excluded.name_uz,
            name_local = excluded.name_local, section = excluded.section,
            display_order = excluded.display_order, is_subtotal = excluded.is_subtotal,
            indent_level = excluded.indent_level, is_deduction = excluded.is_deduction,
            formula = excluded.formula, crosscheck_column = excluded.crosscheck_column,
            note = excluded.note
      returning id into v_line;

      if jsonb_typeof(l -> 'map') = 'object' then
        insert into tci.ifrs_mappings (template_line_id, target_table, target_column, sign, note)
        values (v_line, (t ->> 'form_kind')::tci.ifrs_target_table, l -> 'map' ->> 'column',
                (l -> 'map' ->> 'sign')::int, nullif(l ->> 'note', ''))
        on conflict (template_line_id) do update
          set target_table = excluded.target_table, target_column = excluded.target_column,
              sign = excluded.sign, note = excluded.note;
      end if;
    end loop;
  end loop;
end;
$$;
comment on function tci.seed_statement_framework(jsonb) is
  'Migration-only loader for one framework document (see TCI_ERP/supabase/frameworks/README.md). Idempotent; never removes or re-keys a line.';
revoke all on function tci.seed_statement_framework(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Uzbekistan: the same lines and mappings, now with their arithmetic,
--    cross-checks, deduction flags and U+2018 apostrophes in the uz names
-- ---------------------------------------------------------------------------
select tci.seed_statement_framework($fw${"framework":{"code":"UZ_NAS","kind":"national_gaap","short":{"en":"UZ NAS","ru":"НСБУ РУз","uz":"O‘z BHMS"},"name":{"en":"Uzbekistan National Accounting Standards","ru":"Национальные стандарты бухгалтерского учёта Республики Узбекистан","uz":"O‘zbekiston Respublikasi buxgalteriya hisobining milliy standartlari"},"legal_basis":"Приказ Минфина РУз (НСБУ №15), формы №1 и №2","countries":["UZ"]},"templates":[{"code":"UZ_NAS_F1","form_kind":"balance_sheet","fidelity":"official_codes","local_language":"uz","name":{"en":"Balance sheet (UZ NAS, Form 1)","ru":"Бухгалтерский баланс (форма №1)","uz":"Buxgalteriya balansi (1-shakl)","local":"Buxgalteriya balansi (1-shakl)"},"lines":[{"code":"010","section":"assets_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"PP&E: initial (revalued) cost","ru":"Основные средства: первоначальная (восстановительная) стоимость","uz":"Asosiy vositalar: boshlang‘ich (qayta tiklash) qiymati","local":"Asosiy vositalar: boshlang‘ich (qayta tiklash) qiymati"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"011","section":"assets_long_term","indent":1,"subtotal":false,"negative":true,"name":{"en":"PP&E: accumulated depreciation","ru":"Основные средства: износ","uz":"Asosiy vositalar: eskirish summasi","local":"Asosiy vositalar: eskirish summasi"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"012","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"PP&E: net book value","ru":"Основные средства: остаточная стоимость","uz":"Asosiy vositalar: qoldiq qiymati","local":"Asosiy vositalar: qoldiq qiymati"},"map":{"column":"property_plant_equipment","sign":1},"formula":{"plus":["010"],"minus":["011"]},"check":null,"note":"net book value; 010/011 gross and depreciation are memo lines"},{"code":"020","section":"assets_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Intangible assets: initial cost","ru":"Нематериальные активы: первоначальная стоимость","uz":"Nomoddiy aktivlar: boshlang‘ich qiymati","local":"Nomoddiy aktivlar: boshlang‘ich qiymati"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"021","section":"assets_long_term","indent":1,"subtotal":false,"negative":true,"name":{"en":"Intangible assets: amortization","ru":"Нематериальные активы: амортизация","uz":"Nomoddiy aktivlar: amortizatsiya summasi","local":"Nomoddiy aktivlar: amortizatsiya summasi"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"022","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"Intangible assets: net book value","ru":"Нематериальные активы: остаточная стоимость","uz":"Nomoddiy aktivlar: qoldiq qiymati","local":"Nomoddiy aktivlar: qoldiq qiymati"},"map":{"column":"intangible_assets","sign":1},"formula":{"plus":["020"],"minus":["021"]},"check":null,"note":"net book value; 020/021 are memo lines"},{"code":"030","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"Long-term investments, total","ru":"Долгосрочные инвестиции, всего","uz":"Uzoq muddatli investitsiyalar, jami","local":"Uzoq muddatli investitsiyalar, jami"},"map":{"column":"long_term_investments","sign":1},"formula":{"plus":["040","050","060","070"],"minus":[]},"check":null,"note":"total mapped; 040-070 breakdown is informational to avoid double counting"},{"code":"040","section":"assets_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Securities","ru":"Ценные бумаги","uz":"Qimmatli qog‘ozlar","local":"Qimmatli qog‘ozlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"050","section":"assets_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Investments in subsidiaries","ru":"Инвестиции в дочерние хозяйственные общества","uz":"Sho‘ba xo‘jalik jamiyatlariga investitsiyalar","local":"Sho‘ba xo‘jalik jamiyatlariga investitsiyalar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"060","section":"assets_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Investments in associates","ru":"Инвестиции в зависимые хозяйственные общества","uz":"Qaram xo‘jalik jamiyatlariga investitsiyalar","local":"Qaram xo‘jalik jamiyatlariga investitsiyalar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"070","section":"assets_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Other long-term investments","ru":"Прочие долгосрочные инвестиции","uz":"Boshqa uzoq muddatli investitsiyalar","local":"Boshqa uzoq muddatli investitsiyalar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"080","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"Equipment for installation","ru":"Оборудование к установке","uz":"O‘rnatiladigan asbob-uskunalar","local":"O‘rnatiladigan asbob-uskunalar"},"map":{"column":"property_plant_equipment","sign":1},"formula":null,"check":null,"note":"equipment for installation treated as PP&E (IAS 16 assets under construction)"},{"code":"090","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"Capital investments (CWIP)","ru":"Капитальные вложения","uz":"Kapital qo‘yilmalar","local":"Kapital qo‘yilmalar"},"map":{"column":"property_plant_equipment","sign":1},"formula":null,"check":null,"note":"capital work in progress treated as PP&E (IAS 16)"},{"code":"100","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"Long-term receivables","ru":"Долгосрочная дебиторская задолженность","uz":"Uzoq muddatli debitorlik qarzlari","local":"Uzoq muddatli debitorlik qarzlari"},"map":{"column":"other_non_current_assets","sign":1},"formula":null,"check":null,"note":"long-term receivables"},{"code":"110","section":"assets_long_term","indent":0,"subtotal":false,"negative":false,"name":{"en":"Long-term deferred expenses","ru":"Долгосрочные отсроченные расходы","uz":"Uzoq muddatli kechiktirilgan xarajatlar","local":"Uzoq muddatli kechiktirilgan xarajatlar"},"map":{"column":"other_non_current_assets","sign":1},"formula":null,"check":null,"note":null},{"code":"120","section":"assets_long_term","indent":0,"subtotal":true,"negative":false,"name":{"en":"Total for section I","ru":"Итого по разделу I","uz":"I bo‘lim bo‘yicha jami","local":"I bo‘lim bo‘yicha jami"},"map":null,"formula":{"plus":["012","022","030","080","090","100","110"],"minus":[]},"check":"total_non_current_assets","note":null},{"code":"140","section":"assets_current","indent":0,"subtotal":false,"negative":false,"name":{"en":"Inventories, total","ru":"Товарно-материальные запасы, всего","uz":"Tovar-moddiy zaxiralari, jami","local":"Tovar-moddiy zaxiralari, jami"},"map":{"column":"inventories","sign":1},"formula":{"plus":["150","160","170","180"],"minus":[]},"check":null,"note":"total mapped; 150-180 breakdown is informational"},{"code":"150","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Production inventories","ru":"Производственные запасы","uz":"Ishlab chiqarish zaxiralari","local":"Ishlab chiqarish zaxiralari"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"160","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Work in progress","ru":"Незавершённое производство","uz":"Tugallanmagan ishlab chiqarish","local":"Tugallanmagan ishlab chiqarish"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"170","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Finished goods","ru":"Готовая продукция","uz":"Tayyor mahsulot","local":"Tayyor mahsulot"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"180","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Goods for resale","ru":"Товары","uz":"Tovarlar","local":"Tovarlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"190","section":"assets_current","indent":0,"subtotal":false,"negative":false,"name":{"en":"Prepaid expenses","ru":"Расходы будущих периодов","uz":"Kelgusi davr xarajatlari","local":"Kelgusi davr xarajatlari"},"map":{"column":"other_current_assets","sign":1},"formula":null,"check":null,"note":"prepaid expenses"},{"code":"200","section":"assets_current","indent":0,"subtotal":false,"negative":false,"name":{"en":"Deferred expenses","ru":"Отсроченные расходы","uz":"Kechiktirilgan xarajatlar","local":"Kechiktirilgan xarajatlar"},"map":{"column":"other_current_assets","sign":1},"formula":null,"check":null,"note":null},{"code":"210","section":"assets_current","indent":0,"subtotal":true,"negative":false,"name":{"en":"Receivables, total","ru":"Дебиторы, всего","uz":"Debitorlar, jami","local":"Debitorlar, jami"},"map":null,"formula":{"plus":["230","270","280","310"],"minus":[]},"check":null,"note":null},{"code":"230","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Trade receivables (customers)","ru":"Задолженность покупателей и заказчиков","uz":"Xaridorlar va buyurtmachilarning qarzi","local":"Xaridorlar va buyurtmachilarning qarzi"},"map":{"column":"trade_receivables","sign":1},"formula":null,"check":null,"note":null},{"code":"270","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Advances to suppliers and contractors","ru":"Авансы, выданные поставщикам и подрядчикам","uz":"Mol yetkazib beruvchilar va pudratchilarga berilgan bo‘naklar","local":"Mol yetkazib beruvchilar va pudratchilarga berilgan bo‘naklar"},"map":{"column":"other_receivables","sign":1},"formula":null,"check":null,"note":null},{"code":"280","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Advance payments of taxes and duties","ru":"Авансовые платежи по налогам и сборам","uz":"Soliq va yig‘imlar bo‘yicha bo‘nak to‘lovlari","local":"Soliq va yig‘imlar bo‘yicha bo‘nak to‘lovlari"},"map":{"column":"other_receivables","sign":1},"formula":null,"check":null,"note":null},{"code":"310","section":"assets_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Other receivables","ru":"Прочие дебиторские задолженности","uz":"Boshqa debitorlik qarzlari","local":"Boshqa debitorlik qarzlari"},"map":{"column":"other_receivables","sign":1},"formula":null,"check":null,"note":null},{"code":"320","section":"assets_current","indent":0,"subtotal":false,"negative":false,"name":{"en":"Cash, total","ru":"Денежные средства, всего","uz":"Pul mablag‘lari, jami","local":"Pul mablag‘lari, jami"},"map":{"column":"cash_and_equivalents","sign":1},"formula":null,"check":null,"note":null},{"code":"370","section":"assets_current","indent":0,"subtotal":false,"negative":false,"name":{"en":"Short-term investments","ru":"Краткосрочные инвестиции","uz":"Qisqa muddatli investitsiyalar","local":"Qisqa muddatli investitsiyalar"},"map":{"column":"short_term_investments","sign":1},"formula":null,"check":null,"note":null},{"code":"380","section":"assets_current","indent":0,"subtotal":false,"negative":false,"name":{"en":"Other current assets","ru":"Прочие текущие активы","uz":"Boshqa joriy aktivlar","local":"Boshqa joriy aktivlar"},"map":{"column":"other_current_assets","sign":1},"formula":null,"check":null,"note":null},{"code":"390","section":"assets_current","indent":0,"subtotal":true,"negative":false,"name":{"en":"Total for section II","ru":"Итого по разделу II","uz":"II bo‘lim bo‘yicha jami","local":"II bo‘lim bo‘yicha jami"},"map":null,"formula":{"plus":["140","190","200","210","320","370","380"],"minus":[]},"check":"total_current_assets","note":null},{"code":"400","section":"assets_current","indent":0,"subtotal":true,"negative":false,"name":{"en":"Total assets","ru":"Всего по активу баланса","uz":"Balans aktivi bo‘yicha jami","local":"Balans aktivi bo‘yicha jami"},"map":null,"formula":{"plus":["120","390"],"minus":[]},"check":"total_assets","note":null},{"code":"410","section":"equity","indent":0,"subtotal":false,"negative":false,"name":{"en":"Charter capital","ru":"Уставный капитал","uz":"Ustav kapitali","local":"Ustav kapitali"},"map":{"column":"share_capital","sign":1},"formula":null,"check":null,"note":null},{"code":"420","section":"equity","indent":0,"subtotal":false,"negative":false,"name":{"en":"Additional paid-in capital","ru":"Добавленный капитал","uz":"Qo‘shilgan kapital","local":"Qo‘shilgan kapital"},"map":{"column":"share_capital","sign":1},"formula":null,"check":null,"note":"additional paid-in capital aggregated into share capital (share premium)"},{"code":"430","section":"equity","indent":0,"subtotal":false,"negative":false,"name":{"en":"Reserve capital","ru":"Резервный капитал","uz":"Zaxira kapitali","local":"Zaxira kapitali"},"map":{"column":"other_reserves","sign":1},"formula":null,"check":null,"note":null},{"code":"440","section":"equity","indent":0,"subtotal":false,"negative":true,"name":{"en":"Treasury shares repurchased","ru":"Выкупленные собственные акции","uz":"Sotib olingan xususiy aksiyalar","local":"Sotib olingan xususiy aksiyalar"},"map":{"column":"other_reserves","sign":-1},"formula":null,"check":null,"note":"treasury shares reduce equity under IFRS"},{"code":"450","section":"equity","indent":0,"subtotal":false,"negative":false,"name":{"en":"Retained earnings (accumulated loss)","ru":"Нераспределённая прибыль (непокрытый убыток)","uz":"Taqsimlanmagan foyda (qoplanmagan zarar)","local":"Taqsimlanmagan foyda (qoplanmagan zarar)"},"map":{"column":"retained_earnings","sign":1},"formula":null,"check":null,"note":null},{"code":"460","section":"equity","indent":0,"subtotal":false,"negative":false,"name":{"en":"Targeted receipts","ru":"Целевые поступления","uz":"Maqsadli tushumlar","local":"Maqsadli tushumlar"},"map":{"column":"other_reserves","sign":1},"formula":null,"check":null,"note":"targeted receipts kept in equity reserves"},{"code":"470","section":"equity","indent":0,"subtotal":false,"negative":false,"name":{"en":"Provisions for future expenses and payments","ru":"Резервы предстоящих расходов и платежей","uz":"Kelgusi xarajatlar va to‘lovlar zaxiralari","local":"Kelgusi xarajatlar va to‘lovlar zaxiralari"},"map":{"column":"short_term_provisions","sign":1},"formula":null,"check":null,"note":"IFRS reclassification: provisions are liabilities, not equity; local form 480 total will intentionally differ"},{"code":"480","section":"equity","indent":0,"subtotal":true,"negative":false,"name":{"en":"Total for section I (equity)","ru":"Итого по разделу I","uz":"I bo‘lim bo‘yicha jami","local":"I bo‘lim bo‘yicha jami"},"map":null,"formula":{"plus":["410","420","430","450","460","470"],"minus":["440"]},"check":null,"note":null},{"code":"490","section":"liabilities_long_term","indent":0,"subtotal":true,"negative":false,"name":{"en":"Long-term liabilities, total","ru":"Долгосрочные обязательства, всего","uz":"Uzoq muddatli majburiyatlar, jami","local":"Uzoq muddatli majburiyatlar, jami"},"map":null,"formula":{"plus":["500","510","520","530"],"minus":[]},"check":null,"note":null},{"code":"500","section":"liabilities_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Long-term payables","ru":"Долгосрочная кредиторская задолженность","uz":"Uzoq muddatli kreditorlik qarzlari","local":"Uzoq muddatli kreditorlik qarzlari"},"map":{"column":"other_non_current_liabilities","sign":1},"formula":null,"check":null,"note":"long-term payables"},{"code":"510","section":"liabilities_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Long-term bank loans","ru":"Долгосрочные банковские кредиты","uz":"Uzoq muddatli bank kreditlari","local":"Uzoq muddatli bank kreditlari"},"map":{"column":"long_term_borrowings","sign":1},"formula":null,"check":null,"note":null},{"code":"520","section":"liabilities_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Long-term borrowings (loans)","ru":"Долгосрочные займы","uz":"Uzoq muddatli qarzlar","local":"Uzoq muddatli qarzlar"},"map":{"column":"long_term_borrowings","sign":1},"formula":null,"check":null,"note":null},{"code":"530","section":"liabilities_long_term","indent":1,"subtotal":false,"negative":false,"name":{"en":"Other long-term liabilities","ru":"Прочие долгосрочные обязательства","uz":"Boshqa uzoq muddatli majburiyatlar","local":"Boshqa uzoq muddatli majburiyatlar"},"map":{"column":"other_non_current_liabilities","sign":1},"formula":null,"check":null,"note":null},{"code":"600","section":"liabilities_current","indent":0,"subtotal":true,"negative":false,"name":{"en":"Current liabilities, total","ru":"Текущие обязательства, всего","uz":"Joriy majburiyatlar, jami","local":"Joriy majburiyatlar, jami"},"map":null,"formula":{"plus":["610","620","630","640","650","730","740","750","760"],"minus":[]},"check":null,"note":null},{"code":"610","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Trade payables (suppliers and contractors)","ru":"Кредиторская задолженность поставщикам и подрядчикам","uz":"Mol yetkazib beruvchilar va pudratchilarga kreditorlik qarzi","local":"Mol yetkazib beruvchilar va pudratchilarga kreditorlik qarzi"},"map":{"column":"trade_payables","sign":1},"formula":null,"check":null,"note":null},{"code":"620","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Advances received","ru":"Авансы полученные","uz":"Olingan bo‘naklar","local":"Olingan bo‘naklar"},"map":{"column":"other_payables","sign":1},"formula":null,"check":null,"note":"advances received"},{"code":"630","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Payables to the budget (taxes)","ru":"Задолженность по платежам в бюджет","uz":"Budjetga to‘lovlar bo‘yicha qarz","local":"Budjetga to‘lovlar bo‘yicha qarz"},"map":{"column":"current_tax_liabilities","sign":1},"formula":null,"check":null,"note":null},{"code":"640","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Payables to non-budget funds and insurance","ru":"Задолженность по страхованию и платежам во внебюджетные фонды","uz":"Sug‘urta va budjetdan tashqari fondlarga to‘lovlar bo‘yicha qarz","local":"Sug‘urta va budjetdan tashqari fondlarga to‘lovlar bo‘yicha qarz"},"map":{"column":"other_payables","sign":1},"formula":null,"check":null,"note":null},{"code":"650","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Payables to employees (payroll)","ru":"Задолженность по оплате труда","uz":"Mehnatga haq to‘lash bo‘yicha qarz","local":"Mehnatga haq to‘lash bo‘yicha qarz"},"map":{"column":"other_payables","sign":1},"formula":null,"check":null,"note":"payroll payables"},{"code":"730","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Short-term bank loans","ru":"Краткосрочные банковские кредиты","uz":"Qisqa muddatli bank kreditlari","local":"Qisqa muddatli bank kreditlari"},"map":{"column":"short_term_borrowings","sign":1},"formula":null,"check":null,"note":null},{"code":"740","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Short-term borrowings (loans)","ru":"Краткосрочные займы","uz":"Qisqa muddatli qarzlar","local":"Qisqa muddatli qarzlar"},"map":{"column":"short_term_borrowings","sign":1},"formula":null,"check":null,"note":null},{"code":"750","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Current portion of long-term liabilities","ru":"Текущая часть долгосрочных обязательств","uz":"Uzoq muddatli majburiyatlarning joriy qismi","local":"Uzoq muddatli majburiyatlarning joriy qismi"},"map":{"column":"short_term_borrowings","sign":1},"formula":null,"check":null,"note":"current portion of long-term debt"},{"code":"760","section":"liabilities_current","indent":1,"subtotal":false,"negative":false,"name":{"en":"Other current payables and liabilities","ru":"Прочие кредиторские задолженности и обязательства","uz":"Boshqa kreditorlik qarzlari va majburiyatlar","local":"Boshqa kreditorlik qarzlari va majburiyatlar"},"map":{"column":"other_current_liabilities","sign":1},"formula":null,"check":null,"note":null},{"code":"770","section":"liabilities_current","indent":0,"subtotal":true,"negative":false,"name":{"en":"Total for section II (liabilities)","ru":"Итого по разделу II","uz":"II bo‘lim bo‘yicha jami","local":"II bo‘lim bo‘yicha jami"},"map":null,"formula":{"plus":["490","600"],"minus":[]},"check":null,"note":"not cross-checked: line 470 (provisions) is reclassified from equity to liabilities under IFRS, so local liabilities differ by design; 400 and 780 still reconcile"},{"code":"780","section":"liabilities_current","indent":0,"subtotal":true,"negative":false,"name":{"en":"Total equity and liabilities","ru":"Всего по пассиву баланса","uz":"Balans passivi bo‘yicha jami","local":"Balans passivi bo‘yicha jami"},"map":null,"formula":{"plus":["480","770"],"minus":[]},"check":"total_equity_and_liabilities","note":null}]},{"code":"UZ_NAS_F2","form_kind":"income_statement","fidelity":"official_codes","local_language":"uz","name":{"en":"Statement of financial results (UZ NAS, Form 2)","ru":"Отчёт о финансовых результатах (форма №2)","uz":"Moliyaviy natijalar to‘g‘risidagi hisobot (2-shakl)","local":"Moliyaviy natijalar to‘g‘risidagi hisobot (2-shakl)"},"lines":[{"code":"010","section":"operating","indent":0,"subtotal":false,"negative":false,"name":{"en":"Net revenue from sales","ru":"Чистая выручка от реализации продукции (товаров, работ, услуг)","uz":"Mahsulot (tovar, ish, xizmat)larni sotishdan sof tushum","local":"Mahsulot (tovar, ish, xizmat)larni sotishdan sof tushum"},"map":{"column":"revenue","sign":1},"formula":null,"check":null,"note":null},{"code":"020","section":"operating","indent":0,"subtotal":false,"negative":true,"name":{"en":"Cost of goods sold","ru":"Себестоимость реализованной продукции (товаров, работ, услуг)","uz":"Sotilgan mahsulot (tovar, ish, xizmat)larning tannarxi","local":"Sotilgan mahsulot (tovar, ish, xizmat)larning tannarxi"},"map":{"column":"cost_of_sales","sign":1},"formula":null,"check":null,"note":"entered positive per app convention"},{"code":"030","section":"operating","indent":0,"subtotal":true,"negative":false,"name":{"en":"Gross profit (loss)","ru":"Валовая прибыль (убыток) от реализации","uz":"Sotishdan yalpi foyda (zarar)","local":"Sotishdan yalpi foyda (zarar)"},"map":null,"formula":{"plus":["010"],"minus":["020"]},"check":"gross_profit","note":null},{"code":"040","section":"operating","indent":0,"subtotal":true,"negative":true,"name":{"en":"Period expenses, total","ru":"Расходы периода, всего","uz":"Davr xarajatlari, jami","local":"Davr xarajatlari, jami"},"map":null,"formula":{"plus":["050","060","070"],"minus":[]},"check":null,"note":null},{"code":"050","section":"operating","indent":1,"subtotal":false,"negative":true,"name":{"en":"Selling expenses","ru":"Расходы по реализации","uz":"Sotish xarajatlari","local":"Sotish xarajatlari"},"map":{"column":"distribution_expenses","sign":1},"formula":null,"check":null,"note":null},{"code":"060","section":"operating","indent":1,"subtotal":false,"negative":true,"name":{"en":"Administrative expenses","ru":"Административные расходы","uz":"Ma‘muriy xarajatlar","local":"Ma‘muriy xarajatlar"},"map":{"column":"administrative_expenses","sign":1},"formula":null,"check":null,"note":null},{"code":"070","section":"operating","indent":1,"subtotal":false,"negative":true,"name":{"en":"Other operating expenses","ru":"Прочие операционные расходы","uz":"Boshqa operatsion xarajatlar","local":"Boshqa operatsion xarajatlar"},"map":{"column":"other_operating_expenses","sign":1},"formula":null,"check":null,"note":null},{"code":"090","section":"operating","indent":0,"subtotal":false,"negative":false,"name":{"en":"Other income from main operations","ru":"Прочие доходы от основной деятельности","uz":"Asosiy faoliyatdan boshqa daromadlar","local":"Asosiy faoliyatdan boshqa daromadlar"},"map":{"column":"other_operating_income","sign":1},"formula":null,"check":null,"note":null},{"code":"100","section":"operating","indent":0,"subtotal":true,"negative":false,"name":{"en":"Profit (loss) from main operations","ru":"Прибыль (убыток) от основной деятельности","uz":"Asosiy faoliyatdan foyda (zarar)","local":"Asosiy faoliyatdan foyda (zarar)"},"map":null,"formula":{"plus":["030","090"],"minus":["040"]},"check":"operating_profit","note":null},{"code":"110","section":"financial","indent":0,"subtotal":false,"negative":false,"name":{"en":"Income from financing activities, total","ru":"Доходы от финансовой деятельности, всего","uz":"Moliyaviy faoliyatdan daromadlar, jami","local":"Moliyaviy faoliyatdan daromadlar, jami"},"map":{"column":"finance_income","sign":1},"formula":{"plus":["120","130","140","160"],"minus":[]},"check":null,"note":"total mapped; 120-160 breakdown is informational"},{"code":"120","section":"financial","indent":1,"subtotal":false,"negative":false,"name":{"en":"Dividend income","ru":"Доходы в виде дивидендов","uz":"Dividendlar ko‘rinishidagi daromadlar","local":"Dividendlar ko‘rinishidagi daromadlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"130","section":"financial","indent":1,"subtotal":false,"negative":false,"name":{"en":"Interest income","ru":"Доходы в виде процентов","uz":"Foizlar ko‘rinishidagi daromadlar","local":"Foizlar ko‘rinishidagi daromadlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"140","section":"financial","indent":1,"subtotal":false,"negative":false,"name":{"en":"Foreign exchange gains","ru":"Доходы от валютных курсовых разниц","uz":"Valyuta kursi farqidan daromadlar","local":"Valyuta kursi farqidan daromadlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"160","section":"financial","indent":1,"subtotal":false,"negative":false,"name":{"en":"Other income from financing activities","ru":"Прочие доходы от финансовой деятельности","uz":"Moliyaviy faoliyatdan boshqa daromadlar","local":"Moliyaviy faoliyatdan boshqa daromadlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"170","section":"financial","indent":0,"subtotal":false,"negative":true,"name":{"en":"Expenses on financing activities, total","ru":"Расходы по финансовой деятельности, всего","uz":"Moliyaviy faoliyat bo‘yicha xarajatlar, jami","local":"Moliyaviy faoliyat bo‘yicha xarajatlar, jami"},"map":{"column":"finance_costs","sign":1},"formula":{"plus":["180","190","200"],"minus":[]},"check":null,"note":"total mapped; 180-200 breakdown is informational"},{"code":"180","section":"financial","indent":1,"subtotal":false,"negative":true,"name":{"en":"Interest expenses","ru":"Расходы в виде процентов","uz":"Foizlar ko‘rinishidagi xarajatlar","local":"Foizlar ko‘rinishidagi xarajatlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"190","section":"financial","indent":1,"subtotal":false,"negative":true,"name":{"en":"Interest expenses on finance lease","ru":"Расходы в виде процентов по финансовой аренде","uz":"Moliyaviy ijara bo‘yicha foiz xarajatlari","local":"Moliyaviy ijara bo‘yicha foiz xarajatlari"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"200","section":"financial","indent":1,"subtotal":false,"negative":true,"name":{"en":"Foreign exchange losses","ru":"Убытки от валютных курсовых разниц","uz":"Valyuta kursi farqidan zararlar","local":"Valyuta kursi farqidan zararlar"},"map":null,"formula":null,"check":null,"note":"breakdown of the line above; informational, not mapped"},{"code":"220","section":"result","indent":0,"subtotal":true,"negative":false,"name":{"en":"Profit (loss) from ordinary activities","ru":"Прибыль (убыток) от общехозяйственной деятельности","uz":"Umumxo‘jalik faoliyatidan foyda (zarar)","local":"Umumxo‘jalik faoliyatidan foyda (zarar)"},"map":null,"formula":{"plus":["100","110"],"minus":["170"]},"check":null,"note":null},{"code":"230","section":"result","indent":0,"subtotal":false,"negative":false,"name":{"en":"Extraordinary gains and losses","ru":"Чрезвычайные прибыли и убытки","uz":"Favqulodda foyda va zararlar","local":"Favqulodda foyda va zararlar"},"map":{"column":"other_non_operating","sign":1},"formula":null,"check":null,"note":"extraordinary items"},{"code":"240","section":"result","indent":0,"subtotal":true,"negative":false,"name":{"en":"Profit (loss) before income tax","ru":"Прибыль (убыток) до уплаты налога на прибыль","uz":"Foyda solig‘ini to‘lagunga qadar foyda (zarar)","local":"Foyda solig‘ini to‘lagunga qadar foyda (zarar)"},"map":null,"formula":{"plus":["220","230"],"minus":[]},"check":"profit_before_tax","note":null},{"code":"250","section":"result","indent":0,"subtotal":false,"negative":true,"name":{"en":"Income tax","ru":"Налог на прибыль","uz":"Foyda solig‘i","local":"Foyda solig‘i"},"map":{"column":"income_tax","sign":1},"formula":null,"check":null,"note":null},{"code":"260","section":"result","indent":0,"subtotal":false,"negative":true,"name":{"en":"Other taxes and mandatory payments from profit","ru":"Прочие налоги и другие обязательные платежи от прибыли","uz":"Foydadan boshqa soliqlar va majburiy to‘lovlar","local":"Foydadan boshqa soliqlar va majburiy to‘lovlar"},"map":{"column":"income_tax","sign":1},"formula":null,"check":null,"note":"other profit-based taxes aggregated into income tax"},{"code":"270","section":"result","indent":0,"subtotal":true,"negative":false,"name":{"en":"Net profit (loss) of the reporting period","ru":"Чистая прибыль (убыток) отчётного периода","uz":"Hisobot davrining sof foydasi (zarari)","local":"Hisobot davrining sof foydasi (zarari)"},"map":null,"formula":{"plus":["240"],"minus":["250","260"]},"check":"net_profit","note":null}]}]}$fw$::jsonb);

-- ---------------------------------------------------------------------------
-- 6. IFRS family: entered directly on the IFRS form, under their own label
-- ---------------------------------------------------------------------------
insert into tci.reporting_frameworks (code, kind, short_en, short_ru, short_uz, name_en, name_ru, name_uz, legal_basis) values
  ('IFRS', 'ifrs', 'IFRS', 'МСФО', 'MHXS',
   'IFRS (as adopted nationally)', 'МСФО (в национальной редакции)', 'MHXS (milliy tahrirda)',
   'International Financial Reporting Standards adopted by national law'),
  ('NP_NFRS', 'ifrs', 'NFRS', 'NFRS', 'NFRS',
   'Nepal Financial Reporting Standards (IFRS-converged)', 'Стандарты финансовой отчётности Непала (NFRS, на основе МСФО)',
   'Nepal moliyaviy hisobot standartlari (NFRS, MHXS asosida)',
   'Accounting Standards Board Nepal; Companies Act 2063'),
  ('AZ_NAS', 'ifrs', 'AZ NAS', 'НСБУ АР', 'AR BHMS',
   'Azerbaijan National Accounting Standards for commercial organisations (IFRS-based)',
   'Национальные стандарты бухучёта Азербайджана для коммерческих организаций (на основе МСФО)',
   'Ozarbayjon tijorat tashkilotlari uchun milliy buxgalteriya standartlari (MHXS asosida)',
   'Law on Accounting of the Republic of Azerbaijan (2004)');

insert into tci.country_reporting_frameworks (country_code, framework_code)
select c, 'IFRS' from unnest(array['KG', 'TJ', 'AM', 'GE', 'MN', 'TM', 'KR', 'AU', 'NZ', 'CA', 'ZA', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'IL', 'SG', 'MY', 'HK', 'TW', 'PH', 'TH', 'ID', 'MX', 'AR', 'CL', 'CO', 'PE', 'EG', 'NG', 'KE', 'PK', 'BD', 'LK', 'RS', 'BA', 'ME', 'MK', 'AL', 'UY', 'EC', 'GH', 'JO', 'IQ']) as c
on conflict (country_code) do nothing;
insert into tci.country_reporting_frameworks (country_code, framework_code) values
  ('NP', 'NP_NFRS'), ('AZ', 'AZ_NAS')
on conflict (country_code) do update set framework_code = excluded.framework_code;

alter table tci.statement_templates
  alter column framework_code set not null,
  alter column fidelity set not null;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from tci.statement_template_lines l
    join tci.statement_templates t on t.id = l.template_id
   where t.code in ('UZ_NAS_F1', 'UZ_NAS_F2') and l.formula is not null;
  if v_n <> 21 then
    raise exception '0049: expected the 21 UZ NAS formulas to be stored, found %', v_n;
  end if;
  select count(*) into v_n from tci.statement_template_lines l
    join tci.statement_templates t on t.id = l.template_id
   where t.code in ('UZ_NAS_F1', 'UZ_NAS_F2') and l.crosscheck_column is not null;
  if v_n <> 8 then
    raise exception '0049: expected 8 UZ NAS cross-checks (770 dropped), found %', v_n;
  end if;
  if exists (select 1 from tci.statement_template_lines l join tci.statement_templates t on t.id = l.template_id
              where t.code = 'UZ_NAS_F1' and l.line_code = '770' and l.crosscheck_column is not null) then
    raise exception '0049: UZ NAS line 770 must not be cross-checked';
  end if;
  select count(*) into v_n from tci.statement_template_lines l
    join tci.statement_templates t on t.id = l.template_id
   where t.code in ('UZ_NAS_F1', 'UZ_NAS_F2');
  if v_n <> 82 then
    raise exception '0049: the UZ NAS line set changed (% lines, expected 82)', v_n;
  end if;
  if exists (select 1 from tci.statement_template_lines where name_uz ~ '''') then
    raise exception '0049: a uz template caption still uses an ASCII apostrophe';
  end if;
  if exists (select 1 from tci.country_reporting_frameworks f where not exists
               (select 1 from tci.countries c where c.code = f.country_code)) then
    raise exception '0049: a framework link names an unknown country';
  end if;
  if has_function_privilege('authenticated', 'tci.seed_statement_framework(jsonb)', 'execute')
     or has_function_privilege('anon', 'tci.seed_statement_framework(jsonb)', 'execute') then
    raise exception '0049: the framework loader is reachable through the API';
  end if;
  select string_agg(table_name, ', ') into v_bad from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'tci';
  if v_bad is not null then
    raise exception '0049: anon holds a table grant in tci: %', v_bad;
  end if;
end;
$$;
