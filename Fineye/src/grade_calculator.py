class GradeCalculator:
    """Класс, рассчитывающий рейтинг компании/группы"""
    
    def __init__(self, dict_with_data: dict, target_company_registration_identifier: str):
        self.dict_with_data = dict_with_data
        self.target_company_registration_identifier = target_company_registration_identifier
        self.target_company_data = self.dict_with_data["data"][self.target_company_registration_identifier]
        self.target_company_last_available_period = list(sorted(list(self.target_company_data)))[-1]
    
    @staticmethod
    def __get_assessment_rating(number: int|float, assessment_dict: dict, multiplier: int):
        for size_range in sorted(assessment_dict.keys()):
            
            if isinstance(number, (int, float)) and number <= size_range:
                return [assessment_dict[size_range]] * multiplier
            
            elif number is None:  # FIXME (???)
                return None
        
        return [assessment_dict[max(sorted(assessment_dict.keys()))]] * multiplier
    
    
    def __calculate_preliminary_grade(self):
        """Метод производящий предварительную оценку каждой компании из групп(включая COMBINED)"""
        
        data = self.dict_with_data["data"]
        
        # todo блок вывода предварительного рейтинга по каждой компании группы и COMBINED
        for registration_identifier in data:
            # тут можно обрабатывать данные по отдельной компании/COMBINED  # TODO
            for period in list(sorted(list(data[registration_identifier])))[1 if len(list(data[registration_identifier])) > 2 else 0:]:
                company_report_for_period = data[registration_identifier][period]
                
                # БЛОК РАНЖИРОВАНИЯ ФИНАНСОВЫХ ПОКАЗАТЕЛЕЙ
                # Хорошо 1-100 Плохо
                if not company_report_for_period.get('!', None):  # Блок создания коллекций для ошибок и предупреждений
                    company_report_for_period["!"] = []
                
                # Блок диапазонов для оценки показателей
                debt_to_equity_assessment = {
                    float("-inf"): 99,  # very negative
                    0: 24,
                    0.000001: 27,  # negative
                    0.25: 29,
                    0.5: 39,  # low level
                    1: 49,  # moderate level
                    2: 59 if not (
                            company_report_for_period["interest_coverage"] and
                            company_report_for_period[
                                "interest_coverage"] > 6) else 47,  # acceptable level
                    2.4: 69 if not (
                            company_report_for_period["interest_coverage"] and
                            company_report_for_period[
                                "interest_coverage"] > 6) else 57,  # acceptable level,
                    3: 79 if not (
                            company_report_for_period["interest_coverage"] and
                            company_report_for_period[
                                "interest_coverage"] > 6) else 67,  # high level
                    4: 89 if not (
                            company_report_for_period["interest_coverage"] and
                            company_report_for_period[
                                "interest_coverage"] > 6) else 77,  # very high level
                    5: 94 if not (
                            company_report_for_period["interest_coverage"] and
                            company_report_for_period[
                                "interest_coverage"] > 6) else 87,  # very very high level
                }
                
                
                equity_ratio_assessment = {  # САМОЕ СИЛЬНОЕ ВЛИЯНИЕ НА ОБЩИЙ ГРЕЙД  (1)
                    float("-inf"): 97,  # negative
                    0: 89,  # low low low level
                    0.02: 84,
                    0.1: 79,
                    0.15: 74,  # low level
                    0.30: 64,  # moderate level
                    0.40: 54,  # acceptable level
                    0.55: 44,  # high level
                    0.65: 34,  # high high level
                    0.75: 24,
                    0.80: 14,  # high high high level
                }
                
                current_ratio_assessment = {  # НАИМЕНЕЕ ВДИЯТЕЛЬНОЕ НА ОБЩИЙ ГРЕЙД  (-2)
                    float("-inf"): 84,
                    0: 74,  # negative
                    0.5: 64,  # very low level
                    1.0: 54,  # low level
                    2: 40,  # medium level
                }  # high level - вынесено
                
                interest_coverage_assessment = {  # (2)
                    float("-inf"): 99,
                    0: 89,  # negative
                    0.5: 79,  # low low level
                    1: 69,  # low level
                    2: 59,  # middle level
                    3: 49,  # moderate level
                    4: 30,  # high level
                    6: 17,  # very high level
                }
                
                interest_coverage_dynamic_assessment = {  # TODO (!!!) Продумать логику для этого частного случая
                    float("-inf"): 60,  # negative
                    0: 50,       # neutral
                    float("inf"): 40,   # positive
                }  # ПРИБАВЛЯЕМ у одному из баллов значение  (учесть если из минуса идет в минус: -0.5 -> -0.3 -> ТУТ НЕ СЧИТАТЬ)
                
                net_profitability_assessment = {
                    float("-inf"): 99,  # negative
                    -0.1: 90,
                    -0.05: 79,
                    -0.01: 69,
                    0: 59,  # low low low level
                    0.005: 59,  # low low level
                    0.025: 59,  # low level
                    0.05: 49,
                    0.1: 44,  # moderate level
                    0.15: 39,  # high level
                    0.3: 29,  # very high level
                    float("inf"): 19
                }
                
                total_assets_dynamic_assessment = {
                    float("-inf"): 99,
                    -0.99: 90,
                    -0.50: 80,
                    -0.30: 70,
                    0: 50,
                }
                
                debt_to_assets_assessment = {  # (-1)
                    float("-inf"): 17,
                    0: 25 if not (
                        company_report_for_period.get("total_assets_dynamic") and company_report_for_period["total_assets_dynamic"] < -0.50
                    ) else 74,  # negative
                    0.1: 29 if not (
                        company_report_for_period.get("total_assets_dynamic") and company_report_for_period["total_assets_dynamic"] < -0.50
                    ) else 74,  # low level
                    0.3: 39 if not (
                        company_report_for_period.get("total_assets_dynamic") and company_report_for_period["total_assets_dynamic"] < -0.50
                    ) else 74,  # moderate level
                    0.4: 49 if not (
                        company_report_for_period.get("total_assets_dynamic") and company_report_for_period["total_assets_dynamic"] < -0.50
                    ) else 74,
                    0.5: 58 if not (
                        company_report_for_period.get("total_assets_dynamic") and company_report_for_period["total_assets_dynamic"] < -0.50
                    ) else 74,  # high level
                    0.6: 69,
                    0.7: 78,  # very high level
                    0.9: 87,
                }
                
                ccc_assessment = {  # negative - хорошо
                    float("-inf"): 17,
                    0: 19,  # negative
                    10: 29,  # very short
                    30: 39,  # short
                    60: 49,  # average
                    90: 59,
                    120: 69,  # long
                    150: 79,  # very long
                }
                
                revenue_assessment = {  # в "$" TODO (!!!) Это корректные диапазоны для России
                    0: 90,  # negative
                    100_000: 84,  # very small
                    1_000_000: 80,  # small
                    10_000_000: 74,  # medium
                    30_000_000: 64,
                    70_000_000: 54,
                    100_000_000: 44,  # large
                    250_000_000: 39,
                    500_000_000: 34,  # very large
                    1_000_000_000: 24,
                    10_000_000_000: 14,  # corporation
                    float("inf"): 10,
                }
                
                revenue_dynamic_assessment = {
                    float("-inf"): 99,
                    -0.50: 96,
                    -0.3: 90,  # drop !!!
                    -0.1: 79,  # drop !
                    -0.02: 69,  # drop
                    0.02: 59,  # stagnation
                    0.1: 49,  # modest
                    0.2: 39,  # medium
                    0.4: 27,  # high
                    0.5: 17,  # very high
                    float("inf"): 10,
                }
                
                debt_to_EBIT_assessment = {
                    0: 24,  # negative
                    0.5: 39,  # very low
                    2: 49,  # low
                    3: 59,  # middle
                    4: 69,  # acceptable
                    6: 79,  # high
                    7: 89,  # very high
                }
                
                age_assessment = {
                    0: 69,  # negative
                    1: 60,  # new established
                    3: 49,  # young
                    8: 39,  # average
                    20: 29,
                    float("inf"): 19,  # mature
                }
                # TODO БЛОК ПРИОРТЕЗАЦИ ОЦЕНОК (ТУТ МОЖНО НАСТРАИВАТЬ РЕЙТИНГ)
                ml = [7, 8, 1, 3, 3, 6, 2, 2, 2, 3, 1, 4, 5]
                
                if company_report_for_period.get("equity_ratio"):
                    if company_report_for_period["equity_ratio"] > 0.6:
                        # Высокая доля СК - снижаем влияние немного
                        ml[1] += 1
                    elif company_report_for_period["equity_ratio"] < 0.03:
                        # Критически низкая доля СК - усиливаем негативное влияние
                        ml[1] += 7
                
                if company_report_for_period.get("total_assets_dynamic") and company_report_for_period["total_assets_dynamic"] <= -0.50:
                    ml[3] += 5
                
                if company_report_for_period.get("net_profitability"):
                    if company_report_for_period["net_profitability"] < 0:
                        # При убытках требуем роста выручки для улучшения ситуации
                        ml[12] += 3
                    elif company_report_for_period["net_profitability"] > 0.15:
                        # При высокой прибыльности снижаем важность динамики выручки
                        ml[12] -= 2
                if company_report_for_period["net_profitability"] and company_report_for_period["net_profitability"] < 0:
                    ml[12] -= 4
                
                if company_report_for_period.get("revenue_dynamic") and company_report_for_period["revenue_dynamic"] <= -0.50:
                    ml[12] += 50
                
                
                assessments_keys = {
                    'net_profitability_assessment': {"assessment": net_profitability_assessment, "multiplier": ml[0]},                   # Net financial result - !
                    'equity_ratio_assessment': {"assessment": equity_ratio_assessment, "multiplier": ml[1]},                             # Equity ratio - !
                    'debt_to_assets_assessment': {"assessment": debt_to_assets_assessment, "multiplier": ml[2]},                         # Debt / Assets
                    'total_assets_dynamic_assessment': {"assessment": total_assets_dynamic_assessment, "multiplier": ml[3]},             # Total assets dynamic
                    'current_ratio_assessment': {"assessment": current_ratio_assessment, "multiplier": ml[4]},                           # Current ratio
                    'interest_coverage_assessment': {"assessment": interest_coverage_assessment, "multiplier": ml[5]},                   # ICR
                    'interest_coverage_dynamic_assessment': {"assessment": interest_coverage_dynamic_assessment, "multiplier": ml[6]},   # ICR dynamic
                    'debt_to_equity_assessment': {"assessment": debt_to_equity_assessment, "multiplier": ml[7]},                         # Financial leverage
                    'ccc_assessment': {"assessment": ccc_assessment, "multiplier": ml[8]},                                               # CCC
                    'revenue_assessment': {"assessment": revenue_assessment, "multiplier": ml[9]},                                       # Revenue
                    'age_assessment': {"assessment": age_assessment, "multiplier": ml[10]},                                              # Company age in years
                    'debt_to_EBIT_assessment': {"assessment": debt_to_EBIT_assessment, "multiplier": ml[11]},                            # Debt / EBIT
                    'revenue_dynamic_assessment': {"assessment": revenue_dynamic_assessment, "multiplier": ml[12]},                      # Revenue dynamic - !
                }
                
                
                
                # Блок расчета предварительной оценки и добавления её в основной словарь
                for idx, ratio_name in enumerate(
                    [
                        "net_profitability", "equity_ratio", "debt_to_assets",
                        "total_assets", "current_ratio", "interest_coverage",
                        "interest_coverage_dynamic", "debt_to_equity", "cash_conversion_cycle",
                        "revenue", "age", "debt_to_EBIT", "revenue_dynamic",
                    ]
                ):
                    if not company_report_for_period.get(list(assessments_keys)[idx].replace("assessment", "rating")):
                        company_report_for_period[list(assessments_keys)[idx].replace("assessment", "rating")] = None
                    
                    company_report_for_period[list(assessments_keys)[idx].replace("assessment", "rating")] = GradeCalculator.__get_assessment_rating(company_report_for_period.get(ratio_name, None), assessments_keys[list(assessments_keys)[idx]]["assessment"], assessments_keys[list(assessments_keys)[idx]]['multiplier'])
                    if ratio_name == "revenue" and company_report_for_period.get(ratio_name, None):
                        company_report_for_period[list(assessments_keys)[idx].replace("assessment", "rating")] = GradeCalculator.__get_assessment_rating((company_report_for_period[ratio_name] / company_report_for_period["exchange_rate_USD"]), assessments_keys[list(assessments_keys)[idx]]["assessment"], assessments_keys[list(assessments_keys)[idx]]['multiplier'])
        
        return self.dict_with_data
    
    def __calculate_grade(self) -> dict:
        """
        Метод финальной оценки каждой отдельной компании группы
        
        :return: dict | данные с предварительной оценкой по показателям
        """
        
        data = self.dict_with_data["data"]
        for registration_identifier in data:
            for period in list(sorted(list(data[registration_identifier])))[1 if len(list(data[registration_identifier])) > 2 else 0:]:
                
                company_report_for_period = data[registration_identifier][period]
                
                for ratio_rating in [
                    "net_profitability_rating", "equity_ratio_rating", "debt_to_assets_rating",
                    "current_ratio_rating", "interest_coverage_rating",
                    "interest_coverage_dynamic_rating", "debt_to_equity_rating", "ccc_rating",
                    "revenue_rating", "age_rating", "debt_to_EBIT_rating",
                    "revenue_dynamic_rating",
                ]:
                    
                    if not company_report_for_period[ratio_rating]:
                        
                        age = company_report_for_period.get("age", None)
                        
                        revenue = company_report_for_period.get("revenue", None)
                        revenue_dynamic = company_report_for_period.get("revenue_dynamic", None)
                        
                        net_financial_result = company_report_for_period.get("net_financial_result", None)
                        equity = company_report_for_period.get("equity", None)
                        
                        total_assets = company_report_for_period.get("total_assets", None)
                        gross_debt = company_report_for_period.get("gross_debt", None)
                        
                        total_short_term_assets = company_report_for_period.get("total_short_term_assets", None)
                        total_short_term_liabilities = company_report_for_period.get("total_short_term_liabilities", None)
                        
                        operating_financial_result = company_report_for_period.get("operating_financial_result", None)
                        interest_expenses = company_report_for_period.get("interest_expenses", None)
                        interest_coverage = company_report_for_period.get("interest_coverage", None)
                        interest_coverage_dynamic = company_report_for_period.get("interest_coverage_dynamic", None)
                        
                        days_inventory_outstanding = company_report_for_period.get("days_inventory_outstanding", None)
                        days_sales_outstanding = company_report_for_period.get("days_sales_outstanding", None)
                        days_payable_outstanding = company_report_for_period.get("days_payable_outstanding", None)
                        
                        EBIT = company_report_for_period.get("EBIT", None)
                        # ------------------------------------------------
                        if not company_report_for_period.get('!', None):  # Блок создания коллекций для ошибок и предупреждений
                            company_report_for_period["!"] = []
                        ERR: list = company_report_for_period["!"]
                        
                        # net_profitability_rating
                        if ratio_rating == "net_profitability_rating" and company_report_for_period["net_profitability_rating"] is None:
                            if revenue is None or revenue < 0:
                                company_report_for_period["net_profitability_rating"] = [100] * 100
                                ERR.append(("net_profitability_rating", "revenue", "Выручка ниже 0 или отсутствует"))
                            
                            if net_financial_result is None:
                                ERR.append(("net_profitability_rating", "net_financial_result", "Отсутствует информация о чистой прибыли/убытке"))
                                company_report_for_period["net_profitability_rating"] = [100] * 100
                        
                        # equity_ratio_rating
                        if ratio_rating == "equity_ratio_rating" and company_report_for_period["equity_ratio_rating"] is None:
                            if equity is None:
                                ERR.append(("equity_ratio_rating", "equity", "Отсутствует информация о капитале"))
                                company_report_for_period["equity_ratio_rating"] = [100] * 100
                            
                            if total_assets is None or total_assets < 0:
                                ERR.append(("equity_ratio_rating", "total_assets", "Информация о балансе отсутствует/меньше 0"))
                                company_report_for_period["equity_ratio_rating"] = [100] * 100
                        
                        # debt_to_assets_rating
                        if ratio_rating == "debt_to_assets_rating" and company_report_for_period["debt_to_assets_rating"] is None:
                            if gross_debt is None:
                                company_report_for_period["debt_to_assets_rating"] = [100] * 100
                                ERR.append(("debt_to_assets_rating", "gross_debt", "Информация о долге отсутствует/меньше 0"))
                            
                            if total_assets is None or total_assets < 0:
                                company_report_for_period["debt_to_assets_rating"] = [100] * 100
                                ERR.append(("debt_to_assets_rating", "total_assets", "Информация об активах отсутствуют или меньше 0"))
                        
                        # current_ratio_rating
                        if ratio_rating == "current_ratio_rating" and company_report_for_period["current_ratio_rating"] is None:
                            if total_short_term_assets is None:
                                company_report_for_period["current_ratio_rating"] = [100] * 100
                                ERR.append(("current_ratio_rating", "total_short_term_assets", "Отсутствует информация о краткосрочных активах"))
                            
                            if total_short_term_liabilities is None:
                                company_report_for_period["current_ratio_rating"] = [100] * 100
                                ERR.append(("current_ratio_rating", "total_short_term_liabilities", "Отсутствует информация о краткосрочных обязательствах"))
                        
                        # interest_coverage_rating
                        if ratio_rating == "interest_coverage_rating" and company_report_for_period["interest_coverage_rating"] is None:
                            if EBIT is None:
                                company_report_for_period["interest_coverage_rating"] = [100] * 100
                                ERR.append(("interest_coverage_rating", "operating_financial_result", "Отсутствует информация о EBIT"))
                            
                            if EBIT is not None and EBIT < 0:
                                company_report_for_period["interest_coverage_rating"] = []
                                ERR.append(("interest_coverage_rating", "operating_financial_result", "Отсутствует информация о EBIT"))
                            
                            if interest_expenses is None:
                                company_report_for_period["interest_coverage_rating"] = [100] * 100
                                ERR.append(("interest_coverage_rating", "interest_expenses", "Отсутствует информация о процентах к уплате"))
                        
                        # interest_coverage_dynamic_rating
                        if ratio_rating == "interest_coverage_dynamic_rating" and company_report_for_period["interest_coverage_dynamic_rating"] is None:
                            if interest_coverage_dynamic is None:
                                company_report_for_period["interest_coverage_dynamic_rating"] = [100] * 100
                                ERR.append(("interest_coverage_dynamic_rating", "interest_coverage_dynamic", "Отсутствует информация о динамике процентного покрытия"))
                        
                        # debt_to_equity_rating
                        if ratio_rating == "debt_to_assets_rating" and company_report_for_period["debt_to_equity_rating"] is None:
                            if gross_debt is None:
                                company_report_for_period["debt_to_equity_rating"] = [100] * 100
                                ERR.append(("debt_to_equity_rating", "gross_debt", "Отсутствует информация о долге"))
                            
                            if equity is None:
                                company_report_for_period["debt_to_equity_rating"] = [100] * 100
                                ERR.append(("debt_to_equity_rating", "equity", "Отсутствует информация об активах"))
                        
                        # ccc_rating
                        if ratio_rating == "ccc_rating" and company_report_for_period["ccc_rating"] is None:
                            if company_report_for_period["age"] > 1.4:
                                if days_inventory_outstanding is None:
                                    company_report_for_period["ccc_rating"] = [100] * 100
                                    ERR.append(("ccc_rating", "days_inventory_outstanding", "Отсутствует информация об оборачиваемости запасов"))
                                if days_sales_outstanding is None:
                                    company_report_for_period["ccc_rating"] = [100] * 100
                                    ERR.append(("ccc_rating", "days_inventory_outstanding", "Отсутствует информация об оборачиваемости дебиторской задолженности"))
                                if days_payable_outstanding is None:
                                    company_report_for_period["ccc_rating"] = [100] * 100
                                    ERR.append(("ccc_rating", "days_inventory_outstanding", "Отсутствует информация об оборачиваемости кредиторской задолженности"))
                            else:
                                company_report_for_period["ccc_rating"] = [100] * 1
                        
                        # revenue_rating
                        if ratio_rating == "revenue_rating" and company_report_for_period["revenue_rating"] is None:
                            if revenue is None:
                                company_report_for_period["revenue_rating"] = [100] * 100
                                ERR.append(("revenue_rating", "revenue", "Отсутствие информации о выручке"))
                            if revenue is not None and revenue < 0:
                                company_report_for_period["revenue_rating"] = [100] * 100
                                ERR.append(("revenue_rating", "revenue", "Отрицательная выручке"))
                        
                        # age_rating
                        if ratio_rating == "age_rating" and company_report_for_period["age_rating"] is None:
                            if age is None:
                                company_report_for_period["age_rating"] = [100] * 100
                                ERR.append(("age_rating", "age", "Отсутствует информация о возрасте компании"))
                            
                            if age < 0:
                                company_report_for_period["age_rating"] = [100] * 100
                                ERR.append(("age_rating", "age", "Отрицательный возраст компании"))
                        
                        # debt_to_EBIT_rating
                        if ratio_rating == "debt_to_EBIT_rating" and company_report_for_period["debt_to_EBIT_rating"] is None:
                            if gross_debt is None:
                                company_report_for_period["debt_to_assets_rating"] = [99] * 7
                                ERR.append(("debt_to_EBIT_rating", "gross_debt", "Отсутствует информация о долге"))
                            
                            if EBIT is None:
                                if operating_financial_result is None:
                                    company_report_for_period["interest_coverage_rating"] = [100] * 8
                                    ERR.append(("operating_financial_result", "Отсутствует информация о финансовом результате"))
                        
                        # revenue_dynamic_rating
                        if ratio_rating == "revenue_dynamic_rating" and company_report_for_period["revenue_dynamic_rating"] is None:
                            if revenue_dynamic is None:
                                company_report_for_period["revenue_dynamic_rating"] = [100] * 100
                                ERR.append(("revenue_dynamic_rating", "revenue_dynamic", "Отсутствует динамика выручки"))
                        
                        # interest_rate
                        interest_rate = company_report_for_period["interest_expenses"] / company_report_for_period["gross_debt"] - 1 if company_report_for_period.get("interest_expenses",None) and company_report_for_period.get("gross_debt", None) else None
                        if interest_rate and interest_rate < 0.01 and (company_report_for_period["debt_to_assets_rating"][0] > 55 and company_report_for_period["debt_to_equity_rating"][0] > 55):
                            company_report_for_period["debt_to_assets_rating"] = company_report_for_period["debt_to_assets_rating"][:2]
                            company_report_for_period["debt_to_equity_rating"] = company_report_for_period["debt_to_equity_rating"][:2]
        
        return self.dict_with_data
    
    def __grade_recalculation(self) -> dict:
        """
        Метод перерасчета рейтинга компании/компаний группы
        
        :return: dict | данные с перерасчетом рейтинга по каждой компании группы или одиночной компании
        """
        
        data = self.dict_with_data["data"]
        
        for registration_identifier in data:
            for report_period in list(data[registration_identifier])[1 if len(list(data[registration_identifier])) > 2 else 0:]:
                if report_period != "currency":
                    period = report_period
                    
                    company_report_for_period = data[registration_identifier][period]
                    if not company_report_for_period.get('!', None):  # Блок создания коллекций для ошибок и предупреждений
                            company_report_for_period["!"] = []
                    ERR: list = company_report_for_period["!"]
                    
                    ERR = list(set(ERR))
                    
                    company_report_for_period["summary_rating"] = []
                    
                    # TODO КОММЕНТЫ НИЖЕ ДЛЯ РАЗВИТИЯ ОЦЕНКИ КОМПАНИИ (ГРЕЙД)
                    # block_size_maturity = []
                    # block_growth_dynamic = []
                    # block_liquidity_debt_service = []
                    # block_financial_stability = []
                    # block_profitability_efficiency = []
                    
                    for ratio_rating in [
                        "net_profitability_rating", "equity_ratio_rating", "debt_to_assets_rating",
                        "current_ratio_rating", "interest_coverage_rating",
                        "interest_coverage_dynamic_rating", "debt_to_equity_rating", "ccc_rating",
                        "revenue_rating", "age_rating", "debt_to_EBIT_rating",
                        "revenue_dynamic_rating",
                    ]:
                        # TODO
                        if company_report_for_period.get(ratio_rating) is not None:
                            
                            # if ratio_rating in [
                            #     "revenue_rating",
                            #     "age_rating",
                            # ]:
                            #     block_size_maturity.extend(company_report_for_period[ratio_rating])
                            
                            # if ratio_rating in [
                            #     "total_assets_dynamic_rating",
                            #     "revenue_dynamic_rating",
                            # ]:
                            #     block_growth_dynamic.extend(company_report_for_period[ratio_rating])
                            
                            # elif ratio_rating in [
                            #     "current_ratio_rating",
                            #     "interest_coverage_rating",
                            #     "debt_to_EBIT_rating",
                            #     "interest_coverage_dynamic_rating",
                            # ]: 
                            #     block_liquidity_debt_service.extend(company_report_for_period[ratio_rating])
                            
                            # elif ratio_rating in[
                            #     "debt_to_equity_rating",
                            #     "debt_to_assets_rating",
                            #     "equity_ratio_rating",
                            # ]:
                            #     block_financial_stability.extend(company_report_for_period[ratio_rating])
                            
                            # elif ratio_rating in[
                            #     "ccc_rating",
                            #     "net_profitability_rating",
                            # ]:
                            #     block_profitability_efficiency.extend(company_report_for_period[ratio_rating])
                    
                    # block_size_maturity = block_size_maturity * 2  # 10%
                    # block_growth_dynamic = block_growth_dynamic * 4  # 20%
                    # block_liquidity_debt_service = block_liquidity_debt_service * 4  # 20%
                    # block_financial_stability = block_financial_stability * 5  # 25%
                    # block_profitability_efficiency = block_profitability_efficiency * 5  # 25%
                    # print(block_size_maturity)
                    # summary_collection = (
                    #     block_size_maturity +
                    #     block_growth_dynamic +
                    #     block_liquidity_debt_service +
                    #     block_financial_stability +
                    #     block_profitability_efficiency
                    # )
                    # print(summary_collection)
                    # company_report_for_period["summary_rating"] = sum(summary_collection) / len(summary_collection) if company_report_for_period["summary_rating"] else 85
                            company_report_for_period["summary_rating"] += company_report_for_period[ratio_rating]
                    
                    company_report_for_period["summary_rating"] = sum(list(filter(lambda x: x is not None, company_report_for_period["summary_rating"]))) / len(company_report_for_period["summary_rating"]) if company_report_for_period["summary_rating"] else 85
                    # FIXME БЛОК "ПОТОЛОК РЕЙТИНГА"
                    if company_report_for_period["equity_ratio"] is not None and company_report_for_period["equity_ratio"] <= 0 and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10  # FIXME Возможно множитель надо будет подрегулировать.
                    if company_report_for_period["equity_ratio"] is not None and company_report_for_period["equity_ratio"] <= 0 and company_report_for_period["net_financial_result"] is not None and company_report_for_period["net_financial_result"] <= 0 and company_report_for_period["summary_rating"] <= 84:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([84] * 9)) / 10  # FIXME Возможно множитель надо будет подрегулировать.
        
        for registration_identifier in data:
            # тут можно обрабатывать данные по отдельной компании/COMBINED
            for report_period in list(data[registration_identifier])[1 if len(list(data[registration_identifier])) > 2 else 0:]:
                period = report_period
                
                company_report_for_period = data[registration_identifier][period]
                if company_report_for_period["age"] and company_report_for_period["age"] <= 1.4:  # FIXME (???) интересует именно апрель месяц(возможно придется понизить до ~1.3-1.4)
                    company_report_for_period["summary_rating"] = [company_report_for_period["summary_rating"]] + [74] * 100
                    company_report_for_period["!"].append("New company")
                    continue
                
                if company_report_for_period.get("equity_ratio_rating") and company_report_for_period["equity_ratio_rating"]:
                    if company_report_for_period["equity_ratio_rating"][0] > 65 and company_report_for_period["summary_rating"] < 65:
                        company_report_for_period["equity_ratio_rating"] = company_report_for_period["equity_ratio_rating"] * 6
                    elif company_report_for_period["equity_ratio_rating"][0] > 55 and company_report_for_period["summary_rating"] < 55:
                        company_report_for_period["equity_ratio_rating"] = company_report_for_period["equity_ratio_rating"] * 4
        
        
        
        court_cases_data = self.target_company_data[self.target_company_last_available_period].get("court_cases_data")
        # print(f"{court_cases_data=}")
        revenue = company_report_for_period["revenue"]
        
        for registration_identifier in data:
            # print(f"{registration_identifier=}")
            for report_period in list(data[registration_identifier])[1 if len(list(data[registration_identifier])) > 2 else 0:]:
                period = report_period
                # print(f"{period=}")
                company_report_for_period = data[registration_identifier][period]
                # КА = 1
                if registration_identifier != "COMBINED":  # TODO НУЖНО ПРЕДУСМОТРЕТЬ ВЛИЯНИЕ И ДЛЯ ГРУППЫ ЦЕЛИКОМ
                    # court_cases: dict = data[registration_identifier][period].get("court_cases", {})
                    # revenue_usd = company_report_for_period["revenue"] / company_report_for_period["exchange_rate_USD"]
                    
                    court_cases_filter = [court_case_report for court_case_report in court_cases_data if court_case_report["registration_identifier"] == registration_identifier]
                    court_cases_object = court_cases_filter[0] if court_cases_filter else {}
                #     if court_cases_object:
                #         СО = court_cases_object["data"]["current_period"]["amount"]["defendant"] / revenue
                #         КДО = court_cases_object["data"]["current_period"]["count"]["defendant"] / 100
                #         МО = 1.5
                #         КО = (СО * 0.8 + КДО * 0.2) * МО
                        
                #         КИ = 0
                #         # Применяется если сумма исков > 25% от годовой выручки за последние 2 года
                #         if sum([
                #             court_cases_object["data"]["current_period"]["amount"]["plaintiff"],
                #             court_cases_object["data"]["previous_period"]["amount"]["plaintiff"]
                #         ]) > (revenue / 100 * 25):
                #             СИ = sum([
                #                 court_cases_object["data"]["current_period"]["amount"]["plaintiff"],
                #                 court_cases_object["data"]["previous_period"]["amount"]["plaintiff"],
                #                 court_cases_object["data"]["before_previous_period"]["amount"]["plaintiff"],
                #             ])
                #             КДИ = court_cases_object["data"]["current_period"]["count"]["plaintiff"] / 100,
                #             МИ = 0.3
                #             КИ = (СИ * 0.8 + КДИ * 0.2) * МИ
                        
                #         ТРО = (court_cases_object["data"]["current_period"]["count"]["defendant"] / court_cases_object["data"]["previous_period"]["count"]["defendant"] if court_cases_object["data"]["previous_period"]["count"]["defendant"] else 1 ) - 1
                #         ТРИ = (court_cases_object["data"]["current_period"]["count"]["plaintiff"] / court_cases_object["data"]["previous_period"]["count"]["plaintiff"] if court_cases_object["data"]["previous_period"]["count"]["plaintiff"] else 1) - 1
                #         МД = 0.5
                #         КД = (ТРО * 0.8 + ТРИ * 0.2) * МД
                        
                #         КСО = sum([case for case in court_cases["Defendant"].values() if case / company_report_for_period["exchange_rate_USD"] > 100_000 ]) if court_cases.get("Defendant") else 0   # в долларах $
                #         МКС = 2
                #         КК = (КСО / revenue) * 100 * МКС
                        
                #         КБ = 0
                #         # Применяется при полном отсутствии арбитражных дел за 3 года
                #         if sum([
                #             court_cases_object["data"]["current_period"]["count"]["plaintiff"],
                #             court_cases_object["data"]["previous_period"]["count"]["plaintiff"],
                #             court_cases_object["data"]["before_previous_period"]["count"]["plaintiff"],
                #             court_cases_object["data"]["current_period"]["count"]["defendant"],
                #             court_cases_object["data"]["previous_period"]["count"]["defendant"],
                #             court_cases_object["data"]["before_previous_period"]["count"]["defendant"],
                #         ]) == 0:
                #             КБ = -0.05
                        
                #         print(f"{КО=}")
                #         print(f"{КИ=}")
                #         print(f"{КД=}")
                #         print(f"{КК=}")
                #         print(f"{КБ=}")
                        
                #         КА = 1 + (КО + КИ + КД + КК + КБ)
                        # print(f"{КА=}")
                
                
                ERR: list = company_report_for_period["!"]
                
                ERR = list(set(ERR))
                
                
                company_report_for_period["summary_rating"] = []
                for ratio_rating in [
                    "net_profitability_rating", "equity_ratio_rating", "debt_to_assets_rating",
                    "current_ratio_rating", "interest_coverage_rating",
                    "interest_coverage_dynamic_rating", "debt_to_equity_rating", "ccc_rating",
                    "revenue_rating", "age_rating", "debt_to_EBIT_rating",
                    "revenue_dynamic_rating",
                ]:
                    
                    if company_report_for_period.get(ratio_rating) and not company_report_for_period[ratio_rating] is None:  # noqa: E714
                        company_report_for_period["summary_rating"] += company_report_for_period[ratio_rating]
                
                company_report_for_period["summary_rating"] = sum(list(filter(lambda x: x is not None, company_report_for_period["summary_rating"]))) / len(company_report_for_period["summary_rating"]) if company_report_for_period["summary_rating"] else 85
                # FIXME БЛОК "ПОТОЛОК РЕЙТИНГА"
                if company_report_for_period["equity_ratio"] is not None and company_report_for_period["equity_ratio"] <= 0 and company_report_for_period["summary_rating"] <= 74:
                    company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                if company_report_for_period["equity_ratio"] is not None and company_report_for_period["equity_ratio"] <= 0 and company_report_for_period["net_financial_result"] is not None and company_report_for_period["net_financial_result"] <= 0 and company_report_for_period["summary_rating"] <= 84:
                    company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([84] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                
                # current_period
                if court_cases_object and period == self.target_company_last_available_period and registration_identifier != "COMBINED":  # TODO НУЖНО ПРЕДУСМОТРЕТЬ ВЛИЯНИЕ И ДЛЯ ГРУППЫ ЦЕЛИКОМ
                    if (court_cases_object["data"]["current_period"]["amount"]["defendant"] and revenue and company_report_for_period["summary_rating"]) and court_cases_object["data"]["current_period"]["amount"]["defendant"] > (revenue / 2) and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                    if court_cases_object["data"]["current_period"]["count"]["defendant"] > 50 and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                
                # previous_period
                if court_cases_object and period == str(int(self.target_company_last_available_period) - 1) and registration_identifier != "COMBINED":  # TODO НУЖНО ПРЕДУСМОТРЕТЬ ВЛИЯНИЕ И ДЛЯ ГРУППЫ ЦЕЛИКОМ
                    if (court_cases_object["data"]["previous_period"]["amount"]["defendant"] and revenue and company_report_for_period["summary_rating"]) and court_cases_object["data"]["previous_period"]["amount"]["defendant"] > (revenue / 2) and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                    if (court_cases_object["data"]["previous_period"]["count"]["defendant"] and company_report_for_period["summary_rating"]) and court_cases_object["data"]["previous_period"]["count"]["defendant"] > 50 and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                
                # before_previous_period
                if court_cases_object and period == str(int(self.target_company_last_available_period) - 2) and registration_identifier != "COMBINED":  # TODO НУЖНО ПРЕДУСМОТРЕТЬ ВЛИЯНИЕ И ДЛЯ ГРУППЫ ЦЕЛИКОМ
                    if (court_cases_object["data"]["before_previous_period"]["amount"]["defendant"] and revenue and company_report_for_period["summary_rating"]) and court_cases_object["data"]["before_previous_period"]["amount"]["defendant"] > (revenue / 2) and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
                    if (court_cases_object["data"]["before_previous_period"]["count"]["defendant"] and company_report_for_period["summary_rating"]) and court_cases_object["data"]["before_previous_period"]["count"]["defendant"] > 50 and company_report_for_period["summary_rating"] <= 74:
                        company_report_for_period["summary_rating"] = sum([company_report_for_period["summary_rating"]] + ([74] * 9)) / 10 # * КА  # FIXME Возможно множитель надо будет подрегулировать.
        
        return self.dict_with_data
    
    def get_data_with_grade(self):
        self.__calculate_preliminary_grade()
        self.__grade_recalculation()
        
        return self.dict_with_data
