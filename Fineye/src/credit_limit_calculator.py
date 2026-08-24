from typing import Any, Dict
from service_logger.app import Log


class CreditLimitCalculator:
    """Класс расчета кредитного лимита, на основе рейтинга и финансовых показателей компании/группы"""
    
    def __init__(self, dict_with_data: Dict[str, Any], request_uuid: str):
        self.dict_with_data = dict_with_data
        self.request_uuid = request_uuid
    
    @staticmethod
    def __our_standart(
        company_report_for_period: Dict[str, Any],
        rating: int|float,
        exchange_rate: int|float
    ) -> int|float:
        payable = company_report_for_period["accounts_payable"]
        equity = company_report_for_period["equity"]
        equity_ratio = company_report_for_period["equity_ratio"]
        net_financial_result = company_report_for_period["net_financial_result"]
        
        # if not payable:
        #     payable = 0
        # else:  # Перевод суммы в доллары
        #     payable = payable / exchange_rate
        if not equity:
            equity = 0
        else:  # Перевод суммы в доллары
            equity = equity / exchange_rate
        
        credit = 0
        
        credit_limits = {
            (0, 25): round(equity * 0.9),  # round(payable * 0.25),
            (25, 35): round(equity * 0.7),  # round(payable * 0.2),
            (35, 45): round(equity * 0.5),  # min(round(equity), round(payable * 0.25)),
            (45, 55): round(equity * 0.3),  # min(round(equity * 0.7), round(payable * 0.15)),
            (55, 65): round(equity * 0.1),  # min(round(equity * 0.3), round(payable * 0.10)),
            (65, 75): min(round(equity * 0.05), 10_000),  # min(round(equity * 0.1), round(payable * 0.05), 50_000)
        }  # $
        
        if rating is not None:
            for r, limit in credit_limits.items():
                if r[0] <= float(rating) < r[1]:
                    
                    if (equity is None or equity <= 0) or (net_financial_result is None or net_financial_result <= 0):
                        credit = 0
                    
                    else:
                        credit = limit
                    break
            
            if rating >= 75:
                credit = 0
        
        if credit < 5_000:
            credit = 0
        
        if equity_ratio and equity_ratio < 0.01:
            credit = 0
        
        return credit * exchange_rate
    
    @staticmethod
    def __basel_standart(
        company_report_for_period: Dict[str, Any],
        rating: int|float,
    ) -> int|float:
        equity = company_report_for_period["equity"]
        if not equity:
            equity = 0
        
        non_current_assets = company_report_for_period.get("non_current_assets", 0)
        revenue = company_report_for_period.get("revenue", 0)
        days_sales_outstanding = company_report_for_period["days_sales_outstanding"] if company_report_for_period.get("days_sales_outstanding") else 45  # FIXME ТУТ ВЗЯТО СРЕДНЕЕ DSO
        
        intangible_assets = non_current_assets
        
        credit = 0
        
        rc = 0
        if rating is not None:
            if 11 > rating >= 1:
                rc = 1.5
            elif 26 > rating >= 11:
                rc = 1.2
            elif 41 > rating >= 26:
                rc = 1
            elif 56 > rating >= 41:
                rc = 0.7
            elif 66 > rating >= 56:
                rc = 0.4
            elif 76 > rating >= 66:
                rc = 0.15
            elif 101 > rating >= 76:
                rc = 0
        
        mc = equity - intangible_assets
        
        credit_A = mc * 0.1 * rc
        
        credit_B = (revenue * days_sales_outstanding / 365) * rc
        
        credit = (credit_A + credit_B) / 2
        
        return round(credit)
    
    async def __calculate_credit_limit(self) -> dict:
        for registration_identifier in self.dict_with_data["data"]:
            for period in list(sorted(list(self.dict_with_data["data"][registration_identifier])))[-2 if len(list(self.dict_with_data["data"][registration_identifier])) >= 2 else 0:]:
                company_report_for_period = self.dict_with_data["data"][registration_identifier][period]
                
                exchange_rate = company_report_for_period["exchange_rate_USD"]
                rating = company_report_for_period.get("summary_rating", None)
                
                try:
                    credit = self.__basel_standart(
                        company_report_for_period=company_report_for_period,
                        rating=rating,
                    )
                except Exception as e:
                    import traceback
                    error_message = str(e)
                    formatted_traceback = traceback.format_exc()
                    log_content = f"{error_message}\n{formatted_traceback}"
                    # print(f"(our_stdt) err: {log_content=}")
                    await Log.add_log(
                        log_type="warning",
                        request_uuid=self.request_uuid,
                        message=f"Не получилось рассчитать кредитный лимит по базелю для {registration_identifier} - {period}:\nuuid: {self.request_uuid};\n{log_content};\n{e}."
                    )
                    credit = self.__our_standart(
                        company_report_for_period=company_report_for_period,
                        rating=rating,
                        exchange_rate=exchange_rate,
                    )
                
                company_report_for_period["limit"] = credit
        
        return self.dict_with_data
    
    async def get_data_with_credit_limite(self):
        await self.__calculate_credit_limit()
        
        return self.dict_with_data
