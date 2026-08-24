-- 0007_uz_nas_seed.sql
-- What: seed Uzbekistan NAS statutory templates (Form 1 balance sheet,
--       Form 2 income statement) with official line codes/names and the
--       full line -> IFRS column mapping.
-- Why:  Workstream A of Phase 1b. Line codes marked (*) in the phase report
--       are uncertain and pending professional review; names are official.
-- Note: subtotal lines are NOT mapped - IFRS subtotals are computed by the
--       mapping algorithm and cross-checked against local subtotal lines.

insert into tci.statement_templates (country_code, form_kind, code, name_en, name_ru, name_uz) values
  ('UZ', 'balance_sheet', 'UZ_NAS_F1',
   'Balance sheet (UZ NAS, Form 1)',
   'Бухгалтерский баланс (форма №1)',
   'Buxgalteriya balansi (1-shakl)'),
  ('UZ', 'income_statement', 'UZ_NAS_F2',
   'Statement of financial results (UZ NAS, Form 2)',
   'Отчёт о финансовых результатах (форма №2)',
   'Moliyaviy natijalar to''g''risidagi hisobot (2-shakl)');

-- ---------------------------------------------------------------------------
-- Form 1 lines
-- ---------------------------------------------------------------------------
insert into tci.statement_template_lines
  (template_id, line_code, name_en, name_ru, name_uz, section, display_order, is_subtotal, indent_level)
