from typing import Any, Dict, List, Tuple
from src.mapping import CURRENCY_MAPPING
from src.financial_data_adapters.base_adapter import BaseFinancialDataAdapter


class MongoliaFinancialDataAdapter(BaseFinancialDataAdapter):
    def __init__(self, financial_data: Dict[str, Any]):
        super().__init__(financial_data)
    
    def adapt_financial_data(self) -> Dict[str, Any]:
        sorted_period_keys: Tuple[str] = tuple(sorted(self.financial_data))
        for period in sorted_period_keys:
            period_type: str = self.financial_data[period]["period_type"]
            # if not period_type == "Annual":  # TODO <PERIOD>
            #     continue
            currency_data = self.financial_data[period]["currency"]
            if isinstance(currency_data, int) or (isinstance(currency_data, str) and currency_data.isdigit()):
                currency_values = list(CURRENCY_MAPPING.values())
                currency = list(CURRENCY_MAPPING.keys())[currency_values.index(currency_data)]
            else:
                currency = currency_data
        
            financial_data_rows_by_period: List[Dict[str, Any]] = self.financial_data[period]["rows"]
            code_value_dict: Dict[str, Any] = {}
            for financial_data_row in financial_data_rows_by_period:
                code: str = list(financial_data_row)[0]
                code_value_dict[code] = financial_data_row[code][code]
            fixed_assets = code_value_dict.get("1.2.1", 0)
            long_term_investments = code_value_dict.get("1.2.4", 0) + code_value_dict.get("1.2.7", 0)
            total_long_term_assets = code_value_dict.get("1.2.10", 0)
            inventories = code_value_dict.get("1.1.6", 0)
            accounts_receivable = code_value_dict.get("1.1.2", 0)
            short_term_investments = code_value_dict.get("1.1.5", 0)
            cash = code_value_dict.get("1.1.1", 0)
            total_short_term_assets = code_value_dict.get("1.1.11", 0)
            total_assets = code_value_dict.get("1.3", 0)
            retained_earnings = code_value_dict.get("2.3.9", 0)
            equity = code_value_dict.get("2.3.11", 0)
            long_term_debt = code_value_dict.get("2.1.2.1", 0)
            total_long_term_liabilities = code_value_dict.get("2.1.2.6", 0)
            short_term_debt = code_value_dict.get("2.1.1.5", 0)
            accounts_payable = code_value_dict.get("2.1.1.1", 0)
            total_short_term_liabilities = code_value_dict.get("2.1.1.13", 0)
            
            revenue = code_value_dict.get("1", 0)
            cost_of_goods_sold = code_value_dict.get("2", 0)
            gross_financial_result = code_value_dict.get("3", 0)
            commercial_expanses = code_value_dict.get("9", 0)
            administrative_expanses = code_value_dict.get("10", 0)
            operating_financial_result = gross_financial_result - commercial_expanses - administrative_expanses
            interest_income = code_value_dict.get("5", 0)
            interest_expenses = code_value_dict.get("11", 0)
            
            other_operating_income = code_value_dict.get("8", 0)
            other_operating_expanses = code_value_dict.get("12", 0)
            
            financial_result_before_tax = code_value_dict.get("18", 0)
            income_tax = code_value_dict.get("19", 0)
            net_financial_result = code_value_dict.get("24", 0)
            
            self.adapted_financial_data[period] = {
                "simplified_financial_statement": None,
                "currency": currency,
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
            }
        
        return self.adapted_financial_data
