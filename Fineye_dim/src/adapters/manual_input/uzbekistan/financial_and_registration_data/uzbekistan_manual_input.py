import datetime
from typing import Any, Dict
from src.adapters.base_adapters import BaseManualInputFinancialAndRegistrationDataAdapter
from src.schemas import ActivityScheme, AddressScheme, CompanyScheme, DataForInsertionModuleScheme, FinancialStatementRowScheme, FinancialStatementScheme, PersonScheme
from service_logger.app import Log
from src.utils.constants.mapping import (
    COUNTRY_MAPPING, CURRENCY_MAPPING,
    FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING,
    STATUS_INFORMATION_MAPPING,
)


class UzbekistanManualInputAdapterFinancialAndRegistrationData(BaseManualInputFinancialAndRegistrationDataAdapter):
    def __init__(self, identifier: str, request_uuid: str, data_from_manual_input_service: Dict[str, Any]):
        super().__init__(
            identifier=identifier,
            request_uuid=request_uuid,
            data_from_manual_input_service=data_from_manual_input_service
        )
    
    async def adapt_data(self) -> DataForInsertionModuleScheme:
        SOURCE_INFO = "Модуль ручного ввода"
        COUNTRY_UZBEKISTAN = COUNTRY_MAPPING["Uzbekistan"]
        CURRENCY_UZS = CURRENCY_MAPPING["UZS"]
        STATUS_INFO_ACTUAL = STATUS_INFORMATION_MAPPING["Actual"]
        
        registration_data = self.data_from_manual_input_service["registration_data"]
        FINANCIAL_STATEMENT_PERIOD = FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING[registration_data["financial_statement_period_type"]]
        
        try:
            registration_identifier_name = "ИНН"
            registration_identifier_value = str(registration_data["registration_identifier"]) if registration_data.get("registration_identifier") else None
            tax_identifier_name = "ИНН"
            tax_identifier_value = str(registration_data["tax_number"]) if registration_data.get("tax_number") else None
            full_name = registration_data.get("full_company_name")
            short_name = registration_data.get("short_company_name")
            founding_date = (
                datetime.datetime.strptime(registration_data["date_of_registration"], "%Y-%m-%d")
                if registration_data.get("date_of_registration") else None
            )
            status = registration_data.get("status")
            termination_date = (
                datetime.datetime.strptime(registration_data["date_of_termination"], "%Y-%m-%d")
                if registration_data.get("date_of_termination") else None
            )
            address = registration_data.get("address")
            zip_code = registration_data.get("zip_code")
            main_acivity_code = str(registration_data["main_activity_code"]) if registration_data.get("main_activity_code") else None
            main_activity_description = str(registration_data["main_activity_description"]) if registration_data.get("main_activity_description") else None
            owners_full_name = registration_data.get("owners_full_name")
            owners_identifier = registration_data["owners_identifier"] if registration_data.get("owners_identifier") else None
            reporting_period = registration_data.get("reporting_period")
            currency = registration_data.get("currency")
            
            self.data["companies"]["company_1"] = CompanyScheme(
                source_info=SOURCE_INFO,
                important_information=None,
                country_id=COUNTRY_UZBEKISTAN,
                registration_identifier_name=registration_identifier_name,
                registration_identifier_value=registration_identifier_value,
                tax_identifier_name=tax_identifier_name,
                tax_identifier_value=tax_identifier_value,
                status=status, # type: ignore
                short_name=short_name, # type: ignore
                full_name=full_name, # type: ignore
                short_name_en=None,
                full_name_en=None,
                founding_date=founding_date, # type: ignore
                termination_date=termination_date, # type: ignore
                is_financial_company=None,
            )
            
            assert registration_data, "Отсутствует информация о ЮР лице"
            assert registration_identifier_value or tax_identifier_value, "Нет идентификатора компании"
        except Exception as e:
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при извлечении регистрационной информации компании:\ncountry: 214;\nidentifier: {self.identifier};\n{e}."
            )
            raise ValueError(f"Ошибка при извлечении регистрационной информации компании\n{e}")

        financial_data = None
        try:
            financial_data = self.data_from_manual_input_service["financial_data"]
            
            balance_preceding_previous_year = financial_data["balance_preceding_previous_year"]
            balance_previous_year = financial_data["balance_previous_year"]
            balance_current_year = financial_data["balance_current_year"]
            income_statement_preceding_previous_year = financial_data["income_statement_preceding_previous_year"]
            income_statement_previous_year = financial_data["income_statement_previous_year"]
            income_statement_current_year = financial_data["income_statement_current_year"]
        except Exception as e:
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка при извлечении финансовой информации компании:\ncountry: 214;\nidentifier: {self.identifier}."
            )
        
        main_activity = ActivityScheme(
            is_main=True,
            code=main_acivity_code, # type: ignore
            description=main_activity_description, # type: ignore
            date=None,
            status_info_id=STATUS_INFO_ACTUAL,
        )
        self.data["companies_activities"] = {
            "company_1": [],
        }
        self.data["companies_activities"]["company_1"].append(main_activity)
        
        full_address = address
        company_address = AddressScheme(
            country_id=COUNTRY_UZBEKISTAN,
            address_type="Legal address",
            region_code=None,
            zip=zip_code,
            full_address=full_address, # type: ignore
            region=None,
            area=None,
            locality=None,
            street=None,
            house=None,
            frame=None,
            room=None,
            date_from=None,
            status_info_id=STATUS_INFO_ACTUAL,
        )
        self.data["companies_addresses"] = {
            "company_1": [],
        }
        self.data["companies_addresses"]["company_1"].append(company_address)
        
        if owners_identifier and owners_full_name:
            surname = owners_full_name.split()[0]   # type: ignore
            first_name = owners_full_name.split()[1] if len(owners_full_name.split()) > 1 else None  # type: ignore
            patronomic = owners_full_name.split()[2:] if len(owners_full_name.split()) > 2 else None  # type: ignore
            self.data["persons"]["person_1"] = PersonScheme(
                source_info=SOURCE_INFO,
                important_information="",
                surname=surname,
                first_name=first_name,
                patronymic=patronomic,
                date_birth=None,
                gender=None,
                citizenship=None,
                identifier_name="ПИНФЛ",
                identifier_value=owners_identifier, # type: ignore
                identifier_sub_name=None,
                identifier_sub_value=None,
            )

        # reporting_period
        # currency
        if financial_data and reporting_period:
            self.data["companies_financial_statements"] = {
                "company_1": {},
            }
            month_and_day = "12-31"
            if FINANCIAL_STATEMENT_PERIOD == FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Annual"]:
                month_and_day = "12-31"
            elif FINANCIAL_STATEMENT_PERIOD == FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Quarterly"]:
                month_and_day = "03-31"
            elif FINANCIAL_STATEMENT_PERIOD == FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Semi-annual"]:
                month_and_day = "06-30"
            elif FINANCIAL_STATEMENT_PERIOD == FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Nine month"]:
                month_and_day = "09-30"
            
            bo_periods = [
                datetime.datetime.strptime(f"{int(reporting_period - 2)}-12-31", "%Y-%m-%d").date(), # type: ignore
                datetime.datetime.strptime(f"{int(reporting_period) - 1}-12-31", "%Y-%m-%d").date(), # type: ignore
                datetime.datetime.strptime(f"{int(reporting_period)}-{month_and_day}", "%Y-%m-%d").date(), # type: ignore
            ]
            
            subtrahend = 0
            if balance_preceding_previous_year or income_statement_preceding_previous_year:
                if balance_preceding_previous_year and income_statement_preceding_previous_year:
                    financial_dict_preceding_previous_year = {**balance_preceding_previous_year, **income_statement_preceding_previous_year}
                elif balance_preceding_previous_year and not income_statement_preceding_previous_year:
                    financial_dict_preceding_previous_year = {**balance_preceding_previous_year}
                elif not balance_preceding_previous_year and income_statement_preceding_previous_year:
                    financial_dict_preceding_previous_year = {**income_statement_preceding_previous_year}
            else:
                subtrahend += 1
                bo_periods = bo_periods[1:]
                financial_dict_preceding_previous_year = {}
            if balance_previous_year or income_statement_previous_year:
                if balance_previous_year and income_statement_previous_year:
                    financial_dict_previous_year = {**balance_previous_year, **income_statement_previous_year}
                elif balance_previous_year and not income_statement_previous_year:
                    financial_dict_previous_year = {**balance_previous_year}
                elif not balance_previous_year and income_statement_previous_year:
                    financial_dict_previous_year = {**income_statement_previous_year}
            else:
                subtrahend += 1
                bo_periods = bo_periods[-1:]
                financial_dict_previous_year = {}
            financial_dict_current_year = {**balance_current_year, **income_statement_current_year}
            
            last_period_idx = len(bo_periods) - 1
            for idx, bo_period in enumerate(bo_periods):
                financial_statement_id = f"financial_statement_{idx + 1}"
                self.data["companies_financial_statements"]["company_1"][financial_statement_id] = FinancialStatementScheme(
                    source_info=SOURCE_INFO,
                    period_type_id=FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Annual"] if idx != last_period_idx else FINANCIAL_STATEMENT_PERIOD,
                    date=bo_period,
                    currency_id=CURRENCY_UZS,
                )
                self.data.setdefault("companies_financial_statements_rows")
                self.data["companies_financial_statements_rows"].update({financial_statement_id: []})
            
            for idx, report_by_period in enumerate([
                financial_dict_preceding_previous_year,
                financial_dict_previous_year,
                financial_dict_current_year,
            ]):
                if report_by_period:
                    for financial_statement_row_name, financial_statement_row_value in report_by_period.items():
                        if financial_statement_row_value is not None:
                            financial_statement_row = FinancialStatementRowScheme(
                                type_id=None,
                                name=financial_statement_row_name,
                                value=round(float(financial_statement_row_value), 2),
                                status_info_id=STATUS_INFO_ACTUAL,
                            )
                            self.data["companies_financial_statements_rows"][f"financial_statement_{idx + 1 - subtrahend}"].append(financial_statement_row)
                    else:
                        continue
        return DataForInsertionModuleScheme(**self.data)
