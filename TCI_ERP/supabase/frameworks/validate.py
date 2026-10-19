#!/usr/bin/env python3
"""Validate a statement-framework JSON file (see SPEC.md).

usage: python3 validate.py FILE.json [FILE.json ...]
Exit code 0 when every file passes. Prints every problem found.
"""
import json, random, sys, re

BS_COLS = ['property_plant_equipment','intangible_assets','goodwill','investment_property','long_term_investments',
  'deferred_tax_assets','other_non_current_assets','inventories','trade_receivables','other_receivables',
  'short_term_investments','cash_and_equivalents','other_current_assets','share_capital','retained_earnings',
  'other_reserves','non_controlling_interests','long_term_borrowings','deferred_tax_liabilities','long_term_provisions',
  'other_non_current_liabilities','short_term_borrowings','trade_payables','other_payables','current_tax_liabilities',
  'short_term_provisions','other_current_liabilities']
IS_COLS = ['revenue','cost_of_sales','distribution_expenses','administrative_expenses','other_operating_income',
  'other_operating_expenses','finance_income','finance_costs','other_non_operating','income_tax','depreciation_amortization']
BS_TOTALS = ['total_non_current_assets','total_current_assets','total_assets','total_equity','total_non_current_liabilities',
  'total_current_liabilities','total_liabilities','total_equity_and_liabilities']
IS_TOTALS = ['gross_profit','operating_profit','profit_before_tax','net_profit']
SECTIONS = {'balance_sheet': {'assets_long_term','assets_current','equity','liabilities_long_term','liabilities_current'},
            'income_statement': {'operating','financial','result'}}
FIDELITY = {'official_codes','prescribed_captions','framework_layout'}
KINDS = {'national_gaap','ifrs_based'}
UZ_BAD = re.compile(r"[’'`ʻʼ]")  # uz must use U+2018 only

def ifrs_totals(v):
    s = lambda keys: sum(v.get(k, 0.0) for k in keys)
    t = {}
    t['total_non_current_assets'] = s(['property_plant_equipment','intangible_assets','goodwill','investment_property','long_term_investments','deferred_tax_assets','other_non_current_assets'])
    t['total_current_assets'] = s(['inventories','trade_receivables','other_receivables','short_term_investments','cash_and_equivalents','other_current_assets'])
    t['total_assets'] = t['total_non_current_assets'] + t['total_current_assets']
    t['total_equity'] = s(['share_capital','retained_earnings','other_reserves','non_controlling_interests'])
    t['total_non_current_liabilities'] = s(['long_term_borrowings','deferred_tax_liabilities','long_term_provisions','other_non_current_liabilities'])
    t['total_current_liabilities'] = s(['short_term_borrowings','trade_payables','other_payables','current_tax_liabilities','short_term_provisions','other_current_liabilities'])
    t['total_liabilities'] = t['total_non_current_liabilities'] + t['total_current_liabilities']
    t['total_equity_and_liabilities'] = t['total_equity'] + t['total_liabilities']
    t['gross_profit'] = v.get('revenue',0) - v.get('cost_of_sales',0)
    t['operating_profit'] = t['gross_profit'] - v.get('distribution_expenses',0) - v.get('administrative_expenses',0) + v.get('other_operating_income',0) - v.get('other_operating_expenses',0)
    t['profit_before_tax'] = t['operating_profit'] + v.get('finance_income',0) - v.get('finance_costs',0) + v.get('other_non_operating',0)
    t['net_profit'] = t['profit_before_tax'] - v.get('income_tax',0)
    return t