select t.id, v.line_code, v.name_en, v.name_ru, v.name_uz, v.section, v.display_order, v.is_subtotal, v.indent_level
from tci.statement_templates t,
(values
  ('010', 'PP&E: initial (revalued) cost', 'Основные средства: первоначальная (восстановительная) стоимость', 'Asosiy vositalar: boshlang''ich (qayta tiklash) qiymati', 'assets_long_term', 10, false, 1),
  ('011', 'PP&E: accumulated depreciation', 'Основные средства: износ', 'Asosiy vositalar: eskirish summasi', 'assets_long_term', 20, false, 1),
  ('012', 'PP&E: net book value', 'Основные средства: остаточная стоимость', 'Asosiy vositalar: qoldiq qiymati', 'assets_long_term', 30, false, 0),
  ('020', 'Intangible assets: initial cost', 'Нематериальные активы: первоначальная стоимость', 'Nomoddiy aktivlar: boshlang''ich qiymati', 'assets_long_term', 40, false, 1),
  ('021', 'Intangible assets: amortization', 'Нематериальные активы: амортизация', 'Nomoddiy aktivlar: amortizatsiya summasi', 'assets_long_term', 50, false, 1),
  ('022', 'Intangible assets: net book value', 'Нематериальные активы: остаточная стоимость', 'Nomoddiy aktivlar: qoldiq qiymati', 'assets_long_term', 60, false, 0),
  ('030', 'Long-term investments, total', 'Долгосрочные инвестиции, всего', 'Uzoq muddatli investitsiyalar, jami', 'assets_long_term', 70, false, 0),
  ('040', 'Securities', 'Ценные бумаги', 'Qimmatli qog''ozlar', 'assets_long_term', 80, false, 1),
  ('050', 'Investments in subsidiaries', 'Инвестиции в дочерние хозяйственные общества', 'Sho''ba xo''jalik jamiyatlariga investitsiyalar', 'assets_long_term', 90, false, 1),
  ('060', 'Investments in associates', 'Инвестиции в зависимые хозяйственные общества', 'Qaram xo''jalik jamiyatlariga investitsiyalar', 'assets_long_term', 100, false, 1),
  ('070', 'Other long-term investments', 'Прочие долгосрочные инвестиции', 'Boshqa uzoq muddatli investitsiyalar', 'assets_long_term', 110, false, 1),
  ('080', 'Equipment for installation', 'Оборудование к установке', 'O''rnatiladigan asbob-uskunalar', 'assets_long_term', 120, false, 0),
  ('090', 'Capital investments (CWIP)', 'Капитальные вложения', 'Kapital qo''yilmalar', 'assets_long_term', 130, false, 0),
  ('100', 'Long-term receivables', 'Долгосрочная дебиторская задолженность', 'Uzoq muddatli debitorlik qarzlari', 'assets_long_term', 140, false, 0),
  ('110', 'Long-term deferred expenses', 'Долгосрочные отсроченные расходы', 'Uzoq muddatli kechiktirilgan xarajatlar', 'assets_long_term', 150, false, 0),
  ('120', 'Total for section I', 'Итого по разделу I', 'I bo''lim bo''yicha jami', 'assets_long_term', 160, true, 0),
  ('140', 'Inventories, total', 'Товарно-материальные запасы, всего', 'Tovar-moddiy zaxiralari, jami', 'assets_current', 170, false, 0),
  ('150', 'Production inventories', 'Производственные запасы', 'Ishlab chiqarish zaxiralari', 'assets_current', 180, false, 1),
  ('160', 'Work in progress', 'Незавершённое производство', 'Tugallanmagan ishlab chiqarish', 'assets_current', 190, false, 1),
  ('170', 'Finished goods', 'Готовая продукция', 'Tayyor mahsulot', 'assets_current', 200, false, 1),
  ('180', 'Goods for resale', 'Товары', 'Tovarlar', 'assets_current', 210, false, 1),
  ('190', 'Prepaid expenses', 'Расходы будущих периодов', 'Kelgusi davr xarajatlari', 'assets_current', 220, false, 0),
  ('200', 'Deferred expenses', 'Отсроченные расходы', 'Kechiktirilgan xarajatlar', 'assets_current', 230, false, 0),
  ('210', 'Receivables, total', 'Дебиторы, всего', 'Debitorlar, jami', 'assets_current', 240, true, 0),
  ('230', 'Trade receivables (customers)', 'Задолженность покупателей и заказчиков', 'Xaridorlar va buyurtmachilarning qarzi', 'assets_current', 250, false, 1),
  ('270', 'Advances to suppliers and contractors', 'Авансы, выданные поставщикам и подрядчикам', 'Mol yetkazib beruvchilar va pudratchilarga berilgan bo''naklar', 'assets_current', 260, false, 1),
  ('280', 'Advance payments of taxes and duties', 'Авансовые платежи по налогам и сборам', 'Soliq va yig''imlar bo''yicha bo''nak to''lovlari', 'assets_current', 270, false, 1),
  ('310', 'Other receivables', 'Прочие дебиторские задолженности', 'Boshqa debitorlik qarzlari', 'assets_current', 280, false, 1),
  ('320', 'Cash, total', 'Денежные средства, всего', 'Pul mablag''lari, jami', 'assets_current', 290, false, 0),
  ('370', 'Short-term investments', 'Краткосрочные инвестиции', 'Qisqa muddatli investitsiyalar', 'assets_current', 300, false, 0),
  ('380', 'Other current assets', 'Прочие текущие активы', 'Boshqa joriy aktivlar', 'assets_current', 310, false, 0),
  ('390', 'Total for section II', 'Итого по разделу II', 'II bo''lim bo''yicha jami', 'assets_current', 320, true, 0),
  ('400', 'Total assets', 'Всего по активу баланса', 'Balans aktivi bo''yicha jami', 'assets_current', 330, true, 0),
  ('410', 'Charter capital', 'Уставный капитал', 'Ustav kapitali', 'equity', 340, false, 0),
  ('420', 'Additional paid-in capital', 'Добавленный капитал', 'Qo''shilgan kapital', 'equity', 350, false, 0),
  ('430', 'Reserve capital', 'Резервный капитал', 'Zaxira kapitali', 'equity', 360, false, 0),
  ('440', 'Treasury shares repurchased', 'Выкупленные собственные акции', 'Sotib olingan xususiy aksiyalar', 'equity', 370, false, 0),
  ('450', 'Retained earnings (accumulated loss)', 'Нераспределённая прибыль (непокрытый убыток)', 'Taqsimlanmagan foyda (qoplanmagan zarar)', 'equity', 380, false, 0),
  ('460', 'Targeted receipts', 'Целевые поступления', 'Maqsadli tushumlar', 'equity', 390, false, 0),
  ('470', 'Provisions for future expenses and payments', 'Резервы предстоящих расходов и платежей', 'Kelgusi xarajatlar va to''lovlar zaxiralari', 'equity', 400, false, 0),
  ('480', 'Total for section I (equity)', 'Итого по разделу I', 'I bo''lim bo''yicha jami', 'equity', 410, true, 0),
  ('490', 'Long-term liabilities, total', 'Долгосрочные обязательства, всего', 'Uzoq muddatli majburiyatlar, jami', 'liabilities_long_term', 420, true, 0),
  ('500', 'Long-term payables', 'Долгосрочная кредиторская задолженность', 'Uzoq muddatli kreditorlik qarzlari', 'liabilities_long_term', 430, false, 1),
  ('510', 'Long-term bank loans', 'Долгосрочные банковские кредиты', 'Uzoq muddatli bank kreditlari', 'liabilities_long_term', 440, false, 1),
  ('520', 'Long-term borrowings (loans)', 'Долгосрочные займы', 'Uzoq muddatli qarzlar', 'liabilities_long_term', 450, false, 1),
  ('530', 'Other long-term liabilities', 'Прочие долгосрочные обязательства', 'Boshqa uzoq muddatli majburiyatlar', 'liabilities_long_term', 460, false, 1),
  ('600', 'Current liabilities, total', 'Текущие обязательства, всего', 'Joriy majburiyatlar, jami', 'liabilities_current', 470, true, 0),
  ('610', 'Trade payables (suppliers and contractors)', 'Кредиторская задолженность поставщикам и подрядчикам', 'Mol yetkazib beruvchilar va pudratchilarga kreditorlik qarzi', 'liabilities_current', 480, false, 1),
  ('620', 'Advances received', 'Авансы полученные', 'Olingan bo''naklar', 'liabilities_current', 490, false, 1),
  ('630', 'Payables to the budget (taxes)', 'Задолженность по платежам в бюджет', 'Budjetga to''lovlar bo''yicha qarz', 'liabilities_current', 500, false, 1),
  ('640', 'Payables to non-budget funds and insurance', 'Задолженность по страхованию и платежам во внебюджетные фонды', 'Sug''urta va budjetdan tashqari fondlarga to''lovlar bo''yicha qarz', 'liabilities_current', 510, false, 1),
  ('650', 'Payables to employees (payroll)', 'Задолженность по оплате труда', 'Mehnatga haq to''lash bo''yicha qarz', 'liabilities_current', 520, false, 1),
  ('730', 'Short-term bank loans', 'Краткосрочные банковские кредиты', 'Qisqa muddatli bank kreditlari', 'liabilities_current', 530, false, 1),
  ('740', 'Short-term borrowings (loans)', 'Краткосрочные займы', 'Qisqa muddatli qarzlar', 'liabilities_current', 540, false, 1),
  ('750', 'Current portion of long-term liabilities', 'Текущая часть долгосрочных обязательств', 'Uzoq muddatli majburiyatlarning joriy qismi', 'liabilities_current', 550, false, 1),
  ('760', 'Other current payables and liabilities', 'Прочие кредиторские задолженности и обязательства', 'Boshqa kreditorlik qarzlari va majburiyatlar', 'liabilities_current', 560, false, 1),
  ('770', 'Total for section II (liabilities)', 'Итого по разделу II', 'II bo''lim bo''yicha jami', 'liabilities_current', 570, true, 0),
  ('780', 'Total equity and liabilities', 'Всего по пассиву баланса', 'Balans passivi bo''yicha jami', 'liabilities_current', 580, true, 0)
) as v(line_code, name_en, name_ru, name_uz, section, display_order, is_subtotal, indent_level)
where t.code = 'UZ_NAS_F1';

