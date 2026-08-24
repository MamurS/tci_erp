from copy import deepcopy
import datetime

from src.mapping import CURRENCY_MAPPING

class CalculatorRatiosAndDynamic:
    def __init__(
        self,
        dict_with_data: dict,
        target_company_registration_identifier: str,
    ):
        self.dict_with_data = dict_with_data
        self.target_company_registration_identifier = target_company_registration_identifier
    
    def __get_sort_key(self, company):
                periods_order = ['current_period', 'previous_period', 'before_previous_period']
                total = 0
                for i, period in enumerate(periods_order):
                    if period in company['data']:
                        # Учитываем приоритет периода (чем раньше, тем важнее)
                        # Умножаем на коэффициент убывающей важности
                        multiplier = 10 ** (len(periods_order) - i)
                        period_data = company['data'][period]
                        total += (period_data['amount']['plaintiff'] + period_data['amount']['defendant']) * multiplier
                return -total  # Для сортировки по убыванию
    
    def __aggregate_court_cases_data(
        self,
        data: dict,
        target_company_registration_identifier: str,
        target_company_last_available_period: str
    ) -> None:
        previous_period = str(int(target_company_last_available_period) - 1)
        before_previous_period = str(int(previous_period) - 1)
        periods = [target_company_last_available_period, previous_period, before_previous_period]
        period_keys = ["current_period", "previous_period", "before_previous_period"]
        result = []
        for registration_identifier in data:
            if registration_identifier != "COMBINED":
                court_cases_data = {
                    "registration_identifier": registration_identifier,
                    "data": {},
                    "company_name": "-",
                    "currency": None,
                }
                
                for idx, period in enumerate(periods):
                    court_cases_data["data"][period_keys[idx]] = {
                        "amount": {
                            "plaintiff": 0,
                            "defendant": 0,
                        },
                        "count": {
                            "plaintiff": 0,
                            "defendant": 0,
                        },
                    }
                    
                    court_cases: dict = data[registration_identifier].get(period, {}).get("court_cases", {})
                    
                    currency = {v: k for k, v in CURRENCY_MAPPING.items()}.get(court_cases.get("currency_id"), None)
                    # Plaintiff
                    
                    if isinstance(court_cases, dict) and court_cases.get("Plaintiff"):
                        plaintiff = [amount if amount is not None else 0 for _, amount in court_cases["Plaintiff"].items()]
                        plaintiff_count = len(plaintiff)
                        plaintiff_amount = sum(plaintiff)
                    else:
                        plaintiff_count = 0
                        plaintiff_amount = 0
                        
                    # Defendant
                    if isinstance(court_cases, dict) and court_cases.get("Defendant"):
                        defendant = [amount if amount is not None else 0 for _, amount in court_cases["Defendant"].items()]
                        defendant_count = len(defendant)
                        defendant_amount = sum(defendant)
                    else:
                        defendant_count = 0
                        defendant_amount = 0
                    
                    if currency:
                        court_cases_data["currency"] = currency
                    
                    court_cases_data["data"][period_keys[idx]]["amount"]["plaintiff"] += plaintiff_amount
                    court_cases_data["data"][period_keys[idx]]["amount"]["defendant"] += defendant_amount
                    
                    court_cases_data["data"][period_keys[idx]]["count"]["plaintiff"] += plaintiff_count
                    court_cases_data["data"][period_keys[idx]]["count"]["defendant"] += defendant_count
                
                court_cases_data_cp = deepcopy(court_cases_data)
                if registration_identifier == target_company_registration_identifier:
                    if len(result) > 0:
                        result.insert(0, court_cases_data_cp)
                    else:
                        result.append(court_cases_data_cp)
                else:
                    result.append(court_cases_data_cp)
            
            # Фильтруем
            filtered_data = [
                company for company in result 
                if any(
                    value != 0
                    for period in company['data'].values()
                    for role in ['plaintiff', 'defendant']
                    for value in [period['amount'][role], period['count'][role]]
                )
            ]
            
            # Сортируем
            sorted_data = sorted(filtered_data, key=self.__get_sort_key)
        
        data[self.target_company_registration_identifier][target_company_last_available_period].update({"court_cases_data": sorted_data})
    
    @staticmethod
    def __calculate_dynamic_value(current_value: int|float, previous_value: int|float) -> float|None:
        """
        Расчёт динамики показателя
        
        :param current_value: int|float | текущее значение показателя
        :param previous_value: int|float | предыдущее значение показателя
        :return: float|None | динамика изменения показателя в вещественном виде(не в %)
        """
        
        percentage_change = (current_value - previous_value) / abs(previous_value) \
            if previous_value is not None and current_value is not None and previous_value != 0 \
            else float("-inf") \
            if previous_value is not None and current_value is not None and previous_value == 0 and current_value < 0 \
            else float("inf") \
            if previous_value is not None and current_value is not None and previous_value == 0 and current_value > 0 \
            else 0 \
            if previous_value is not None and current_value is not None and previous_value == 0 and current_value == 0 \
            else None
        
        return percentage_change
    
    
    def __calculate_ratios(self) -> dict:
        """
        Расчет финансовых показателей
        
        :return: dict
        """
        data = self.dict_with_data["data"]
        for registration_identifier in data:
            # if registration_identifier != "COMBINED":
            #     COMBINED = self.dict_with_data["data"].get("COMBINED", None)
            # else:
            #     COMBINED = None
            for period in list(sorted(list(self.dict_with_data["data"][registration_identifier]))):
                if period != "court_cases_data":
                    # __________________________________________________________________________________________________________
                    
                    company_report_for_period = data[registration_identifier][period]
                    age: float = company_report_for_period.get("age", None)
                    # BALANCE SHEET RATIOS
                    total_assets = company_report_for_period.get("total_assets", None)                                # Общая сумма АКТИВЫ == Общая сумма ПАССИВЫ | Валюта БАЛАНСА
                    # assets
                    non_current_assets = company_report_for_period.get("non_current_assets", None)                    # Внеоборотные активы
                    fixed_assets = company_report_for_period.get("fixed_assets", None)                                # Долгосрочные активы
                    long_term_investments = company_report_for_period.get("long_term_investments", None)              # Долгосрочные вложения
                    total_long_term_assets = company_report_for_period.get("total_long_term_assets", None)            # Общая сумма всех долгосрочных активов
                    inventories = company_report_for_period.get("inventories", None)                                  # Запасы
                    accounts_receivable = company_report_for_period.get("accounts_receivable", None)                  # Дебиторская задолженность                 | то, что должны "мне"
                    cash = company_report_for_period.get("cash", None)                                                # Деньги на расчетном счете                 | наиболее ликвидный актив
                    short_term_investments = company_report_for_period.get("short_term_investments", None)            # Краткосрочные вложения                    | вложение денег в пользование
                    total_short_term_assets = company_report_for_period.get("total_short_term_assets", None)          # Общая сумма краткосрочных активов
                    
                    # EQUITY & LIABILITIES
                    equity = company_report_for_period.get("equity", None)                                            # Собственный капитал компании              | Складывается из капиталов компании
                    long_term_debt = company_report_for_period.get("long_term_debt", None)                            # Долгосрочные займы/кредиты от третьих лиц (свыше кода)
                    total_long_term_liabilities = company_report_for_period.get("total_long_term_liabilities", None)  # Долгосрочные обязательства
                    short_term_debt = company_report_for_period.get("short_term_debt", None)                          # Краткосрочные займы/кредиты от третьих лиц
                    total_short_term_liabilities = company_report_for_period.get("total_short_term_liabilities", None)# Краткосрочные обязательства
                    accounts_payable = company_report_for_period.get("accounts_payable", None)                        # Кредиторская задолженность поставщикам
                    
                    gross_debt = abs(long_term_debt) + abs(short_term_debt) \
                        if long_term_debt is not None and short_term_debt is not None else long_term_debt \
                        if long_term_debt is not None and not short_term_debt else short_term_debt \
                        if short_term_debt is not None and not long_term_debt else 0
                    
                    company_report_for_period["gross_debt"] = gross_debt
                    
                    # PROFIT & LOSS RATIOS
                    revenue = company_report_for_period.get("revenue", None)                                          # Выручка                                    | Продажи за период
                    cost_of_goods_sold = company_report_for_period.get("cost_of_goods_sold", None)                    # Себестоимость проданных товаров/услуг      | Затраты на товары/услуги
                    gross_financial_result = company_report_for_period.get("gross_financial_result", None)            # Валовая прибыль                            | Прибыль (Без учета себестоимости)
                    administrative_expanses = company_report_for_period.get("administrative_expanses", None)          # Административные расходы                   | Организационные затраты производства
                    commercial_expanses = company_report_for_period.get("commercial_expanses", None)                  # Коммерческие расходы                       | Расходы на продажу товаров
                    operating_financial_result = company_report_for_period.get("operating_financial_result", None)    # Операционный результат(прибыль/убыток)     | Результат от основной деятельности
                    interest_income = company_report_for_period.get("interest_income", None)                          # Проценты к получению
                    interest_expenses = company_report_for_period.get("interest_expenses", None)                      # Проценты к уплате
                    other_operating_income = company_report_for_period.get("other_operating_inсome", None)            # Прочие доходы                              | Ситуативные доходы
                    other_operating_expanses = company_report_for_period.get("other_operating_expanses", None)        # Прочие расходы                             | Ситуативные расходы
                    financial_result_before_tax = company_report_for_period.get("financial_result_before_tax", None)  # Результат до налогов                       | До вычета налогов, сколько компания получила(прибыли/убытков)
                    income_tax = company_report_for_period.get("income_tax", None)                                    # Налог на прибыль
                    net_financial_result = company_report_for_period.get("net_financial_result", None)                # Чистая прибыль/убыток                      | Результат, после вычета всех налогов (при прибыли -> нераспределенный капитал)
                    
                    
                    # CASHFLOW RATIOS
                    cashflow_from_operations = company_report_for_period.get("cashflow_from_operations", None)        # Денежный поток от текущей операционной деятельности (CFO)
                    capital_expenses = company_report_for_period.get("capital_expenses", None)                        # Капитальные расходы
                    # __________________________________________________________________________________________________________
                    
                    # FINANCIAL RATIOS
                    # Автономия капитала                               |
                    company_report_for_period["equity_ratio"] = equity / total_assets \
                        if (equity and equity > 0) and (total_assets and total_assets > 0) else float("inf") \
                        if (equity and equity > 0) and total_assets == 0 else float("-inf") \
                        if (equity is not None and equity <= 0) else None
                    # Чистый оборотный(рабочий) капитал                | Норма - 0, Плохо < 0, Хорошо > 0
                    company_report_for_period["net_working_capital"] = total_short_term_assets - total_short_term_liabilities \
                        if total_short_term_assets is not None and total_short_term_liabilities is not None else total_short_term_assets \
                        if total_short_term_assets is not None and total_short_term_liabilities is None else total_short_term_liabilities \
                        if total_short_term_assets is None and total_short_term_liabilities is not None else None
                    
                    # Текущая ликвидность                              | Норма - 1
                    company_report_for_period["current_ratio"] = total_short_term_assets / total_short_term_liabilities \
                        if (total_short_term_liabilities is not None and total_short_term_liabilities > 0) and (total_short_term_assets is not None and total_short_term_assets > 0) else float("inf") \
                        if total_short_term_liabilities == 0 else float("-inf") \
                        if total_short_term_assets == 0 else None  # TODO сделать предусловие над assessment: если total_short_term_liabilities == 0, то понизить значимость оценки
                    
                    # Финансовый рычаг                                 | Отношение всего долга к капиталу (Норма - до 2)
                    company_report_for_period["debt_to_equity"] = gross_debt / equity \
                        if (gross_debt is not None and gross_debt >= 0) and (equity and equity > 0) else float("-inf") \
                        if (equity is not None and equity <= 0) else None
                    
                    # Валовая маржа                                    | Норма ~ 0.15-0.25
                    company_report_for_period["gross_margin"] = gross_financial_result / revenue \
                        if (gross_financial_result is not None and gross_financial_result >= 0) and (revenue is not None and revenue > 0) else float("-inf") \
                        if revenue == 0 else None
                    
                    # Оперативная валовая маржа                        | Норма ~ 0.05-0.1
                    company_report_for_period["operating_margin"] = operating_financial_result / revenue \
                        if operating_financial_result is not None and (revenue and revenue > 0) else float("-inf") \
                        if (revenue is not None and revenue == 0) else None
                    
                    # Рентабельность активов к активам компании        | Норма -> Зависит от типа деятельности (чем больше тем лучше)
                    company_report_for_period["return_on_assets"] = net_financial_result / total_assets \
                        if (net_financial_result is not None and net_financial_result >= 0) and (total_assets and total_assets > 0) else float("-inf") \
                        if (net_financial_result is not None and net_financial_result < 0) else None
                    
                    # Рентабельность активов к капиталу                | Норма -> Зависит от типа деятельности (чем больше тем лучше)
                    company_report_for_period["return_on_equity"] = net_financial_result / equity \
                        if (net_financial_result is not None and net_financial_result >= 0) and (equity is not None and equity > 0) else float("-inf") \
                        if (equity is not None and equity < 0) or (net_financial_result is not None and net_financial_result < 0) else float("inf") \
                        if (equity is not None and equity == 0) else None  # (???)
                    
                    # Долг к активам                                   | Норма -> ~30%, больше - плохо, меньше - хорошо
                    company_report_for_period["debt_to_assets"] = gross_debt / total_assets \
                        if (gross_debt is not None and gross_debt >= 0) and (total_assets is not None and total_assets > 0) else float("inf") \
                        if total_assets == 0 else None
                    
                    
                    if company_report_for_period["financial_statement_period_type"] == "Annual":
                        days_given_financial_statement_period_type: int = (datetime.datetime.strptime(f"01.01.{int(period) + 1}", "%d.%m.%Y").date() - datetime.datetime.strptime(f"01.01.{int(period)}", "%d.%m.%Y").date()).days
                    elif company_report_for_period["financial_statement_period_type"] == "Quarterly":
                        days_given_financial_statement_period_type: int = 90
                    elif company_report_for_period["financial_statement_period_type"] == "Semi-annual":
                        days_given_financial_statement_period_type: int = 182
                    elif company_report_for_period["financial_statement_period_type"] == "Nine month":
                        days_given_financial_statement_period_type: int = 273
                    # (DIO)Оборачиваемость запасов                     | Норма ->
                    company_report_for_period["days_inventory_outstanding"] = (inventories / abs(cost_of_goods_sold)) * days_given_financial_statement_period_type \
                        if (inventories is not None or inventories == 0) and cost_of_goods_sold else (inventories / revenue) * days_given_financial_statement_period_type \
                        if (inventories is not None or inventories == 0) and (revenue is not None and revenue > 0) else None
                    
                    # (DSO)Оборачиваемость дебеторской задолженности   | Норма -> 36, Плохо - выше 48, Хорошо - 30 и ниже
                    company_report_for_period["days_sales_outstanding"] = (accounts_receivable / revenue) * days_given_financial_statement_period_type \
                        if (accounts_receivable is not None or (accounts_receivable is not None and accounts_receivable >= 0)) and (revenue is not None and revenue > 0) else None
                    
                    # (DPO)Период погашения кредиторской задолженности | Норма -> 40, Плохо - выше 53, Хорошо - 30 и ниже
                    company_report_for_period["days_payable_outstanding"] = (accounts_payable / abs(cost_of_goods_sold)) * days_given_financial_statement_period_type \
                        if (accounts_payable is not None or (accounts_payable is not None and accounts_payable >= 0)) and (cost_of_goods_sold is not None and cost_of_goods_sold != 0) \
                        else (accounts_payable / abs(revenue)) * days_given_financial_statement_period_type \
                            if (accounts_payable is not None or (accounts_payable is not None and accounts_payable >= 0)) and (revenue is not None and revenue > 0) \
                            else None
                    
                    # (CCC)Денежный цикл                               | Норма -> 52, Плохо - выше 74, Хорошо - 34 и ниже
                    company_report_for_period["cash_conversion_cycle"] = company_report_for_period["days_inventory_outstanding"] + company_report_for_period["days_sales_outstanding"] - company_report_for_period["days_payable_outstanding"] \
                        if company_report_for_period["days_inventory_outstanding"] is not None and company_report_for_period["days_sales_outstanding"] is not None and company_report_for_period["days_payable_outstanding"] is not None else None
                    
                    # Доход до вычета налогов и процентов
                    company_report_for_period["EBIT"] = financial_result_before_tax + abs(interest_expenses) - abs(interest_income) \
                        if (financial_result_before_tax is not None or financial_result_before_tax == 0) and (interest_expenses or interest_expenses == 0) and (interest_income or interest_income == 0) \
                        else (operating_financial_result + abs(interest_income if interest_income else 0) + abs(other_operating_income if other_operating_income else 0) - abs(interest_expenses if interest_expenses else 0) - abs(other_operating_expanses if other_operating_expanses else 0)) + abs(interest_expenses if interest_expenses else 0) - abs(interest_income if interest_income else 0) \
                        if (operating_financial_result is not None or operating_financial_result == 0) else None
                    
                    # Норма операционной прибыли                       |
                    company_report_for_period["EBIT_margin"] = company_report_for_period["EBIT"] / revenue \
                        if company_report_for_period["EBIT"] is not None and (revenue is not None and revenue > 0) else float("-inf") \
                        if (revenue is not None and revenue == 0) else None
                    
                    # Долг к EBIT                                      |
                    company_report_for_period["debt_to_EBIT"] = gross_debt / company_report_for_period["EBIT"] \
                        if (gross_debt is not None or gross_debt == 0) and (company_report_for_period["EBIT"] and company_report_for_period["EBIT"] > 0) else float("inf") \
                        if (gross_debt and company_report_for_period["EBIT"] is not None and company_report_for_period["EBIT"] <= 0) else 0 \
                        if gross_debt is not None and gross_debt == 0 else None
                    
                    # Процентное покрытие                              | Норма -> ниже 2 плохо, 2 - норма, выше 2 - хорошо
                    company_report_for_period["interest_coverage"] = company_report_for_period["EBIT"] / abs(interest_expenses) \
                        if company_report_for_period["EBIT"] is not None and interest_expenses is not None and interest_expenses != 0 else float("inf") \
                        if company_report_for_period["EBIT"] is not None and interest_expenses is not None and interest_expenses == 0 else None
                    
                    # Норма чистой прибыли                             |
                    company_report_for_period["net_profitability"] = net_financial_result / revenue \
                        if net_financial_result is not None and (revenue is not None and revenue > 0) else float("-inf") \
                        if (net_financial_result is not None and net_financial_result < 0) and (revenue is not None and revenue == 0) else float("inf") \
                        if (net_financial_result is not None and net_financial_result > 0) and (revenue is not None and revenue == 0) else None
                    
                    # Свободный денежный поток                         |
                    company_report_for_period["free_cashflow"] = cashflow_from_operations - abs(capital_expenses) \
                        if cashflow_from_operations is not None and capital_expenses is not None else None
                    
                    # Операционные расходы всего                       |
                    company_report_for_period["total_operating_costs"] = abs(commercial_expanses) + abs(administrative_expanses) \
                        if commercial_expanses is not None and administrative_expanses is not None else commercial_expanses \
                        if commercial_expanses is not None else administrative_expanses \
                        if administrative_expanses is not None else None
                    
                    # Отношение всего операционных расходов к выручке
                    company_report_for_period["total_operating_costs_to_revenue_ratio"] = abs(company_report_for_period["total_operating_costs"]) / revenue \
                        if company_report_for_period["total_operating_costs"] is not None and (revenue is not None and revenue > 0) else float("-inf") \
                        if (revenue is not None and revenue == 0) else None
        
        return self.dict_with_data
    
    def __calculate_dynamics(self):
        """
        Метод расчета динамики показателей. Результат сохраняется в виде десятичной дроби по каждому показателю
        
        :return: dict
        """
        data = self.dict_with_data["data"]
        
        for registration_identifier in data:
            if len(data[registration_identifier]) == 1:
                data[registration_identifier][list(data[registration_identifier])[0]]["dynamic"] = False
                return self.dict_with_data
            else:
                for period in list(sorted(data[registration_identifier]))[1:]:
                    company_report_for_period = data[registration_identifier][period]
                    company_report_for_previous_period = data[registration_identifier][str(int(period) - 1)]
                    
                    # BALANCE_DYNAMIC
                    company_report_for_period['total_assets_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["total_assets"], previous_value=company_report_for_previous_period["total_assets"])
                    company_report_for_period['fixed_assets_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["fixed_assets"], previous_value=company_report_for_previous_period["fixed_assets"])
                    company_report_for_period['long_term_investments_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["long_term_investments"], previous_value=company_report_for_previous_period["long_term_investments"])
                    company_report_for_period['total_long_term_assets_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["total_long_term_assets"], previous_value=company_report_for_previous_period["total_long_term_assets"])
                    company_report_for_period['inventories_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["inventories"], previous_value=company_report_for_previous_period["inventories"])
                    company_report_for_period['accounts_receivable_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["accounts_receivable"], previous_value=company_report_for_previous_period["accounts_receivable"])
                    company_report_for_period['cash_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["cash"], previous_value=company_report_for_previous_period["cash"])
                    company_report_for_period['short_term_investments_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["short_term_investments"], previous_value=company_report_for_previous_period["short_term_investments"])
                    company_report_for_period['total_short_term_assets_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["total_short_term_assets"], previous_value=company_report_for_previous_period["total_short_term_assets"])
                    company_report_for_period['net_working_capital_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["net_working_capital"], previous_value=company_report_for_previous_period["net_working_capital"])
                    company_report_for_period['equity_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["equity"], previous_value=company_report_for_previous_period["equity"])
                    company_report_for_period['long_term_debt_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["long_term_debt"], previous_value=company_report_for_previous_period["long_term_debt"])
                    company_report_for_period['total_long_term_liabilities_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["total_long_term_liabilities"], previous_value=company_report_for_previous_period["total_long_term_liabilities"])
                    company_report_for_period['short_term_debt_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["short_term_debt"], previous_value=company_report_for_previous_period["short_term_debt"])
                    company_report_for_period['accounts_payable_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["accounts_payable"], previous_value=company_report_for_previous_period["accounts_payable"])
                    company_report_for_period['total_short_term_liabilities_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["total_short_term_liabilities"], previous_value=company_report_for_previous_period["total_short_term_liabilities"])
                    # p & l
                    company_report_for_period['revenue_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["revenue"], previous_value=company_report_for_previous_period["revenue"])                    
                    company_report_for_period['cost_of_goods_sold_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["cost_of_goods_sold"], previous_value=company_report_for_previous_period["cost_of_goods_sold"])
                    company_report_for_period['gross_financial_result_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["gross_financial_result"], previous_value=company_report_for_previous_period["gross_financial_result"])
                    company_report_for_period['administrative_expanses_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["administrative_expanses"], previous_value=company_report_for_previous_period["administrative_expanses"])
                    company_report_for_period['commercial_expanses_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["commercial_expanses"], previous_value=company_report_for_previous_period["commercial_expanses"])
                    company_report_for_period['operating_financial_result_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["operating_financial_result"], previous_value=company_report_for_previous_period["operating_financial_result"])
                    company_report_for_period['interest_income_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["interest_income"], previous_value=company_report_for_previous_period["interest_income"])
                    company_report_for_period['interest_expenses_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["interest_expenses"], previous_value=company_report_for_previous_period["interest_expenses"])
                    company_report_for_period['other_operating_income_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["other_operating_income"], previous_value=company_report_for_previous_period["other_operating_income"])
                    company_report_for_period['other_operating_expanses_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["other_operating_expanses"], previous_value=company_report_for_previous_period["other_operating_expanses"])
                    company_report_for_period['financial_result_before_tax_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["financial_result_before_tax"], previous_value=company_report_for_previous_period["financial_result_before_tax"])
                    company_report_for_period['income_tax_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["income_tax"], previous_value=company_report_for_previous_period["income_tax"])
                    company_report_for_period['net_financial_result_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["net_financial_result"], previous_value=company_report_for_previous_period["net_financial_result"])
                    company_report_for_period['net_profitability_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["net_profitability"], previous_value=company_report_for_previous_period["net_profitability"])
                    company_report_for_period['cashflow_from_operations_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["cashflow_from_operations"], previous_value=company_report_for_previous_period["cashflow_from_operations"])
                    company_report_for_period['free_cashflow_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["free_cashflow"], previous_value=company_report_for_previous_period["free_cashflow"])
                    company_report_for_period['capital_expenses_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["capital_expenses"], previous_value=company_report_for_previous_period["capital_expenses"])
                    company_report_for_period['EBIT_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["EBIT"], previous_value=company_report_for_previous_period["EBIT"])
                    company_report_for_period['EBIT_margin_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["EBIT_margin"], previous_value=company_report_for_previous_period["EBIT_margin"])
                    company_report_for_period['total_operating_costs_to_revenue_ratio_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["total_operating_costs_to_revenue_ratio"], previous_value=company_report_for_previous_period["total_operating_costs_to_revenue_ratio"])
                    
                    # RATIOS_dynamic (!!!)
                    company_report_for_period['equity_ratio_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["equity_ratio"], previous_value=company_report_for_previous_period["equity_ratio"])
                    company_report_for_period['current_ratio_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["current_ratio"], previous_value=company_report_for_previous_period["current_ratio"])
                    company_report_for_period['debt_to_equity_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["debt_to_equity"], previous_value=company_report_for_previous_period["debt_to_equity"])
                    company_report_for_period['gross_margin_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["gross_margin"], previous_value=company_report_for_previous_period["gross_margin"])
                    company_report_for_period['operating_margin_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["operating_margin"], previous_value=company_report_for_previous_period["operating_margin"])
                    company_report_for_period['return_on_assets_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["return_on_assets"], previous_value=company_report_for_previous_period["return_on_assets"])
                    company_report_for_period['return_on_equity_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["return_on_equity"], previous_value=company_report_for_previous_period["return_on_equity"])
                    company_report_for_period['interest_coverage_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["interest_coverage"], previous_value=company_report_for_previous_period["interest_coverage"])
                    company_report_for_period['days_inventory_outstanding_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["days_inventory_outstanding"], previous_value=company_report_for_previous_period["days_inventory_outstanding"])
                    company_report_for_period['days_payable_outstanding_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["days_payable_outstanding"], previous_value=company_report_for_previous_period["days_payable_outstanding"])
                    company_report_for_period['days_sales_outstanding_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["days_sales_outstanding"], previous_value=company_report_for_previous_period["days_sales_outstanding"])
                    company_report_for_period['cash_conversion_cycle_dynamic'] = CalculatorRatiosAndDynamic.__calculate_dynamic_value(current_value=company_report_for_period["cash_conversion_cycle"], previous_value=company_report_for_previous_period["cash_conversion_cycle"])
                    # ______________________________________________________________________________________________________
                    
                    data[registration_identifier][period]["dynamic"] = True
        
        return self.dict_with_data
    
    def get_data_with_ratios_and_dynamics(self):
        data = self.dict_with_data["data"]
        target_company_data = data[self.target_company_registration_identifier]
        target_company_last_available_period = list(sorted(list(target_company_data)))[-1]
        
        self.__aggregate_court_cases_data(
            data=data,
            target_company_registration_identifier=self.target_company_registration_identifier,
            target_company_last_available_period=target_company_last_available_period,
        )
        self.__calculate_ratios()
        self.__calculate_dynamics()
        
        return self.dict_with_data
