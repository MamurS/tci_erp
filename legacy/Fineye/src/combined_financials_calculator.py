class CombinedFinancialCalculator:
    """Класс, суммирующий финансовые показатели и коэффициенты, выдающий комбинированный финансовый очет"""
    
    def __init__(self, dict_with_data: dict):
        self.dict_with_data = dict_with_data
    
    def __calculate_combined_financial(self):
        reports_companies = self.dict_with_data["data"]
        if len(self.dict_with_data["data"]) > 1:
            reports_companies["COMBINED"] = {}
            for registration_identifier in list(reports_companies):  # Расчет "COMBINED"
                if registration_identifier != "COMBINED":
                    for period in list(reports_companies[registration_identifier]):
                        if period != "currency":
                            if reports_companies[registration_identifier][period].get("financial_statement_period_type") != "Annual":
                                continue
                            if not reports_companies["COMBINED"].get(period, None):
                                reports_companies["COMBINED"][period] = {}
                            for item in list(reports_companies[registration_identifier][period]):
                                if reports_companies["COMBINED"][period].get(item, None):  # Если отсутствует показатель, то он не суммируется в "COMBINED"
                                    if reports_companies[registration_identifier][period].get(item, None) or isinstance(reports_companies[registration_identifier][period].get(item, None), (int, float)):
                                        if reports_companies["COMBINED"][period][item] == "n/a":
                                            reports_companies["COMBINED"][period][item] = 0
                                        if item != 'age':
                                            item_object = reports_companies[registration_identifier][period][item] if isinstance(reports_companies[registration_identifier][period][item], (int, float)) else None
                                            if item_object:
                                                reports_companies["COMBINED"][period][item] += item_object
                                        else:
                                            if reports_companies["COMBINED"][period]['age'] < reports_companies[registration_identifier][period][item]:
                                                reports_companies["COMBINED"][period]['age'] = reports_companies[registration_identifier][period][item]
                                else:
                                    reports_companies["COMBINED"][period][item] = reports_companies[registration_identifier][period][item] if reports_companies[registration_identifier][period][item] else "n/a"
            
            for year_combined in list(reports_companies["COMBINED"]):  # Приведение строк 'n/a' к общему виду "пустоты" - None
                for item_combined in reports_companies["COMBINED"][year_combined]:
                    if reports_companies["COMBINED"][year_combined][item_combined] == "n/a":
                        reports_companies["COMBINED"][year_combined][item_combined] = None
            
            company_data_for_all_available_periods = [self.dict_with_data["data"][rn] if rn != "COMBINED" else {} for rn in list(self.dict_with_data["data"])]
            
            currency = list(
                filter(
                    lambda x: x is not None,
                    [company_data[list(company_data)[0]].get("currency", None) if list(company_data) else None for company_data in company_data_for_all_available_periods]))[0]
            for period in list(sorted(list(self.dict_with_data["data"]["COMBINED"]))):
                self.dict_with_data["data"]["COMBINED"][period]["currency"] = currency
        
        return self.dict_with_data
    
    def __calculate_share(self) -> dict:
        """
        Метод для расчета долей показателей отдельных компаний, относительно комбинированной отчетности
        
        :return: dict | финансовый отчет дополненный долями показателей отдельных компаний
        от комбинированной отчетности
        """
        for registration_identifier in list(self.dict_with_data["data"]):
            if registration_identifier != "COMBINED":
                COMBINED = self.dict_with_data["data"].get("COMBINED", None)
            else:
                COMBINED = None
            
            if COMBINED:
                for report_period in list(self.dict_with_data["data"][registration_identifier]):
                    if report_period != "currency":
                        # __________________________________________________________________________________________________________
                        period: int = report_period
                        
                        company_report_for_period = self.dict_with_data["data"][registration_identifier][period]
                        
                        age: float = company_report_for_period.get("age", None)
                        # BALANCE SHEET RATIOS
                        total_assets = company_report_for_period.get("total_assets", None)  # Общая сумма АКТИВЫ == Общая сумма ПАССИВЫ | Валюта БАЛАНСА
                        # assets
                        non_current_assets = company_report_for_period.get("non_current_assets", None)  # Внеоборотные активы
                        fixed_assets = company_report_for_period.get("fixed_assets", None)  # Долгосрочные активы
                        long_term_investments = company_report_for_period.get("long_term_investments", None)  # Долгосрочные вложения
                        total_long_term_assets = company_report_for_period.get("total_long_term_assets", None)  # Общая сумма всех долгосрочных активов
                        inventories = company_report_for_period.get("inventories", None)  # Запасы
                        accounts_receivable = company_report_for_period.get("accounts_receivable", None)  # Дебиторская задолженность                 | то, что должны "мне"
                        cash = company_report_for_period.get("cash", None)  # Деньги на расчетном счете                 | наиболее ликвидный актив
                        short_term_investments = company_report_for_period.get("short_term_investments", None)  # Краткосрочные вложения                    | вложение денег в пользование
                        total_short_term_assets = company_report_for_period.get("total_short_term_assets", None)  # Общая сумма краткосрочных активов
                        
                        # EQUITY & LIABILITIES
                        equity = company_report_for_period.get("equity", None)  # Собственный капитал компании              | Складывается из капиталов компании
                        long_term_debt = company_report_for_period.get("long_term_debt", None)  # Долгосрочные займы/кредиты от третьих лиц (свыше кода)
                        total_long_term_liabilities = company_report_for_period.get("total_long_term_liabilities", None)  # Долгосрочные обязательства
                        short_term_debt = company_report_for_period.get("short_term_debt", None)  # Краткосрочные займы/кредиты от третьих лиц
                        total_short_term_liabilities = company_report_for_period.get("total_short_term_liabilities", None)  # Краткосрочные обязательства
                        accounts_payable = company_report_for_period.get("accounts_payable", None)  # Кредиторская задолженность поставщикам
                        
                        gross_debt = abs(long_term_debt) + abs(short_term_debt) \
                            if long_term_debt is not None and short_term_debt is not None else long_term_debt \
                            if long_term_debt is not None and not short_term_debt else short_term_debt \
                            if short_term_debt is not None and not long_term_debt else 0
                        
                        company_report_for_period["gross_debt"] = gross_debt
                        
                        # PROFIT & LOSS RATIOS
                        revenue = company_report_for_period.get("revenue", None)  # Выручка                                    | Продажи за период
                        cost_of_goods_sold = company_report_for_period.get("cost_of_goods_sold", None)  # Себестоимость проданных товаров/услуг      | Затраты на товары/услуги
                        gross_financial_result = company_report_for_period.get("gross_financial_result", None)  # Валовая прибыль                            | Прибыль (Без учета себестоимости)
                        administrative_expanses = company_report_for_period.get("administrative_expanses", None)  # Административные расходы                   | Организационные затраты производства
                        commercial_expanses = company_report_for_period.get("commercial_expanses", None)  # Коммерческие расходы                       | Расходы на продажу товаров
                        operating_financial_result = company_report_for_period.get("operating_financial_result", None)  # Операционный результат(прибыль/убыток)     | Результат от основной деятельности
                        interest_income = company_report_for_period.get("interest_income", None)  # Проценты к получению
                        interest_expenses = company_report_for_period.get("interest_expenses", None)  # Проценты к уплате
                        other_operating_income = company_report_for_period.get("other_operating_inсome", None)  # Прочие доходы                              | Ситуативные доходы
                        other_operating_expanses = company_report_for_period.get("other_operating_expanses", None)  # Прочие расходы                             | Ситуативные расходы
                        financial_result_before_tax = company_report_for_period.get("financial_result_before_tax", None)  # Результат до налогов                       | До вычета налогов, сколько компания получила(прибыли/убытков)
                        income_tax = company_report_for_period.get("income_tax", None)  # Налог на прибыль
                        net_financial_result = company_report_for_period.get("net_financial_result", None)  # Чистая прибыль/убыток                      | Результат, после вычета всех налогов (при прибыли -> нераспределенный капитал)
                        
                        # CASHFLOW RATIOS  # TODO Пока не используем
                        cashflow_from_operations = company_report_for_period.get("cashflow_from_operations", None)  # Денежный поток от текущей операционной деятельности (CFO)
                        capital_expenses = company_report_for_period.get("capital_expenses", None)  # Капитальные расходы
                        # __________________________________________________________________________________________________________
                        
                        # company_report_for_period["revenue_share"] = COMBINED[period]["revenue"] / revenue \
                        #     if COMBINED[period].get("revenue", None) and revenue else 0 \
                        #     if COMBINED[period].get("revenue", None) and revenue is not None and revenue == 0 else None
                        
                        # company_report_for_period["EBIT_share"] = COMBINED[period]["EBIT"] / company_report_for_period["EBIT"] \
                        #     if COMBINED[period].get("EBIT", None) and company_report_for_period["EBIT"] else 0 \
                        #     if COMBINED[period].get("EBIT", None) and company_report_for_period["EBIT"] is not None and company_report_for_period[
                        #     "EBIT"] == 0 else None
                        
                        # company_report_for_period["gross_debt_share"] = COMBINED[period]["gross_debt"] / gross_debt \
                        #     if COMBINED[period].get("gross_debt", None) and gross_debt else 0 \
                        #     if COMBINED[period].get("gross_debt", None) and gross_debt is not None and gross_debt == 0 else None
                        
                        # company_report_for_period["total_operating_costs_share"] = COMBINED[period]["total_operating_costs"] / company_report_for_period["total_operating_costs"] \
                        #     if COMBINED[period].get("total_operating_costs", None) and company_report_for_period["total_operating_costs"] else 0 \
                        #     if COMBINED[period].get("total_operating_costs", None) and company_report_for_period["total_operating_costs"] is not None and company_report_for_period["total_operating_costs"] == 0 \
                        #     else None
                        
                        # company_report_for_period["net_financial_result_share"] = COMBINED[period]["net_financial_result"] / net_financial_result \
                        #     if COMBINED[period].get("net_financial_result", None) and net_financial_result else 0 \
                        #     if COMBINED[period].get("net_financial_result", None) and net_financial_result is not None and net_financial_result == 0 else None
        
        return self.dict_with_data
    
    def get_data_with_combined(self):
        self.__calculate_combined_financial()
        self.__calculate_share()
        
        return self.dict_with_data
