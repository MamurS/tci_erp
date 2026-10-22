from typing import Any, Optional

from .translate import RATIOS_LANGUAGE_MAPPING


class VisualizationDataAggregator:
    def __init__(self, dict_with_data: dict, target_company_registration_identifier: str, count_not_active: Optional[int], language: str):
        self.dict_with_data = dict_with_data
        self.target_company_registration_identifier = target_company_registration_identifier
        self.count_not_active = count_not_active
        self.language = language
    
    @staticmethod
    def __sort_by_last_available_period_and_specific_article(data: dict, article: str) -> list[
        tuple[int | None, int | None]]:
        """
        Метод, возвращающий отсортированный массив кортежей (<индекс в группе>, <значение>) по значению какого-либо
        показателя с индексацией по последнему доступному периоду

        :param data: dict | данные о группе
        :param article: str | ключ показателя
        :return: list[tuple[int|None, int|None]] | пара значений [0] - индекс в коллекции, [1] - значение
        """
        last_available_period = list(sorted(list(data["COMBINED"])))[-1]
        mixed_data = []

        for idx, company in enumerate(list(data)):
            if company != "COMBINED":
                company_data = data[company].get(last_available_period)
                if company_data:
                    filter_value = company_data.get(article, None)
                    mixed_data.append((idx, filter_value,))

        sorted_data = list(sorted(mixed_data, key=lambda x: x[-1] if x[-1] else 0, reverse=True))  # От большего к меньшему
        return sorted_data

    @staticmethod
    def __aggregate_article_data_for_table(data: dict, article: str, sorted_tuples: list[tuple]) -> list[list]:
        """
        Метод агрегирующий данные строк баланса в матрицу для таблиц

        :param data: dict | данные о группе
        :param article: str | название ключа определенного показателя
        :param sorted_tuples: list[tuple] | отсортированный массив данных, для формирования матрицы под таблицу
        :return: list[list] | матрица, позволяющая создать таблицу (порядок от большего к меньшему)
        """

        combined = data["COMBINED"]
        last_available_period = list(sorted(list(combined)))[-1]
        combined_article_value = combined[last_available_period].get(article, None)

        result_matrix = []

        for cmpn_tuple in sorted_tuples:
            company_data = data[list(data)[cmpn_tuple[0]]].get(last_available_period, None)
            if company_data:
                name = company_data.get("company_short_name", company_data.get("company_full_name", None))
                registration_identifier = company_data.get("registration_identifier", None)
                status = company_data.get("status", None)
                company_article_value = company_data.get(article, None)
                article_share_percent = company_article_value / combined_article_value * 100 \
                    if company_article_value is not None and combined_article_value \
                    else None
                result_matrix.append([name, registration_identifier, status,
                                      f"{company_article_value:,}", round(article_share_percent)
                                      if article_share_percent is not None and
                                         article_share_percent not in (float("nan"), float("inf"), float("-inf")) and
                                         article_share_percent >= 150
                                      else round(article_share_percent, 2)
                                        if article_share_percent else "-"])
        
        return result_matrix[:5 if len(result_matrix) >= 5 else len(result_matrix)]

    def __aggregate_balance_and_profit_loss_data(self, data: dict, b_or_p_l) -> list[list]:
        """
        Метод агрегирующий данные баланса группы в матрицу для таблицы

        :param data: dict | данные отчётности компании/комбинированная отчётность
        :return: list[list] | матрица со строками баланса группы
        """
        periods = list(sorted(data.keys(), reverse=True))
        
        if b_or_p_l == "balance":
            articles_for_table = {
                "total_long_term_assets": RATIOS_LANGUAGE_MAPPING[self.language]["total_long_term_assets"],
                "inventories": RATIOS_LANGUAGE_MAPPING[self.language]["inventories"],
                "accounts_receivable": RATIOS_LANGUAGE_MAPPING[self.language]["accounts_receivable"],
                "cash": RATIOS_LANGUAGE_MAPPING[self.language]["cash"],
                "short_term_investments": RATIOS_LANGUAGE_MAPPING[self.language]["short_term_investments"],
                "total_short_term_assets": RATIOS_LANGUAGE_MAPPING[self.language]["total_short_term_assets"],
                "retained_earnings": RATIOS_LANGUAGE_MAPPING[self.language]["retained_earnings"],
                "equity": RATIOS_LANGUAGE_MAPPING[self.language]["equity"],
                "long_term_debt": RATIOS_LANGUAGE_MAPPING[self.language]["long_term_debt"],
                "short_term_debt": RATIOS_LANGUAGE_MAPPING[self.language]["short_term_debt"],
                "accounts_payable": RATIOS_LANGUAGE_MAPPING[self.language]["accounts_payable"],
                "total_short_term_liabilities": RATIOS_LANGUAGE_MAPPING[self.language]["total_short_term_liabilities"],
                "total_assets": RATIOS_LANGUAGE_MAPPING[self.language]["total_assets"],
            }
            for period in periods[:3 if len(data) >= 3 else len(data)]:
                total_assets = data[period].get("total_assets", None)
                for article in articles_for_table:
                    article_value = data[period].get(article, None)
                    articles_for_table[article].append(
                        round(article_value / total_assets * 100, 2) if article_value is not None and total_assets else "-"
                    )
                    articles_for_table[article].append(f"{round(article_value, 0):,}" if article_value is not None else "-")
        else:
            articles_for_table = {
                "revenue": RATIOS_LANGUAGE_MAPPING[self.language]["revenue"],
                "cost_of_goods_sold": RATIOS_LANGUAGE_MAPPING[self.language]["cost_of_goods_sold"],
                "gross_financial_result": RATIOS_LANGUAGE_MAPPING[self.language]["gross_financial_result"],
                "commercial_expanses": RATIOS_LANGUAGE_MAPPING[self.language]["commercial_expanses"],
                "administrative_expanses": RATIOS_LANGUAGE_MAPPING[self.language]["administrative_expanses"],
                "operating_financial_result": RATIOS_LANGUAGE_MAPPING[self.language]["operating_financial_result"],
                "interest_income": RATIOS_LANGUAGE_MAPPING[self.language]["interest_income"],
                "interest_expenses": RATIOS_LANGUAGE_MAPPING[self.language]["interest_expenses"],
                "other_operating_income": RATIOS_LANGUAGE_MAPPING[self.language]["other_operating_income"],
                "other_operating_expanses": RATIOS_LANGUAGE_MAPPING[self.language]["other_operating_expanses"],
                "financial_result_before_tax": RATIOS_LANGUAGE_MAPPING[self.language]["financial_result_before_tax"],
                "income_tax": RATIOS_LANGUAGE_MAPPING[self.language]["income_tax"],
                "net_financial_result": RATIOS_LANGUAGE_MAPPING[self.language]["net_financial_result"],
            }
            for period in periods[:3 if len(data) >= 3 else len(data)]:
                total_assets = data[period].get("revenue", None)
                for article in articles_for_table:
                    article_value = data[period].get(article, None)

                    articles_for_table[article].append(
                        round(article_value / total_assets * 100, 2) if article_value is not None and total_assets else "-"
                    )
                    articles_for_table[article].append(f"{round(article_value, 0):,}" if article_value is not None else "-")

        result_matrix = [[v[0]] + list(reversed(v[1:])) for k, v in articles_for_table.items()]
        
        if len(periods) == 2:
            for row in result_matrix:
                row.insert(1, "")
                row.insert(1, "")

        elif len(periods) == 1:
            for row in result_matrix:
                row.insert(1, "")
                row.insert(1, "")
                row.insert(1, "")
                row.insert(1, "")
            
        return result_matrix

    def __aggregate_financial_ratios_data_for_tables(self, target_company_or_combined: dict, ) -> tuple:
        """
        Метод агрегирующий данные о финансовых показателях в матрицу для формирования таблицы

        :param target_company_or_combined: dict | данные компании или комбинированные данные группы
        :return: tuple | матрица для таблицы динамики финансового показателя
        """

        periods = list(sorted(target_company_or_combined.keys(), reverse=True))[
                  :3 if len(target_company_or_combined) >= 3 else len(target_company_or_combined)]
        # Profitability ratios
        profitability_ratios_for_table = {
            # "EBIT": ["EBIT"],
            "gross_margin": RATIOS_LANGUAGE_MAPPING[self.language]["gross_margin"],
            "EBIT_margin": RATIOS_LANGUAGE_MAPPING[self.language]["EBIT_margin"],
            "net_profitability": RATIOS_LANGUAGE_MAPPING[self.language]["net_profitability"],
        }
        for period in periods:
            for ratio in list(profitability_ratios_for_table):
                ratio_value = target_company_or_combined[period].get(ratio, None)
                ratio_dynamic = target_company_or_combined[period].get(ratio + "_dynamic", None)
                profitability_ratios_for_table[ratio].append(round(ratio_dynamic, 2) if ratio_dynamic is not None else "-")
                profitability_ratios_for_table[ratio].append(f"{round(ratio_value, 2) * 100:,}" if ratio_value is not None else "-")

        # Liquidity ratios
        liquidity_ratios_for_table = {
            "cashflow_from_operations": ["CFO"],
            "free_cashflow": ["FCF"],
            "net_working_capital": ["NWC"],
        }
        for period in periods:
            for ratio in list(liquidity_ratios_for_table):
                ratio_value = target_company_or_combined[period].get(ratio, None)
                ratio_dynamic = target_company_or_combined[period].get(ratio + "_dynamic", None)
                liquidity_ratios_for_table[ratio].append(round(ratio_dynamic, 2) if ratio_dynamic is not None else "-")
                liquidity_ratios_for_table[ratio].append(f"{round(ratio_value, 0):,}" if ratio_value is not None else "-")

        # Turnover ratios
        turnover_ratios_for_table = {
            "days_inventory_outstanding": ["DIO"],
            "days_payable_outstanding": ["DPO"],
            "days_sales_outstanding": ["DSO"],
            "cash_conversion_cycle": ["CCC"],
        }
        for period in periods:
            for ratio in list(turnover_ratios_for_table):
                ratio_value = target_company_or_combined[period].get(ratio, None)
                ratio_dynamic = target_company_or_combined[period].get(ratio + "_dynamic", None)
                turnover_ratios_for_table[ratio].append(round(ratio_dynamic, 2) if ratio_dynamic is not None else "-")
                turnover_ratios_for_table[ratio].append(f"{int(ratio_value):,}" if ratio_value is not None else "-")

        result_matrix = (
            [[v[0]] + list(reversed(v[1:])) for k, v in profitability_ratios_for_table.items()],
            [[v[0]] + list(reversed(v[1:])) for k, v in liquidity_ratios_for_table.items()],
            [[v[0]] + list(reversed(v[1:])) for k, v in turnover_ratios_for_table.items()],
        )

        return result_matrix

    @staticmethod
    def __aggregate_group_structure(data: dict) -> list[list]:  # TODO (???) Продумать маппинг статусов Активный и прочие (!!!) сделать сортироваку по Активным компаниям и остальным и после по выручке
        """
        Метод агрегирующий данные о структуре группы в матрицу для таблицы

        :param data: dict | данные о группе целиком/компании
        :return: list[list] | матрица с групповой структурой
        """

        combined = data["COMBINED"]
        last_available_period = list(sorted(list(combined)))[-1]

        combined_revenue = combined[last_available_period].get("revenue", None)
        combined_net_profitability = combined[last_available_period].get("net_profitability", None)
        combined_total_assets = combined[last_available_period].get("total_assets", None)
        combined_equity = combined[last_available_period].get("equity", None)
        combined_gross_debt = combined[last_available_period].get("gross_debt", None)

        mixed_data = []

        for idx, company in enumerate(list(data)):
            if company != "COMBINED":
                company_data = data[company].get(last_available_period)
                if company_data:
                    filter_value = company_data.get("revenue", None)
                    mixed_data.append((idx, filter_value,))

        shorted_sorted_data = list(sorted(mixed_data, key=lambda x: x[-1] if x[-1] else 0, reverse=True))[:40]  # От большего к меньшему

        result_matrix = []

        for cmpn_tuple in shorted_sorted_data:
            company_data = data[list(data)[cmpn_tuple[0]]].get(last_available_period, None)
            if company_data:
                name = company_data.get("company_short_name", company_data.get("company_full_name", None))
                registration_identifier = company_data.get("registration_identifier", None)
                status = company_data.get("status", None)
                line_of_business = company_data.get("activity_sector", "-")
                revenue_share = company_data["revenue"] / combined_revenue * 100 \
                    if company_data["revenue"] is not None and combined_revenue \
                    else "-"
                net_financial_result = f"{int(company_data['net_financial_result']):,}" \
                    if company_data.get("net_financial_result", None) is not None else "-"
                total_assets_share = company_data["total_assets"] / combined_total_assets * 100 \
                    if company_data["total_assets"] is not None and combined_total_assets \
                    else "-"
                equity_share = company_data["equity"] / combined_equity * 100 \
                    if company_data["equity"] is not None and combined_equity \
                    else "-"

                gross_debt_share = company_data["gross_debt"] / combined_gross_debt * 100 \
                    if company_data["gross_debt"] is not None and combined_gross_debt \
                    else "-"

                result_matrix.append(
                    [
                        name, registration_identifier, status,
                        line_of_business, revenue_share, net_financial_result,
                        total_assets_share, equity_share, gross_debt_share, 
                    ]
                )

        return result_matrix

    @staticmethod
    def __get_paragraphs(target_company_data: dict) -> tuple[str | Any, str | Any, str | Any]:
        """
        Метод подготавливающий параграф к вставке в файл отчёта

        :param target_company_data: dict | данные целевой компании
        :return: tuple[str|Any] | параграфы отчёта к вставке
        """
        
        last_period_target_company_data = list(sorted(list(target_company_data)))[-1]
        # print(last_period_target_company_data)
        conclusion_paragraph = target_company_data[last_period_target_company_data].get(
            "improved_conclusion_comments_paragraph", "\n\n".join(
                target_company_data[last_period_target_company_data]["conclusion_paragraph"][0]
            )
        )
        balance_comments_paragraph = target_company_data[last_period_target_company_data].get(
            "improved_balance_comments_paragraph", "\n\n".join(
                target_company_data[last_period_target_company_data]["balance_comments_paragraph"][0]
            )
        )
        income_comments_paragraph = target_company_data[last_period_target_company_data].get(
            "improved_income_comments_paragraph", "\n\n".join(
                target_company_data[last_period_target_company_data]["income_comments_paragraph"][0]
            )
        )
        ratio_comments_paragraph = target_company_data[last_period_target_company_data].get(
            "improved_ratio_comments_paragraph", "\n\n".join(
                target_company_data[last_period_target_company_data]["ratio_comments_paragraph"][0]
            )
        )
        
        return conclusion_paragraph, balance_comments_paragraph, income_comments_paragraph, ratio_comments_paragraph,
    
    @staticmethod
    def __aggregate_data_for_graphs(data: dict, registration_identifier: str) -> dict:  # TODO (???)
        data = data["data"][registration_identifier]
        periods = list(sorted(list(data)))
        
        data_for_graphs: dict = {}
        
        for period in periods:
            data_for_graphs[period] = {}
            data_for_graphs[period]["net_financial_result"] = data[period]["net_financial_result"]
            data_for_graphs[period]["EBIT"] = data[period]["EBIT"]
            data_for_graphs[period]["revenue"] = data[period]["revenue"]
            data_for_graphs[period]["DSO"] = data[period]["days_sales_outstanding"]
            data_for_graphs[period]["DPO"] = data[period]["days_payable_outstanding"]
            data_for_graphs[period]["DIO"] = data[period]["days_inventory_outstanding"]
        
        return data_for_graphs
    
    @staticmethod
    def __aggregate_report_period_types(data: dict, registration_identifier: str) -> list:
        period_types: list = []
        data = data[registration_identifier]
        for period in list(sorted(list(data))):
            period_types.append(data[period]["financial_statement_period_type"])
        
        return period_types
    
    def get_data_for_visual(self):
        """
        Метод агрегирующий данные для визуальной части отчёта
        
        :return: dict | данные с агрегированными частями информации для визуальной части отчёта
        """
        data = self.dict_with_data["data"]
        combined_data = data.get("COMBINED", None)
        
        
        period_types: list = VisualizationDataAggregator.__aggregate_report_period_types(data=data, registration_identifier=self.target_company_registration_identifier)
        
        data_for_the_report = self.dict_with_data["aggregated_data_for_the_report"] = {}
        
        target_company_data = data[self.target_company_registration_identifier]
        target_company_last_available_period = list(sorted(list(target_company_data)))[-1]
        COMBINED_last_available_period = list(sorted(list(combined_data)))[-1] if combined_data else None
        
        is_group = True if combined_data else False
        currency = target_company_data[target_company_last_available_period].get("currency", None) \
            if target_company_data else ''
        
        company_name = target_company_data[target_company_last_available_period].get("company_short_name", target_company_data.get("company_full_name", None))
        tax_identifier = target_company_data[target_company_last_available_period].get("tax_identifier", None)
        registration_identifier = target_company_data[target_company_last_available_period].get("registration_identifier", None)
        founding_date = target_company_data[target_company_last_available_period].get("founding_date", None)
        address = target_company_data[target_company_last_available_period].get("address")
        status = target_company_data[target_company_last_available_period].get("status", None)
        owners = target_company_data[target_company_last_available_period].get("owners", None)
        
        
        line_of_business = target_company_data[target_company_last_available_period].get("activity_sector", None)
        number_active_companies = len(list(filter(
            lambda x: x is not None,
            [
                v[list(v)[-1]]["status"] 
                if k != "COMBINED"
                    and v
                    and v[list(v)[-1]].get("status", None)
                    and v[list(v)[-1]]["status"] == "Действующее"  # TODO (!!!) для различных источников придется корректировать статусы
                else None for k, v in data.items()
            ])))
        number_companies_in_group = len(self.dict_with_data["data"]) - 1 if self.dict_with_data["data"].get("COMBINED", None) else 1
        credit_limit = target_company_data[target_company_last_available_period].get("limit", None) if target_company_data.get(target_company_last_available_period) else None
        group_credit_limit = combined_data[target_company_last_available_period].get("limit", None) if combined_data and combined_data.get(target_company_last_available_period) else None
        
        # Данные для "спидометра" грейда
        last_grade = target_company_data[target_company_last_available_period].get("summary_rating", None)
        previous_grade = target_company_data[list(sorted(list(target_company_data)))[-2]].get("summary_rating", None) if len(
            target_company_data) > 1 else None
        
        COMBINED_last_grade = combined_data[target_company_last_available_period].get("summary_rating", None) if combined_data else None
        COMBINED_previous_grade = combined_data[list(sorted(list(target_company_data)))[-2]].get("summary_rating", None) if combined_data and len(
            target_company_data) > 1 else None
        
        rating_description = target_company_data[target_company_last_available_period][
            "rating_description"].replace(
            "(infx)", "").replace(
            "(-infx)", "").replace(
            "(nanx)", "").replace(
            "(inf%)", "").replace(
            "(-inf%)", "").replace(
            "(nan%)", "") \
            if target_company_data[target_company_last_available_period].get("rating_description", None) else None
        
        rating_description_paragraph_with_symbols = rating_description if rating_description else None
        rating_description = [
            description.encode("utf-8").decode() for description in
            rating_description_paragraph_with_symbols.split("\n")
            if len(description) >= 5  # <- отфильтровываем пустые значения
        ]
        
        conclusion_paragraph, balance_paragraph, income_paragraph, ratios_paragraph = self.__get_paragraphs(
            target_company_data=target_company_data)
        
        # court cases
        court_cases_data = data[self.target_company_registration_identifier][target_company_last_available_period].get("court_cases_data")[:10]
        
        # group
        if combined_data:
            # "Combined Balance Sheet" Таблица баланса комбинированной отчетности
            combined_balance_matrix = self.__aggregate_balance_and_profit_loss_data(
                data=combined_data,
                b_or_p_l="balance"
            )
            # "Combined Profit & Loss Accounts" Таблица прибыли/убытков комбинированной отчётности
            combined_pl_matrix = self.__aggregate_balance_and_profit_loss_data(
                data=combined_data,
                b_or_p_l="profit&loss"
            )
            
            # Основные компании по выручке
            revenue_sorted_tuples = self.__sort_by_last_available_period_and_specific_article(
                data=data,
                article="revenue")
            revenue_main_company = self.__aggregate_article_data_for_table(
                data=data,
                article="revenue",
                sorted_tuples=revenue_sorted_tuples,
            )
            
            # Основные компании по чистой прибыли/убытку
            net_financial_result_sorted_tuples = self.__sort_by_last_available_period_and_specific_article(
                data=data,
                article="net_financial_result")
            net_financial_result_main_company = self.__aggregate_article_data_for_table(
                data=data,
                article="net_financial_result",
                sorted_tuples=net_financial_result_sorted_tuples,
            )
            
            # Основные компании по долгам
            gross_debt_sorted_tuples = self.__sort_by_last_available_period_and_specific_article(
                data=data,
                article="gross_debt")
            gross_debt_main_company = self.__aggregate_article_data_for_table(
                data=data,
                article="gross_debt",
                sorted_tuples=gross_debt_sorted_tuples,
            )
            
            # Основные компании по долгосрочным активам
            total_long_term_assets_sorted_tuples = self.__sort_by_last_available_period_and_specific_article(
                data=data,
                article="total_long_term_assets")
            total_long_term_assets_main_company = self.__aggregate_article_data_for_table(
                data=data,
                article="total_long_term_assets",
                sorted_tuples=total_long_term_assets_sorted_tuples,
            )
            
            # ___________________________________________________________
            # COMBINED ratios tables
            (
                combined_profitability_ratios,
                combined_liquidity_ratios,
                combined_turnover_ratios
            ) = self.__aggregate_financial_ratios_data_for_tables(target_company_or_combined=combined_data)
            
            # ___________________________________________________________
            # group_structure
            group_structure = self.__aggregate_group_structure(data=data)
            
            # ___________________________________________________________
            # paragraphs
            conclusion_paragraph, balance_paragraph, income_paragraph, ratios_paragraph = self.__get_paragraphs(
                target_company_data=target_company_data)
            
            data_for_the_report["revenue_main_company_matrix"] = revenue_main_company
            data_for_the_report["net_financial_result_main_company_matrix"] = net_financial_result_main_company
            data_for_the_report["gross_debt_main_company_matrix"] = gross_debt_main_company
            data_for_the_report["total_long_term_assets_main_company_matrix"] = total_long_term_assets_main_company
            
            data_for_the_report["combined_balance_matrix"] = combined_balance_matrix
            data_for_the_report["combined_pl_matrix"] = combined_pl_matrix
            
            data_for_the_report["combined_profitability_ratios_matrix"] = combined_profitability_ratios
            data_for_the_report["combined_liquidity_ratios_matrix"] = combined_liquidity_ratios
            data_for_the_report["combined_turnover_ratios_matrix"] = combined_turnover_ratios
            
            data_for_the_report["group_structure_matrix"] = group_structure
        
        company_balance_matrix = self.__aggregate_balance_and_profit_loss_data(
            data=target_company_data,
            b_or_p_l="balance"
        )
        # Таблица прибыли/убытков целевой компании
        company_pl_matrix = self.__aggregate_balance_and_profit_loss_data(
            data=target_company_data,
            b_or_p_l="profit&loss"
        )
        (
            company_profitability_ratios,
            company_liquidity_ratios,
            company_turnover_ratios
        ) = self.__aggregate_financial_ratios_data_for_tables(target_company_or_combined=target_company_data)
        
        data_for_graph = self.__aggregate_data_for_graphs(
            data=self.dict_with_data,
            registration_identifier=self.target_company_registration_identifier
        )
        
        data_for_the_report["company_balance_matrix"] = company_balance_matrix
        data_for_the_report["company_pl_matrix"] = company_pl_matrix
        
        data_for_the_report["company_profitability_ratios_matrix"] = company_profitability_ratios
        data_for_the_report["company_liquidity_ratios_matrix"] = company_liquidity_ratios
        data_for_the_report["company_turnover_ratios_matrix"] = company_turnover_ratios
        
        data_for_the_report["is_group"] = is_group
        data_for_the_report["currency"] = currency
        data_for_the_report["COMBINED_last_available_period"] = COMBINED_last_available_period
        data_for_the_report["target_company_last_available_period"] = target_company_last_available_period
        # TODO <PERIOD>
        data_for_the_report["financial_statement_period_types"] = period_types
        
        data_for_the_report["company_name"] = company_name
        data_for_the_report["founding_date"] = founding_date
        data_for_the_report["status"] = status
        data_for_the_report["owners"] = owners
        
        data_for_the_report["line_of_business"] = line_of_business
        data_for_the_report["tax_identifier"] = tax_identifier
        data_for_the_report["registration_identifier"] = registration_identifier
        data_for_the_report["address"] = address
        data_for_the_report["number_active_companies"] = number_active_companies
        data_for_the_report["number_companies_in_group"] = number_companies_in_group
        data_for_the_report["credit_limit"] = credit_limit
        data_for_the_report["group_credit_limit"] = group_credit_limit
        data_for_the_report["last_grade"] = last_grade
        data_for_the_report["previous_grade"] = previous_grade
        data_for_the_report["COMBINED_last_grade"] = COMBINED_last_grade
        data_for_the_report["COMBINED_previous_grade"] = COMBINED_previous_grade
        data_for_the_report["rating_description"] = rating_description
        
        data_for_the_report["conclusion_paragraph"] = conclusion_paragraph
        data_for_the_report["balance_paragraph"] = balance_paragraph
        data_for_the_report["income_paragraph"] = income_paragraph
        data_for_the_report["ratios_paragraph"] = ratios_paragraph
        
        data_for_the_report["data_for_graph"] = data_for_graph
        data_for_the_report["court_cases"] = court_cases_data
        data_for_the_report["count_not_active"] = self.count_not_active
        
        return self.dict_with_data