-- ---------------------------------------------------------------------------
-- Form 2 lines
-- ---------------------------------------------------------------------------
insert into tci.statement_template_lines
  (template_id, line_code, name_en, name_ru, name_uz, section, display_order, is_subtotal, indent_level)
select t.id, v.line_code, v.name_en, v.name_ru, v.name_uz, v.section, v.display_order, v.is_subtotal, v.indent_level
from tci.statement_templates t,
(values
  ('010', 'Net revenue from sales', 'Чистая выручка от реализации продукции (товаров, работ, услуг)', 'Mahsulot (tovar, ish, xizmat)larni sotishdan sof tushum', 'operating', 10, false, 0),
  ('020', 'Cost of goods sold', 'Себестоимость реализованной продукции (товаров, работ, услуг)', 'Sotilgan mahsulot (tovar, ish, xizmat)larning tannarxi', 'operating', 20, false, 0),
  ('030', 'Gross profit (loss)', 'Валовая прибыль (убыток) от реализации', 'Sotishdan yalpi foyda (zarar)', 'operating', 30, true, 0),
  ('040', 'Period expenses, total', 'Расходы периода, всего', 'Davr xarajatlari, jami', 'operating', 40, true, 0),
  ('050', 'Selling expenses', 'Расходы по реализации', 'Sotish xarajatlari', 'operating', 50, false, 1),
  ('060', 'Administrative expenses', 'Административные расходы', 'Ma''muriy xarajatlar', 'operating', 60, false, 1),
  ('070', 'Other operating expenses', 'Прочие операционные расходы', 'Boshqa operatsion xarajatlar', 'operating', 70, false, 1),
  ('090', 'Other income from main operations', 'Прочие доходы от основной деятельности', 'Asosiy faoliyatdan boshqa daromadlar', 'operating', 80, false, 0),
  ('100', 'Profit (loss) from main operations', 'Прибыль (убыток) от основной деятельности', 'Asosiy faoliyatdan foyda (zarar)', 'operating', 90, true, 0),
  ('110', 'Income from financing activities, total', 'Доходы от финансовой деятельности, всего', 'Moliyaviy faoliyatdan daromadlar, jami', 'financial', 100, false, 0),
  ('120', 'Dividend income', 'Доходы в виде дивидендов', 'Dividendlar ko''rinishidagi daromadlar', 'financial', 110, false, 1),
  ('130', 'Interest income', 'Доходы в виде процентов', 'Foizlar ko''rinishidagi daromadlar', 'financial', 120, false, 1),
  ('140', 'Foreign exchange gains', 'Доходы от валютных курсовых разниц', 'Valyuta kursi farqidan daromadlar', 'financial', 130, false, 1),
  ('160', 'Other income from financing activities', 'Прочие доходы от финансовой деятельности', 'Moliyaviy faoliyatdan boshqa daromadlar', 'financial', 140, false, 1),
  ('170', 'Expenses on financing activities, total', 'Расходы по финансовой деятельности, всего', 'Moliyaviy faoliyat bo''yicha xarajatlar, jami', 'financial', 150, false, 0),
  ('180', 'Interest expenses', 'Расходы в виде процентов', 'Foizlar ko''rinishidagi xarajatlar', 'financial', 160, false, 1),
  ('190', 'Interest expenses on finance lease', 'Расходы в виде процентов по финансовой аренде', 'Moliyaviy ijara bo''yicha foiz xarajatlari', 'financial', 170, false, 1),
  ('200', 'Foreign exchange losses', 'Убытки от валютных курсовых разниц', 'Valyuta kursi farqidan zararlar', 'financial', 180, false, 1),
  ('220', 'Profit (loss) from ordinary activities', 'Прибыль (убыток) от общехозяйственной деятельности', 'Umumxo''jalik faoliyatidan foyda (zarar)', 'result', 190, true, 0),
  ('230', 'Extraordinary gains and losses', 'Чрезвычайные прибыли и убытки', 'Favqulodda foyda va zararlar', 'result', 200, false, 0),
  ('240', 'Profit (loss) before income tax', 'Прибыль (убыток) до уплаты налога на прибыль', 'Foyda solig''ini to''lagunga qadar foyda (zarar)', 'result', 210, true, 0),
  ('250', 'Income tax', 'Налог на прибыль', 'Foyda solig''i', 'result', 220, false, 0),
  ('260', 'Other taxes and mandatory payments from profit', 'Прочие налоги и другие обязательные платежи от прибыли', 'Foydadan boshqa soliqlar va majburiy to''lovlar', 'result', 230, false, 0),
  ('270', 'Net profit (loss) of the reporting period', 'Чистая прибыль (убыток) отчётного периода', 'Hisobot davrining sof foydasi (zarari)', 'result', 240, true, 0)
) as v(line_code, name_en, name_ru, name_uz, section, display_order, is_subtotal, indent_level)
where t.code = 'UZ_NAS_F2';

