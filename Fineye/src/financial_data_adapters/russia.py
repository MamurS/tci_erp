from typing import Any, Dict, List, Tuple
from src.financial_data_adapters.base_adapter import BaseFinancialDataAdapter


class RussiaFinancialDataAdapter(BaseFinancialDataAdapter):
    def __init__(self, financial_data: Dict[str, Any]):
        super().__init__(financial_data)

    def adapt_financial_data(self) -> Dict[str, Any]:
        sorted_period_keys: Tuple[str] = tuple(sorted(self.financial_data))
        
        for period in sorted_period_keys:
            # print(f"{period=}")
            period_type: str = self.financial_data[period]["period_type"]
            # if not period_type == "Annual":  # TODO <PERIOD>
            #     continue
            currency = self.financial_data[period]["currency"]
            
            financial_data_rows_by_period: List[Dict[str, Any]] = self.financial_data[period]["rows"]
            code_value_dict: Dict[str, Any] = {}
            for financial_data_row in financial_data_rows_by_period:
                code: str = list(financial_data_row)[0]
                code_value_dict[code] = financial_data_row[code][code]
            
            # ---------------------------------------------------------------------------------------
            is_simplified_financial_statement: bool = False
            if code_value_dict.get("1100") is None and code_value_dict.get("2200") is None:
                is_simplified_financial_statement = True
            
            non_current_assets = code_value_dict.get("1110", 0)
            fixed_assets = code_value_dict.get("1150", 0)
            long_term_investments = code_value_dict.get("1160", 0) + code_value_dict.get("1170", 0)
            total_long_term_assets = code_value_dict.get("1100", 0) if not is_simplified_financial_statement else fixed_assets + long_term_investments
            inventories = code_value_dict.get("1210", 0)
            accounts_receivable = code_value_dict.get("1230", 0)
            short_term_investments = code_value_dict.get("1240", 0)
            cash = code_value_dict.get("1250", 0)
            total_short_term_assets = code_value_dict.get("1200", 0) if not is_simplified_financial_statement else (
                inventories +
                accounts_receivable +
                short_term_investments +
                cash
            )
            total_assets = code_value_dict.get("1600", 0)
            # __________________________________________________________________________________________________
            retained_earnings = code_value_dict.get("1370", 0) if not is_simplified_financial_statement else code_value_dict.get("1300", 0)
            equity = code_value_dict.get("1300", 0)
            long_term_debt = code_value_dict.get("1410", 0)
            total_long_term_liabilities = code_value_dict.get("1400", 0) if not is_simplified_financial_statement else (
                    code_value_dict.get("1410", 0) +
                    code_value_dict.get("1450", 0)
            )
            short_term_debt = code_value_dict.get("1510", 0)
            accounts_payable = code_value_dict.get("1520", 0)
            total_short_term_liabilities = code_value_dict.get("1500", 0) if not is_simplified_financial_statement else (
                    code_value_dict.get("1510", 0) +
                    code_value_dict.get("1520", 0) +
                    code_value_dict.get("1550", 0)
                )
            # __________________________________________________________________________________________________
            revenue = code_value_dict.get("2110", 0)
            cost_of_goods_sold = code_value_dict.get("2120", 0)
            gross_financial_result = code_value_dict.get("2100", 0) if not is_simplified_financial_statement else (
                code_value_dict.get("2110", 0) -
                code_value_dict.get("2120", 0)
            )
            commercial_expanses = code_value_dict.get("2210", 0)
            administrative_expanses = code_value_dict.get("2220", 0)
            operating_financial_result = code_value_dict.get("2200", 0) if not is_simplified_financial_statement else gross_financial_result
            interest_income = code_value_dict.get("2320", 0)
            interest_expenses = code_value_dict.get("2330", 0)
            other_operating_income = code_value_dict.get("2340", 0)
            other_operating_expanses = code_value_dict.get("2350", 0)
            financial_result_before_tax = code_value_dict.get("2300", 0) if not is_simplified_financial_statement else (
                    operating_financial_result +
                    interest_income -
                    interest_expenses +
                    other_operating_income -
                    other_operating_expanses
            )
            income_tax = code_value_dict.get("2410", 0)
            net_financial_result = code_value_dict.get("2400", 0)
            # __________________________________________________________________________________________________
            cashflow_from_operations = code_value_dict.get("4100", 0)  # TODO (!!!) посмотреть формулу с Мамуром для упрощенного отёта (Павел предложил n/a не брать в рассчёт вообще) (23.06.2024 - решили не использовать)
            capital_expenses = code_value_dict.get("4221", 0)
        # ---------------------------------------------------------------------------------------
            self.adapted_financial_data[period] = {
                "simplified_financial_statement": is_simplified_financial_statement,
                "currency": currency,
                "non_current_assets": non_current_assets if non_current_assets is not None else 0,
                "fixed_assets": fixed_assets if fixed_assets is not None else 0,
                "long_term_investments": long_term_investments if long_term_investments is not None else 0,
                "total_long_term_assets": total_long_term_assets if total_long_term_assets is not None else 0,
                "inventories": inventories if inventories is not None else 0,
                "accounts_receivable": accounts_receivable if accounts_receivable is not None else 0,
                "short_term_investments": short_term_investments if short_term_investments is not None else 0,
                "cash": cash if cash is not None else 0,
                "total_short_term_assets": total_short_term_assets if total_short_term_assets is not None else 0,
                "total_assets": total_assets if total_assets is not None else 0,
                "retained_earnings": retained_earnings if retained_earnings is not None else 0,
                "equity": equity if equity is not None else 0,
                "long_term_debt": long_term_debt if long_term_debt is not None else 0,
                "total_long_term_liabilities": total_long_term_liabilities if total_long_term_liabilities is not None else 0,
                "short_term_debt": short_term_debt if short_term_debt is not None else 0,
                "accounts_payable": accounts_payable if accounts_payable is not None else 0,
                "total_short_term_liabilities": total_short_term_liabilities if total_short_term_liabilities is not None else 0,
                "revenue": revenue if revenue is not None else 0,
                "cost_of_goods_sold": cost_of_goods_sold if cost_of_goods_sold is not None else 0,
                "gross_financial_result": gross_financial_result if gross_financial_result is not None else 0,
                "commercial_expanses": commercial_expanses if commercial_expanses is not None else 0,
                "administrative_expanses": administrative_expanses if administrative_expanses is not None else 0,
                "operating_financial_result": operating_financial_result if operating_financial_result is not None else 0,
                "interest_income": interest_income if interest_income is not None else 0,
                "interest_expenses": interest_expenses if interest_expenses is not None else 0,
                "other_operating_income": other_operating_income if other_operating_income is not None else 0,
                "other_operating_expanses": other_operating_expanses if other_operating_expanses is not None else 0,
                "financial_result_before_tax": financial_result_before_tax if financial_result_before_tax is not None else 0,
                "income_tax": income_tax if income_tax is not None else 0,
                "net_financial_result": net_financial_result if net_financial_result is not None else 0,
                "cashflow_from_operations": cashflow_from_operations if cashflow_from_operations is not None else 0,
                "capital_expenses": capital_expenses if capital_expenses is not None else 0,
            }
        
        return self.adapted_financial_data