def check_template(tpl, errs, where):
    kind = tpl.get('form_kind')
    if kind not in SECTIONS: errs.append(f'{where}: form_kind must be balance_sheet|income_statement'); return
    for k in ['code','fidelity','local_language','name','lines']:
        if k not in tpl: errs.append(f'{where}: missing {k}')
    if tpl.get('fidelity') not in FIDELITY: errs.append(f'{where}: bad fidelity')
    if not re.fullmatch(r'[A-Z0-9_]+', tpl.get('code','')): errs.append(f'{where}: code must be UPPER_SNAKE')
    for lang in ['en','ru','uz','local']:
        if not tpl.get('name',{}).get(lang): errs.append(f'{where}: name.{lang} missing')
    cols = BS_COLS if kind == 'balance_sheet' else IS_COLS
    totals = BS_TOTALS if kind == 'balance_sheet' else IS_TOTALS
    lines = tpl.get('lines', [])
    codes = [l.get('code') for l in lines]
    if len(codes) != len(set(codes)): errs.append(f'{where}: duplicate line codes {sorted({c for c in codes if codes.count(c)>1})}')
    byc = {l.get('code'): l for l in lines}
    checks = 0
    for i, l in enumerate(lines):
        w = f"{where} line {l.get('code')}"
        for k in ['code','section','indent','subtotal','negative','name']:
            if k not in l: errs.append(f'{w}: missing {k}')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,12}', str(l.get('code',''))): errs.append(f'{w}: code must be 1-12 chars [A-Za-z0-9._-]')
        if l.get('section') not in SECTIONS[kind]: errs.append(f"{w}: section {l.get('section')} not in {sorted(SECTIONS[kind])}")
        for lang in ['en','ru','uz','local']:
            if not l.get('name',{}).get(lang): errs.append(f'{w}: name.{lang} missing')
        if UZ_BAD.search(l.get('name',{}).get('uz','')): errs.append(f"{w}: uz name must use U+2018 ‘ (o‘, g‘), not other apostrophes")
        m = l.get('map')
        if m is not None:
            if m.get('column') not in cols: errs.append(f"{w}: map.column {m.get('column')} not a mappable {kind} column")
            if m.get('sign') not in (1,-1): errs.append(f'{w}: map.sign must be 1 or -1')
        f = l.get('formula')
        if f is not None:
            for c in f.get('plus',[]) + f.get('minus',[]):
                if c not in byc: errs.append(f'{w}: formula references unknown line {c}')
        if l.get('check') is not None:
            checks += 1
            if l['check'] not in totals: errs.append(f"{w}: check {l['check']} not a computed {kind} total {totals}")
            if f is None: errs.append(f'{w}: a line with check needs a formula')
        if l.get('subtotal') and f is None: errs.append(f'{w}: subtotal line needs a formula')
        if not l.get('subtotal') and m is None and f is None and not l.get('note'):
            errs.append(f'{w}: unmapped leaf line needs a note saying why (memo / breakdown)')
    if checks == 0: errs.append(f'{where}: no cross-check lines at all')
    # numeric consistency: random leaves -> formulas -> mapping -> IFRS totals vs checked lines
    for trial in range(5):
        vals = {}
        def val(c, stack=()):
            if c in vals: return vals[c]
            if c in stack: raise ValueError(f'formula cycle at {c}')
            l = byc[c]; f = l.get('formula')
            if f is None:
                vals[c] = float(random.randint(1, 10**6))
            else:
                vals[c] = sum(val(x, stack+(c,)) for x in f.get('plus',[])) - sum(val(x, stack+(c,)) for x in f.get('minus',[]))
            return vals[c]
        try:
            for c in codes: val(c)
        except (ValueError, KeyError) as e:
            errs.append(f'{where}: {e}'); return
        mapped = {}
        for l in lines:
            m = l.get('map')
            if m: mapped[m['column']] = mapped.get(m['column'], 0) + vals[l['code']] * m['sign']
        t = ifrs_totals(mapped)
        for l in lines:
            if l.get('check') and abs(t[l['check']] - vals[l['code']]) > 0.5:
                errs.append(f"{where} line {l['code']}: cross-check FAILS: local {vals[l['code']]:.0f} vs IFRS {l['check']} {t[l['check']]:.0f} (double counting, a missing mapping, or a wrong sign)")
                break
        else:
            continue
        break

def main():
    ok = True
    for path in sys.argv[1:]:
        errs = []
        try:
            d = json.load(open(path, encoding='utf-8'))
        except Exception as e:
            print(f'{path}: invalid JSON: {e}'); ok = False; continue
        fw = d.get('framework', {})
        for k in ['code','kind','short','name','legal_basis','countries']:
            if k not in fw: errs.append(f'framework: missing {k}')
        if fw.get('kind') not in KINDS: errs.append('framework.kind must be national_gaap|ifrs_based')
        for lang in ['en','ru','uz']:
            if not fw.get('short',{}).get(lang): errs.append(f'framework.short.{lang} missing')
            if not fw.get('name',{}).get(lang): errs.append(f'framework.name.{lang} missing')
        for c in fw.get('countries', []):
            if not re.fullmatch(r'[A-Z]{2}', c): errs.append(f'framework.countries: bad code {c}')
        kinds = sorted(t.get('form_kind') for t in d.get('templates', []))
        if kinds != ['balance_sheet','income_statement']: errs.append('templates must be exactly one balance_sheet and one income_statement')
        for t in d.get('templates', []):
            check_template(t, errs, t.get('code','?'))
        if errs:
            ok = False
            print(f'{path}: {len(errs)} problem(s)'); [print('  -', e) for e in errs]
        else:
            n = sum(len(t['lines']) for t in d['templates'])
            print(f'{path}: OK ({n} lines)')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