-- ---------------------------------------------------------------------------
-- IFRS mappings (documented in the phase report; subtotals unmapped)
-- ---------------------------------------------------------------------------
insert into tci.ifrs_mappings (template_line_id, target_table, target_column, sign, note)
select l.id, m.tt::tci.ifrs_target_table, m.col, m.sign, m.note
from (values
  -- Form 1: assets
  ('UZ_NAS_F1', '012', 'balance_sheet', 'property_plant_equipment', 1, 'net book value; 010/011 gross and depreciation are memo lines'),
  ('UZ_NAS_F1', '022', 'balance_sheet', 'intangible_assets', 1, 'net book value; 020/021 are memo lines'),
  ('UZ_NAS_F1', '030', 'balance_sheet', 'long_term_investments', 1, 'total mapped; 040-070 breakdown is informational to avoid double counting'),
  ('UZ_NAS_F1', '080', 'balance_sheet', 'property_plant_equipment', 1, 'equipment for installation treated as PP&E (IAS 16 assets under construction)'),
  ('UZ_NAS_F1', '090', 'balance_sheet', 'property_plant_equipment', 1, 'capital work in progress treated as PP&E (IAS 16)'),
  ('UZ_NAS_F1', '100', 'balance_sheet', 'other_non_current_assets', 1, 'long-term receivables'),
  ('UZ_NAS_F1', '110', 'balance_sheet', 'other_non_current_assets', 1, null),
  ('UZ_NAS_F1', '140', 'balance_sheet', 'inventories', 1, 'total mapped; 150-180 breakdown is informational'),
  ('UZ_NAS_F1', '190', 'balance_sheet', 'other_current_assets', 1, 'prepaid expenses'),
  ('UZ_NAS_F1', '200', 'balance_sheet', 'other_current_assets', 1, null),
  ('UZ_NAS_F1', '230', 'balance_sheet', 'trade_receivables', 1, null),
  ('UZ_NAS_F1', '270', 'balance_sheet', 'other_receivables', 1, null),
  ('UZ_NAS_F1', '280', 'balance_sheet', 'other_receivables', 1, null),
  ('UZ_NAS_F1', '310', 'balance_sheet', 'other_receivables', 1, null),
  ('UZ_NAS_F1', '320', 'balance_sheet', 'cash_and_equivalents', 1, null),
  ('UZ_NAS_F1', '370', 'balance_sheet', 'short_term_investments', 1, null),
  ('UZ_NAS_F1', '380', 'balance_sheet', 'other_current_assets', 1, null),
  -- Form 1: equity
  ('UZ_NAS_F1', '410', 'balance_sheet', 'share_capital', 1, null),
  ('UZ_NAS_F1', '420', 'balance_sheet', 'share_capital', 1, 'additional paid-in capital aggregated into share capital (share premium)'),
  ('UZ_NAS_F1', '430', 'balance_sheet', 'other_reserves', 1, null),
  ('UZ_NAS_F1', '440', 'balance_sheet', 'other_reserves', -1, 'treasury shares reduce equity under IFRS'),
  ('UZ_NAS_F1', '450', 'balance_sheet', 'retained_earnings', 1, null),
  ('UZ_NAS_F1', '460', 'balance_sheet', 'other_reserves', 1, 'targeted receipts kept in equity reserves'),
  ('UZ_NAS_F1', '470', 'balance_sheet', 'short_term_provisions', 1, 'IFRS reclassification: provisions are liabilities, not equity; local form 480 total will intentionally differ'),
  -- Form 1: liabilities
  ('UZ_NAS_F1', '500', 'balance_sheet', 'other_non_current_liabilities', 1, 'long-term payables'),
  ('UZ_NAS_F1', '510', 'balance_sheet', 'long_term_borrowings', 1, null),
  ('UZ_NAS_F1', '520', 'balance_sheet', 'long_term_borrowings', 1, null),
  ('UZ_NAS_F1', '530', 'balance_sheet', 'other_non_current_liabilities', 1, null),
  ('UZ_NAS_F1', '610', 'balance_sheet', 'trade_payables', 1, null),
  ('UZ_NAS_F1', '620', 'balance_sheet', 'other_payables', 1, 'advances received'),
  ('UZ_NAS_F1', '630', 'balance_sheet', 'current_tax_liabilities', 1, null),
  ('UZ_NAS_F1', '640', 'balance_sheet', 'other_payables', 1, null),
  ('UZ_NAS_F1', '650', 'balance_sheet', 'other_payables', 1, 'payroll payables'),
  ('UZ_NAS_F1', '730', 'balance_sheet', 'short_term_borrowings', 1, null),
  ('UZ_NAS_F1', '740', 'balance_sheet', 'short_term_borrowings', 1, null),
  ('UZ_NAS_F1', '750', 'balance_sheet', 'short_term_borrowings', 1, 'current portion of long-term debt'),
  ('UZ_NAS_F1', '760', 'balance_sheet', 'other_current_liabilities', 1, null),
  -- Form 2
  ('UZ_NAS_F2', '010', 'income_statement', 'revenue', 1, null),
  ('UZ_NAS_F2', '020', 'income_statement', 'cost_of_sales', 1, 'entered positive per app convention'),
  ('UZ_NAS_F2', '050', 'income_statement', 'distribution_expenses', 1, null),
  ('UZ_NAS_F2', '060', 'income_statement', 'administrative_expenses', 1, null),
  ('UZ_NAS_F2', '070', 'income_statement', 'other_operating_expenses', 1, null),
  ('UZ_NAS_F2', '090', 'income_statement', 'other_operating_income', 1, null),
  ('UZ_NAS_F2', '110', 'income_statement', 'finance_income', 1, 'total mapped; 120-160 breakdown is informational'),
  ('UZ_NAS_F2', '170', 'income_statement', 'finance_costs', 1, 'total mapped; 180-200 breakdown is informational'),
  ('UZ_NAS_F2', '230', 'income_statement', 'other_non_operating', 1, 'extraordinary items'),
  ('UZ_NAS_F2', '250', 'income_statement', 'income_tax', 1, null),
  ('UZ_NAS_F2', '260', 'income_statement', 'income_tax', 1, 'other profit-based taxes aggregated into income tax')
) as m(tpl, line, tt, col, sign, note)
join tci.statement_templates t on t.code = m.tpl
join tci.statement_template_lines l on l.template_id = t.id and l.line_code = m.line;
