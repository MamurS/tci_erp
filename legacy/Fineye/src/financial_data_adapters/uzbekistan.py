from typing import Any, Dict, List, Tuple
from src.mapping import CURRENCY_MAPPING
from src.financial_data_adapters.base_adapter import BaseFinancialDataAdapter


class UzbekistanFinancialDataAdapter(BaseFinancialDataAdapter):
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
                
            fixed_assets = code_value_dict.get("012")
            long_term_investments = code_value_dict.get("030")
            total_long_term_assets = code_value_dict.get("130")
            inventories = code_value_dict.get("140")
            accounts_receivable = code_value_dict.get("210")
            short_term_investments = code_value_dict.get("370")
            cash = (
                code_value_dict["320"] if code_value_dict.get("320") else 0
                - code_value_dict["370"] if code_value_dict.get("370") else 0
            )
            total_short_term_assets = code_value_dict.get("390")
            total_assets = code_value_dict.get("400")
            retained_earnings = code_value_dict.get("450")
            equity = code_value_dict.get("480")
            long_term_debt = (
                code_value_dict["570"] if code_value_dict.get("570") else 0
                + code_value_dict["580"] if code_value_dict.get("580") else 0
            )
            total_long_term_liabilities = code_value_dict.get("490")
            short_term_debt = (
                code_value_dict["730"] if code_value_dict.get("730") else 0
                + code_value_dict["740"] if code_value_dict.get("740") else 0
                + code_value_dict["750"] if code_value_dict.get("750") else 0
            )
            accounts_payable = (
                code_value_dict["601"] if code_value_dict.get("601") else 0 
                - code_value_dict["620"] if code_value_dict.get("620") else 0
                - code_value_dict["630"] if code_value_dict.get("630") else 0
                - code_value_dict["640"] if code_value_dict.get("640") else 0
                - code_value_dict["710"] if code_value_dict.get("710") else 0
            )
            total_short_term_liabilities = code_value_dict.get("600")
            revenue = code_value_dict.get("f2_010")
            cost_of_goods_sold = code_value_dict.get("f2_020")
            gross_financial_result = code_value_dict.get("f2_030")
            commercial_expanses = code_value_dict.get("f2_050")
            administrative_expanses = (
                code_value_dict["f2_040"] if code_value_dict.get("f2_040") else 0
                - code_value_dict["f2_050"] if code_value_dict.get("f2_050") else 0
                - code_value_dict["f2_090"] if code_value_dict.get("f2_090") else 0
            )
            operating_financial_result = code_value_dict.get("f2_100")
            interest_income = code_value_dict.get("f2_130")
            interest_expenses = code_value_dict.get("f2_180")
            other_operating_income = (
                code_value_dict["f2_110"] if code_value_dict.get("f2_110") else 0
                - code_value_dict["f2_130"] if code_value_dict.get("f2_130") else 0
            )
            other_operating_expanses = (
                code_value_dict["f2_170"] if code_value_dict.get("f2_170") else 0
                - code_value_dict["f2_180"] if code_value_dict.get("f2_180") else 0
            )
            
            financial_result_before_tax = code_value_dict.get("f2_240")
            income_tax = code_value_dict.get("f2_250")
            net_financial_result = code_value_dict.get("f2_270")
            # cashflow_from_operations = code_value_dict.get("")  # TODO Уточнить у Мамура
            # capital_expenses = code_value_dict.get("")  # TODO Уточнить у Мамура

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
                # "cashflow_from_operations": cashflow_from_operations if cashflow_from_operations is not None else 0,
                # "capital_expenses": capital_expenses if capital_expenses is not None else 0,
            }
        
        return self.adapted_financial_data
