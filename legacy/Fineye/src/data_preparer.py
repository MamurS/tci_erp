import traceback
import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import and_

from src.financial_data_adapters.kazakhstan import KazakhstanFinancialDataAdapter
from src.financial_data_adapters.mongolia import MongoliaFinancialDataAdapter
from src.financial_data_adapters.uzbekistan import UzbekistanFinancialDataAdapter

from src.mapping import CURRENCY_MAPPING

from src.models import ExchangeRate
from src.financial_data_adapters.russia import RussiaFinancialDataAdapter
from src.connection_manager import get_sync_session
from src.utils import categorize_cases



class DataPreparer:  # TODO
    def __init__(
        self,
        country: str,
        currency: str,
        data: Dict[str, Any],
        request_uuid: str,
    ) -> None:
        self.country = country
        self.currency = currency 
        self.data = data
        self.prepared_data = {}
        self.request_uuid = request_uuid
        self.report_periods: List = []
        self.report_period_types: List = []
        
        for company_identifier_key in self.data:
            for period in list(sorted(self.data[company_identifier_key]["financial_statement"])):
                self.report_periods.append(period[6:])
                self.report_period_types.append(self.data[company_identifier_key]["financial_statement"][period]["period_type"]) # TODO <PERIOD>
    
    @staticmethod
    def _try(callback: Callable):
        try:
            return callback()
        except Exception as e:
            # error_message = str(e)
            # formatted_traceback = traceback.format_exc()
            # log_content = f"{error_message}\n{formatted_traceback}"
            # print(log_content)
            return
    
    @staticmethod
    def __calculate_age_company(
        founding_date: Optional[str],
        termination_date: Optional[str]
    ) -> float:
        if not founding_date:
            return 2.0
        
        founding_dt = datetime.datetime.strptime(founding_date, "%Y-%m-%d").date()
        
        end_dt = (
            datetime.datetime.strptime(termination_date, "%Y-%m-%d").date()
            if termination_date
            else datetime.datetime.now().date()
        )
        
        time_delta = end_dt - founding_dt
        age = round(time_delta.days / 365.2425, 2)
        
        return max(0.0, age)
    
    def prepare_data(self):
        self.prepared_data = {"data": {}}
        
        for company_identifier_key in self.data:
            
            if not self.data[company_identifier_key]["financial_statement"]:
                continue  # TODO тут стоит продумать вставку в итоговую выборку данных, без финансовой информации
            
            match self.country:
                case "Russia":
                    adapted_financial_data = RussiaFinancialDataAdapter(
                        financial_data=self.data[company_identifier_key]["financial_statement"],
                    ).adapt_financial_data()
                    # print(adapted_financial_data)
                    
                case "Uzbekistan":
                    adapted_financial_data = UzbekistanFinancialDataAdapter(
                        financial_data=self.data[company_identifier_key]["financial_statement"],
                    ).adapt_financial_data()
                
                case "Mongolia":
                    adapted_financial_data = MongoliaFinancialDataAdapter(
                        financial_data=self.data[company_identifier_key]["financial_statement"],
                    ).adapt_financial_data()
                
                case "Kazakhstan":
                    adapted_financial_data = KazakhstanFinancialDataAdapter(
                        financial_data=self.data[company_identifier_key]["financial_statement"],
                    ).adapt_financial_data()
                
                case _:
                    raise ValueError("Проблема со страной компании, по которой производится запрос на отчет.")
            
            with get_sync_session() as session:
                original_currency = list(CURRENCY_MAPPING)[list(CURRENCY_MAPPING.values()).index(CURRENCY_MAPPING[adapted_financial_data[list(adapted_financial_data)[0]].get("currency")])]
                
                if self.currency == "ORIGINAL":
                    exchange_rate = 1
                    currency = original_currency
                    if currency == "USD":
                        exchange_rate_USD = 1
                    else:
                        exchange_rate_USD = float(session.query(
                            ExchangeRate
                                ).filter(
                                    and_(
                                        ExchangeRate.date == datetime.datetime.strptime(f"31.12.{max(self.report_periods)}", "%d.%m.%Y"),
                                        ExchangeRate.from_currency == CURRENCY_MAPPING["USD"],
                                        ExchangeRate.to_currency == CURRENCY_MAPPING[currency]
                                    )
                        ).first().value)
                
                elif self.currency == "USD":
                    exchange_rate = float(session.query(
                        ExchangeRate
                            ).filter(
                                and_(
                                    ExchangeRate.date == datetime.datetime.strptime(f"31.12.{max(self.report_periods)}", "%d.%m.%Y"),
                                    ExchangeRate.from_currency == CURRENCY_MAPPING[self.currency],
                                    ExchangeRate.to_currency == CURRENCY_MAPPING[original_currency]
                                )
                    ).first().value)
                    currency = self.currency
                    exchange_rate_USD = 1
                
                elif self.currency == "EUR":
                    exchange_rate = float(session.query(
                    ExchangeRate
                        ).filter(
                            and_(
                                ExchangeRate.date == datetime.datetime.strptime(f"31.12.{max(self.report_periods)}", "%d.%m.%Y"),
                                ExchangeRate.from_currency == CURRENCY_MAPPING[self.currency],
                                ExchangeRate.to_currency == CURRENCY_MAPPING[original_currency]
                            )
                        ).first().value)
                    currency = self.currency
                    exchange_rate_USD = float(session.query(
                        ExchangeRate
                            ).filter(
                                and_(
                                    ExchangeRate.date == datetime.datetime.strptime(f"31.12.{max(self.report_periods)}", "%d.%m.%Y"),
                                    ExchangeRate.from_currency == CURRENCY_MAPPING["USD"],
                                    ExchangeRate.to_currency == CURRENCY_MAPPING[currency]
                                )
                    ).first().value)
                
                else:
                    raise ValueError("Некорректный выбор валюты отчета.")
            
            
            company_full_name = self.data[company_identifier_key]["company"].get("full_name")
            company_short_name = self.data[company_identifier_key]["company"].get("short_name")
            founding_date = self.data[company_identifier_key]["company"].get("founding_date")
            termination_date = self.data[company_identifier_key]["company"].get("termination_date")
            registration_identifier = self.data[company_identifier_key]["company"].get("registration_identifier_value")
            tax_identifier = self.data[company_identifier_key]["company"].get("tax_identifier_value")
            
            status = self.data[company_identifier_key]["company"].get("status")
            address_data = None
            for key in self.data[company_identifier_key]["company_address"]:
                if self.data[company_identifier_key]["company_address"][key].get("address_type") == "Legal address":
                    address_data = self.data[company_identifier_key]["company_address"][key]
            
            address = address_data.get("full_address") if address_data else None
            
            activity_data = None
            for key in self.data[company_identifier_key]["company_activity"]:
                if self.data[company_identifier_key]["company_activity"][key].get("is_main") is True:
                    activity_data = self.data[company_identifier_key]["company_activity"][key]
            main_activity = activity_data.get("code") if activity_data else None
            
            owners = []  # коллекция дольщиков (ЮЛ + ФЛ + УчрИн)
            
            if self.data[company_identifier_key]["company"].get("foreigners_founders"):
                foreigners_founders = self.data[company_identifier_key]["company"]["foreigners_founders"]
                if all(foreigners_founders):
                    owners.extend(foreigners_founders)
            
            company_shareholder_data: Dict[str, Any] = self.data[company_identifier_key].get("company_shareholder")
            person_shareholder_data: Dict[str, Any] = self.data[company_identifier_key].get("person_shareholder")
            
            for company_shareholder_key in company_shareholder_data:
                percent = company_shareholder_data[company_shareholder_key].get("share_percent") if company_shareholder_data[company_shareholder_key].get("share_percent") else "-"
                value = company_shareholder_data[company_shareholder_key].get("share_value") if company_shareholder_data[company_shareholder_key].get("share_value") else "-"
                short_name = company_shareholder_data[company_shareholder_key].get("short_name")
                full_name = company_shareholder_data[company_shareholder_key].get("full_name")
                company_identifier = company_shareholder_data[company_shareholder_key].get("registration_identifier_value")
                
                company_row = [company_shareholder_key, percent, value] + [
                    short_name if short_name else full_name
                    if full_name else None,
                    company_identifier,
                ]
                owners.append(company_row)
            
            for person_shareholder_key in person_shareholder_data:
                percent = person_shareholder_data[person_shareholder_key].get("share_percent") if person_shareholder_data[person_shareholder_key].get("share_percent") else "-"
                value = person_shareholder_data[person_shareholder_key].get("share_value") if person_shareholder_data[person_shareholder_key].get("share_value") else "-"
                surname = person_shareholder_data[person_shareholder_key].get("surname")
                first_name = person_shareholder_data[person_shareholder_key].get("first_name")
                patronymic = person_shareholder_data[person_shareholder_key].get("patronymic")
                person_identifier = person_shareholder_data[person_shareholder_key].get("identifier_value")
                
                person_row = [person_shareholder_key, percent, value] + [
                    " ".join([
                        surname if surname else '',
                        first_name if first_name else '',
                        patronymic if patronymic else "",
                    ]).strip().replace("  ", " "),
                    person_identifier,
                ]
                owners.append(person_row)
            
            # COURT CASES
            court_case = self.data[company_identifier_key].get("company_court_case")
            currency_id = None
            if court_case:
                currency_id = court_case[list(court_case)[0]].get("currency_id")
            
            # Выравнивание периодов для судебных дел
            year_today = datetime.datetime.now().year
            sorted_periods = list(sorted(self.data[company_identifier_key]["financial_statement"]))
            add_year_for_court_case = 0
            if year_today > int(sorted_periods[-1].split(".")[-1]):
                add_year_for_court_case = 1
            
            for idx, period in enumerate(sorted_periods):
                court_cases_by_period = categorize_cases(cases_dict=court_case, year_filter=str(int(period.split(".")[-1]) + add_year_for_court_case))
                
                if currency_id:
                    court_cases_by_period.update({"currency_id": currency_id})
                articles = {
                    "simplified_financial_statement": adapted_financial_data[period].get("simplified_financial_statement"),
                    "company_full_name": company_full_name,
                    "company_short_name": company_short_name,
                    "founding_date": founding_date,
                    "termination_date": termination_date,
                    "country": self.country,
                    "registration_identifier": registration_identifier,
                    "tax_identifier": tax_identifier,
                    "address": address,
                    "main_activity": main_activity,  # TODO (???) ДЛЯ COMBINED рассчитать по (выручке) какому-либо приоритетному показателю главную(приносящую прибыль) активность
                    "age": DataPreparer.__calculate_age_company(founding_date=founding_date, termination_date=termination_date),
                    "status": status,
                    "owners": owners,
                    
                    "court_cases": court_cases_by_period,
                    
                    "financial_statement_period_type": self.report_period_types[idx],
                    "currency": currency,
                    "non_current_assets": DataPreparer._try(lambda: adapted_financial_data[period].get("non_current_assets") / exchange_rate),
                    "fixed_assets": DataPreparer._try(lambda: adapted_financial_data[period].get("fixed_assets") / exchange_rate),
                    "long_term_investments": DataPreparer._try(lambda: adapted_financial_data[period].get("long_term_investments") / exchange_rate),
                    "total_long_term_assets": DataPreparer._try(lambda: adapted_financial_data[period].get("total_long_term_assets") / exchange_rate),
                    "inventories": DataPreparer._try(lambda: adapted_financial_data[period].get("inventories") / exchange_rate),
                    "accounts_receivable": DataPreparer._try(lambda: adapted_financial_data[period].get("accounts_receivable") / exchange_rate),
                    "short_term_investments": DataPreparer._try(lambda: adapted_financial_data[period].get("short_term_investments") / exchange_rate),
                    "cash": DataPreparer._try(lambda: adapted_financial_data[period].get("cash") / exchange_rate),
                    "total_short_term_assets": DataPreparer._try(lambda: adapted_financial_data[period].get("total_short_term_assets") / exchange_rate),
                    "total_assets": DataPreparer._try(lambda: adapted_financial_data[period].get("total_assets") / exchange_rate),
                    "retained_earnings": DataPreparer._try(lambda: adapted_financial_data[period].get("retained_earnings") / exchange_rate),
                    "equity": DataPreparer._try(lambda: adapted_financial_data[period].get("equity") / exchange_rate),
                    "long_term_debt": DataPreparer._try(lambda: adapted_financial_data[period].get("long_term_debt") / exchange_rate),
                    "total_long_term_liabilities": DataPreparer._try(lambda: adapted_financial_data[period].get("total_long_term_liabilities") / exchange_rate),
                    "short_term_debt": DataPreparer._try(lambda: adapted_financial_data[period].get("short_term_debt") / exchange_rate),
                    "accounts_payable": DataPreparer._try(lambda: adapted_financial_data[period].get("accounts_payable") / exchange_rate),
                    "total_short_term_liabilities": DataPreparer._try(lambda: adapted_financial_data[period].get("total_short_term_liabilities") / exchange_rate),
                    "revenue": DataPreparer._try(lambda: adapted_financial_data[period].get("revenue") / exchange_rate),
                    "cost_of_goods_sold": DataPreparer._try(lambda: adapted_financial_data[period].get("cost_of_goods_sold") / exchange_rate),
                    "gross_financial_result": DataPreparer._try(lambda: adapted_financial_data[period].get("gross_financial_result") / exchange_rate),
                    "commercial_expanses": DataPreparer._try(lambda: adapted_financial_data[period].get("commercial_expanses") / exchange_rate),
                    "administrative_expanses": DataPreparer._try(lambda: adapted_financial_data[period].get("administrative_expanses") / exchange_rate),
                    "operating_financial_result": DataPreparer._try(lambda: adapted_financial_data[period].get("operating_financial_result") / exchange_rate),
                    "interest_income": DataPreparer._try(lambda: adapted_financial_data[period].get("interest_income") / exchange_rate),
                    "interest_expenses": DataPreparer._try(lambda: adapted_financial_data[period].get("interest_expenses") / exchange_rate),
                    "other_operating_income": DataPreparer._try(lambda: adapted_financial_data[period].get("other_operating_income") / exchange_rate),
                    "other_operating_expanses": DataPreparer._try(lambda: adapted_financial_data[period].get("other_operating_expanses") / exchange_rate),
                    "financial_result_before_tax": DataPreparer._try(lambda: adapted_financial_data[period].get("financial_result_before_tax") / exchange_rate),
                    "income_tax": DataPreparer._try(lambda: adapted_financial_data[period].get("income_tax") / exchange_rate),
                    "net_financial_result": DataPreparer._try(lambda: adapted_financial_data[period].get("net_financial_result") / exchange_rate),
                    "cashflow_from_operations": DataPreparer._try(lambda: adapted_financial_data[period].get("cashflow_from_operations") / exchange_rate),
                    "capital_expenses": DataPreparer._try(lambda: adapted_financial_data[period].get("capital_expenses") / exchange_rate),
                }
                if not self.prepared_data["data"].get(company_identifier_key):
                    self.prepared_data["data"][company_identifier_key] = {}
                if not self.prepared_data["data"][company_identifier_key].get(period[6:]):
                    self.prepared_data["data"][company_identifier_key][period[6:]] = {}
                
                for article_key, article_value in articles.copy().items():
                    self.prepared_data["data"][company_identifier_key][period[6:]][article_key] = article_value
                    self.prepared_data["data"][company_identifier_key][period[6:]]["exchange_rate"] = exchange_rate
                    self.prepared_data["data"][company_identifier_key][period[6:]]["exchange_rate_USD"] = exchange_rate_USD
            
        
        return self.prepared_data
