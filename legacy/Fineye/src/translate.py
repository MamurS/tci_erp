from typing import Any, Dict, List

from langdetect import detect

from .langchain_module import LangChainAbstract
from .schema import InputModel, InputModelRatingDescription, OutputModel, OutputModelRatingDescription
from .prompts import TRANSLATE_TRANLITERATE_PROMPTS_BY_LANGUAGE, TRANSLATE_TRANLITERATE_PROMPTS_BY_LANGUAGE_FOR_DESCRIPTION


RATIOS_LANGUAGE_MAPPING = {
    "English": {
        "total_long_term_assets": ["NON-CURRENT ASSETS"],
        "inventories": ["Inventories"],
        "accounts_receivable": ["Accounts receivable"],
        "cash": ["Cash"],
        "short_term_investments": ["ST Investments"],
        "total_short_term_assets": ["CURRENT ASSETS"],
        "retained_earnings": ["Retained earnings"],
        "equity": ["EQUITY"],
        "long_term_debt": ["LT Loans"],
        "short_term_debt": ["ST Loans"],
        "accounts_payable": ["Accounts payable"],
        "total_short_term_liabilities": ["CURRENT LIABILITIES"],
        "total_assets": ["TOTAL ASSETS"],
        
        "revenue": ["Revenue"],
        "cost_of_goods_sold": ["Cost of sales"],
        "gross_financial_result": ["Gross profit (loss)"],
        "commercial_expanses": ["Selling expenses"],
        "administrative_expanses": ["Administrative expenses"],
        "operating_financial_result": ["Operating profit (loss)"],
        "interest_income": ["Interest income"],
        "interest_expenses": ["Interest expense"],
        "other_operating_income": ["Other operating income"],
        "other_operating_expanses": ["Other operating expenses"],
        "financial_result_before_tax": ["Profit (loss) before tax"],
        "income_tax": ["Income tax"],
        "net_financial_result": ["Net profit (loss)"],
        
        "gross_margin": ["Gross margin"],
        "EBIT_margin": ["EBIT margin"],
        "net_profitability": ["Profit margin"],
    },
    "Russian": {
        "total_long_term_assets": ["ВНЕОБОРОТНЫЕ АКТИВЫ"],
        "inventories": ["Запасы"],
        "accounts_receivable": ["Дебиторская задолженность"],
        "cash": ["Денежные средства"],
        "short_term_investments": ["Краткосрочные вложения"],
        "total_short_term_assets": ["ОБОРОТНЫЕ АКТИВЫ"],
        "retained_earnings": ["Нераспределенная приыбль"],
        "equity": ["СОБСТВЕННЫЙ КАПИТАЛ"],
        "long_term_debt": ["Долгосрочные кредиты и займы"],
        "short_term_debt": ["Краткосрочные кредиты и займы"],
        "accounts_payable": ["Кредиторская задолженность"],
        "total_short_term_liabilities": ["ТЕКУЩИЕ ОБЯЗАТЕЛЬСТВА"],
        "total_assets": ["АКТИВЫ ВСЕГО"],
        
        "revenue": ["Выручка"],
        "cost_of_goods_sold": ["Себестоимость продаж"],
        "gross_financial_result": ["Валовая прибыль(убытки)"],
        "commercial_expanses": ["Коммерческие расходы"],
        "administrative_expanses": ["Административные расходы"],
        "operating_financial_result": ["Прибыль(убыток) от продаж"],
        "interest_income": ["Процентные доходы"],
        "interest_expenses": ["Процентные платежи"],
        "other_operating_income": ["Прочие операционные доходы"],
        "other_operating_expanses": ["Прочие операционные расходы"],
        "financial_result_before_tax": ["Прибыль(убыток) до налогооблажения"],
        "income_tax": ["Налог на прибыль"],
        "net_financial_result": ["Чистая прибыль(убыток)"],
        
        "gross_margin": ["Валовая маржа"],
        "EBIT_margin": ["EBIT маржа"],
        "net_profitability": ["Чистая рентабельность"],
    },
    "Kazakh": {
        "total_long_term_assets": ["ҰЗАҚ МЕРЗІМДІ АКТИВТЕР"],
        "inventories": ["Қорлар"],
        "accounts_receivable": ["Дебиторлық қарыз"],
        "cash": ["Қолма-қол ақша"],
        "short_term_investments": ["Қысқа мерзімді инвестициялар"],
        "total_short_term_assets": ["АҚШАЛАЙ АКТИВТЕР"],
        "retained_earnings": ["Бөлінбеген пайда"],
        "equity": ["ЖЕКЕ КАПИТАЛ"],
        "long_term_debt": ["Ұзақ мерзімді қарыздар"],
        "short_term_debt": ["Қысқа мерзімді қарыздар"],
        "accounts_payable": ["Кредиторлық қарыз"],
        "total_short_term_liabilities": ["ҚЫСҚА МЕРЗІМДІ МІНДЕТТЕМЕЛЕР"],
        "total_assets": ["БАРЛЫҚ АКТИВТЕР"],
        
        "revenue": ["Табыс"],
        "cost_of_goods_sold": ["Сатылған тауарлардың құны"],
        "gross_financial_result": ["Жалпы пайда (шығын)"],
        "commercial_expanses": ["Сауда шығындары"],
        "administrative_expanses": ["Әкімшілік шығындар"],
        "operating_financial_result": ["Операциялық пайда (шығын)"],
        "interest_income": ["Пайыздық табыс"],
        "interest_expenses": ["Пайыздық шығындар"],
        "other_operating_income": ["Басқа операциялық табыс"],
        "other_operating_expanses": ["Басқа операциялық шығындар"],
        "financial_result_before_tax": ["Салыққа дейінгі пайда (шығын)"],
        "income_tax": ["Табыс салығы"],
        "net_financial_result": ["Таза пайда (шығын)"],
        
        "gross_margin": ["Жалпы пайда маржасы"],
        "EBIT_margin": ["EBIT маржасы"],
        "net_profitability": ["Таза пайда маржасы"],
    },
    "Uzbek": {
        "total_long_term_assets": ["UZOQ MUDDATLI AKTIVLAR"],
        "inventories": ["Zaxiralar"],
        "accounts_receivable": ["Debitor qarzlar"],
        "cash": ["Naqd pul"],
        "short_term_investments": ["Qisqa muddatli investitsiyalar"],
        "total_short_term_assets": ["MUOMALA AKTIVLARI"],
        "retained_earnings": ["Bo'linmagan foyda"],
        "equity": ["ULUSH KAPITALI"],
        "long_term_debt": ["Uzun muddatli qarzlar"],
        "short_term_debt": ["Qisqa muddatli qarzlar"],
        "accounts_payable": ["Kreditor qarzlar"],
        "total_short_term_liabilities": ["JORIY MAJBURIYATLAR"],
        "total_assets": ["JAMI AKTIVLAR"],
        
        "revenue": ["Daromad"],
        "cost_of_goods_sold": ["Sotilgan mahsulotlar tannarxi"],
        "gross_financial_result": ["Umumiy foyda (zarar)"],
        "commercial_expanses": ["Savdo xarajatlari"],
        "administrative_expanses": ["Ma'muriy xarajatlar"],
        "operating_financial_result": ["Operatsion foyda (zarar)"],
        "interest_income": ["Foiz daromadi"],
        "interest_expenses": ["Foiz xarajatlari"],
        "other_operating_income": ["Boshqa operatsion daromad"],
        "other_operating_expanses": ["Boshqa operatsion xarajatlar"],
        "financial_result_before_tax": ["Soliqdan oldingi foyda (zarar)"],
        "income_tax": ["Daromad solig'i"],
        "net_financial_result": ["Sof foyda (zarar)"],
        
        "gross_margin": ["Umumiy foyda marjasi"],
        "EBIT_margin": ["EBIT marjasi"],
        "net_profitability": ["Sof foyda marjasi"],
    },
    "Mongolian": {
        "total_long_term_assets": ["УРТ ХУГАЦААНЫ ХӨРӨНГӨ"],
        "inventories": ["Бараа материал"],
        "accounts_receivable": ["Авлагын өр"],
        "cash": ["Мөнгөн хөрөнгө"],
        "short_term_investments": ["Богино хугацааны хөрөнгө оруулалт"],
        "total_short_term_assets": ["ЭРГЭЛТИЙН ХӨРӨНГӨ"],
        "retained_earnings": ["Хуримтлагдсан ашиг"],
        "equity": ["ӨӨРИЙН ХӨРӨНГӨ"],
        "long_term_debt": ["Урт хугацааны өр төлбөр"],
        "short_term_debt": ["Богино хугацааны өр төлбөр"],
        "accounts_payable": ["Өглөгийн өр"],
        "total_short_term_liabilities": ["БОГИНО ХУГАЦААНЫ ӨР ТӨЛБӨРҮҮД"],
        "total_assets": ["НИЙТ ХӨРӨНГӨ"],
        
        "revenue": ["Орлого"],
        "cost_of_goods_sold": ["Борлуулсан барааны өртөг"],
        "gross_financial_result": ["Нийт ашиг (алдагдал)"],
        "commercial_expanses": ["Борлуулалтын зардал"],
        "administrative_expanses": ["Удирдлагын зардал"],
        "operating_financial_result": ["Үйл ажиллагааны ашиг (алдагдал)"],
        "interest_income": ["Хүүгийн орлого"],
        "interest_expenses": ["Хүүгийн зардал"],
        "other_operating_income": ["Бусад үйл ажиллагааны орлого"],
        "other_operating_expanses": ["Бусад үйл ажиллагааны зардал"],
        "financial_result_before_tax": ["Татварын өмнөх ашиг (алдагдал)"],
        "income_tax": ["Орлогын татвар"],
        "net_financial_result": ["Цэвэр ашиг (алдагдал)"],
        
        "gross_margin": ["Нийт ашиг марж"],
        "EBIT_margin": ["EBIT марж"],
        "net_profitability": ["Цэвэр ашгийн марж"],
    },
}


def detect_language(text) -> str:
    # Определяем язык
    language = detect(text)
    return language

class Translate:
    def __init__(self, dict_with_data: dict, language: str) -> None:
        self.dict_with_data = dict_with_data
        self.aggregated_data_for_the_report = self.dict_with_data["aggregated_data_for_the_report"]
        self.language = language
    
    async def translate_and_aggregate_data(self) -> str:
        match self.language:
            case "English":
                static_content = {
                    "general_information_page": {
                        "title": "Risk  Report",
                        "subtitle": "General information",
                        "head_company_name": "Company name:",
                        "head_registration_date": "Registration date:",
                        "head_status": "Status:",
                        "head_owners": "Owners:",
                        "head_final_beneficiary": "Final Beneficiary:",  # Надо удалить из отчета
                        "head_line_of_business": "Line of business:",
                        "head_registration_codes": "Registration codes:",
                        "head_tax_identifier": "Tax identifier:",
                        "head_registration_identifier": "Registration Identifier:",
                        "head_address": "Address:",
                        "head_affiliated_active_companies": "Affiliated companies:",
                        "head_active": "Active:",
                        "head_ceased": "Liquidated/in reorganization process:",
                        # "head_requested_limit": "REQUESTED CREDIT LIMIT:",
                        "head_recomended_limit": "RECOMMENDED CREDIT LIMIT:",
                        "company": " - for the company",
                        "group": " - for the group (including guarantee)",
                        "head_COMBINED_credit_rating": "Group rating",
                        "head_credit_rating": "CREDIT RATING:",
                        "head_credit_rating_justification:": "CREDIT RATING JUSTIFICATION:",
                        "page": "Page",
                    },
                    "conclusion_paragraph_page": {
                        "title": "Risk  Report",
                        "subtitle": "Conclusion",
                        "reporting_period": "reporting period",
                        "page": "Page",
                    },
                    "conclusion_tables_page": {
                        "title": "Risk  Report",
                        "subtitle": "Conclusion(continued)",
                        
                        "head_1": "Largest companies of the Group in descending order:",
                        "head_2": "The following companies of the Group have the largest net profit:",
                        "head_3": "Major companies of the Group by gross debt:",
                        "head_4": "The following companies of the Group have the largest volume of long-term assets:",
                        
                        "table_1_column_1": "Company Name",
                        "table_1_column_2": "Registration Identifier",
                        "table_1_column_3": "Status",
                        "table_1_column_4": "Revenue in",
                        "table_1_column_5": "% of group Revenue",
                        
                        "table_2_column_1": "Company Name",
                        "table_2_column_2": "Registration Identifier",
                        "table_2_column_3": "Status",
                        "table_2_column_4": "Net Profit in",
                        "table_2_column_5": "% of group Net Profit",
                        
                        "table_3_column_1": "Company Name",
                        "table_3_column_2": "Registration Identifier",
                        "table_3_column_3": "Status",
                        "table_3_column_4": "Gross Debt in",
                        "table_3_column_5": "% of group Gross Debt",
                        
                        "table_4_column_1": "Company Name",
                        "table_4_column_2": "Registration Identifier",
                        "table_4_column_3": "Status",
                        "table_4_column_4": "LT Assets in",
                        "table_4_column_5": "% of group LT Assets",
                        "page": "Page",
                    },
                    "balance_sheet_tables_page": {
                        "title": "Risk  Report",
                        "subtitle": "Balance Sheet",
                        
                        "head_1": f"Balance Sheet of the Company as at the end of {self.aggregated_data_for_the_report['target_company_last_available_period']} and two previous reporting years were as follows:",
                        "head_2": f"COMBINED Balance Sheet of the Group as at the end of {self.aggregated_data_for_the_report['target_company_last_available_period']} and two previous reporting years were as follows:",
                        
                        "table_1_column_1": "Balance Sheet Items",
                        "table_1_column_3": "% of Total Assets",
                        "table_1_column_5": "% of Total Assets",
                        "table_1_column_7": "% of Total Assets",
                        
                        "table_2_column_1": "Balance Sheet Items",
                        "table_2_column_3": "% of Total Assets",
                        "table_2_column_5": "% of Total Assets",
                        "table_2_column_7": "% of Total Assets",
                        "page": "Page",
                    },
                    "balance_sheet_paragraph_page": {
                        "title": "Risk  Report",
                        "subtitle": "Balance Sheet(continued)",
                        "page": "Page",
                    },
                    "profit_loss_accounts_tables_page": {
                        "title": "Risk  Report",
                        "subtitle": "PROFIT & LOSS ACCOUNTS:",
                        
                        "head_1": f"Profit & Loss Accounts of the Company for {self.aggregated_data_for_the_report['target_company_last_available_period']} and two previous reporting years were as follows:",
                        "head_2": f"COMBINED Profit & Loss Accounts of the Group for {self.aggregated_data_for_the_report['target_company_last_available_period']} and two previous reporting years were as follows:",
                        
                        "table_1_column_1": "P&L Items",
                        "table_1_column_3": "% of Total Revenue",
                        "table_1_column_5": "% of Total Revenue",
                        "table_1_column_7": "% of Total Revenue",
                        
                        "table_2_column_1": "P&L Items",
                        "table_2_column_3": "% of Total Revenue",
                        "table_2_column_5": "% of Total Revenue",
                        "table_2_column_7": "% of Total Revenue",
                        "page": "Page",
                    },                    
                    "profit_loss_accounts_paragraph_page": {
                        "title": "Risk  Report",
                        "subtitle": "PROFIT & LOSS ACCOUNTS(continued):",
                        "page": "Page",
                    },
                    "financial_ratios_tables_page": {
                        "title": "Risk  Report",
                        "subtitle": "Financial Ratios:",
                        
                        "head_1": "Profitability ratios",
                        "head_2": "Liquidity ratios",
                        "head_3": "Turnover ratios",
                        
                        "head_4": "Profitability ratios (COMBINED):",
                        "head_5": "Liquidity ratios (COMBINED):",
                        "head_6": "Turnover ratios (COMBINED):",
                        
                        "table_1_column_1": "Ratios",
                        "table_1_column_4": "% change",
                        "table_1_column_6": "% change",
                        
                        "table_2_column_1": "Ratios",
                        "table_2_column_4": "% change",
                        "table_2_column_6": "% change",
                        
                        "table_3_column_1": "Ratios",
                        "table_3_column_2": "(days)",
                        "table_3_column_3": "(days)",
                        "table_3_column_4": "% change",
                        "table_3_column_5": "(days)",
                        "table_3_column_6": "% change",
                        
                        "table_4_column_1": "Ratios",
                        "table_4_column_4": "% change",
                        "table_4_column_6": "% change",
                        
                        "table_5_column_1": "Ratios",
                        "table_5_column_4": "% change",
                        "table_5_column_6": "% change",
                        
                        "table_6_column_1": "Ratios",
                        "table_6_column_2": "(days)",
                        "table_6_column_3": "(days)",
                        "table_6_column_4": "% change",
                        "table_6_column_5": "(days)",
                        "table_6_column_6": "% change",
                        "page": "Page",
                    },
                    "dynamic_graphs_page": {
                        "title": "Risk  Report",
                        "subtitle": "Dynamic Graphs",
                        
                        "metric": "Metric:",
                        "periods": "Periods",
                        "values": "Values",
                        
                        "profitability_graph_title": "Profitability ratios:",
                        # "accounts_payable": "accounts payable",
                        # "accounts_receivable": "accounts receivable",
                        "net_financial_result": "net profit/loss",
                        "EBIT": "EBIT",
                        "revenue": "revenue",
                        
                        "turnover_graph_title": "Turnover ratios:",
                        "DSO": "DSO",
                        "DPO": "DPO",
                        "DIO": "DIO",
                        
                        "legend_profitability": """
                        <span class="content" style="font-size: 7px">Net Profit/Loss — The net financial result (profit/loss) after all income and expenses.</span><br>
                        <span class="content" style="font-size: 7px">EBIT — Operating profit before interest and taxes. Shows the profitability of core business activities.</span><br>
                        <span class="content" style="font-size: 7px">Revenue — Revenue (sales volume) excluding costs.</span>
                        """,
                        "legend_turnover": """
                        <span class="content" style="font-size: 7px">DSO (Days Sales Outstanding) — Average accounts receivable collection period (in days). Reflects the efficiency of working with customers.</span><br>
                        <span class="content" style="font-size: 7px">DPO (Days Payable Outstanding) — Average accounts payable payment period (in days). Shows how a company manages its obligations to suppliers.</span><br>
                        <span class="content" style="font-size: 7px">DIO (Days Inventory Outstanding) — Average inventory holding period (in days). Characterizes inventory turnover.</span>
                        """,
                        
                        "page": "Page",
                    },
                    "financial_ratios_paragraph_page": {
                        "title": "Risk  Report",
                        "subtitle": "Financial Ratios(continued):",
                        "page": "Page",
                    },
                    "court_cases_page": {
                        "title": "Arbitration Cases",
                        "subtitle": "",
                        "table_name_sum": "Arbitration Case Amounts",
                        "table_name_count": "Arbitration Case Counts",
                        "str_company_name": "Company Name",
                        "str_registration_identifier": "Registration Identifier",
                        "str_defendant": "Defendant",
                        "str_plaintiff": "Plaintiff",
                        "page": "Page",
                    },
                    "group_structure_page": {
                        "title": "Risk  Report",
                        "subtitle": "GROUP STRUCTURE (MAJOR COMPANIES)",
                        
                        "table_1_column_1": "Company Name",
                        "table_1_column_2": "Registration Identifier",
                        "table_1_column_3": "Status",
                        "table_1_column_4": "Line of business",
                        "table_1_column_5": "% of Group Revenue",
                        "table_1_column_6": "Net Profit",
                        "table_1_column_7": "% of Group Total Assets",
                        "table_1_column_8": "% of Group Equity",
                        "table_1_column_9": "% of Group Gross Debt",
                        "page": "Page",
                    },
                }
            case "Russian":
                static_content = {
                    "general_information_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "Основная информация",
                        "head_company_name": "Название компании:",
                        "head_registration_date": "Дата регистрации:",
                        "head_status": "Статус:",
                        "head_owners": "Владельцы:",
                        "head_final_beneficiary": "Бенефициары:",  # Надо удалить из отчета
                        "head_line_of_business": "Вид деятельности:",
                        "head_registration_codes": "Регистрационные коды:",
                        "head_tax_identifier": "Налоговый номер:",
                        "head_registration_identifier": "Регистрационный номер:",
                        "head_address": "Адрес:",
                        "head_affiliated_active_companies": "Аффилированные компании:",
                        "head_active": "Активные:",
                        "head_ceased": "Ликвидированные/в процессе реорганизации:",
                        # "head_requested_limit": "ЗАПРАШИВАЕМЫЙ КРЕДИТНЫЙ ЛИМИТ:",
                        "head_recomended_limit": "РЕКОМЕНДУЕМЫЙ КРЕДИТНЫЙ ЛИМИТ:",
                        "company": " - на компанию",
                        "group": " - на группу (с учетом поручительства)",
                        "head_COMBINED_credit_rating": "Рейтинг группы",
                        "head_credit_rating": "КРЕДИТНЫЙ РЕЙТИНГ:",
                        "head_credit_rating_justification:": "ОБОСНОВАНИЕ КРЕДИТНОГО РЕЙТИНГА:",
                        "page": "Страница",
                    },
                    "conclusion_paragraph_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "ЗАКЛЮЧЕНИЕ:",
                        "reporting_period": "отчетный период",
                        "page": "Страница",
                    },
                    "conclusion_tables_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "ЗАКЛЮЧЕНИЕ (ПРОДОЛЖЕНИЕ):",
                        
                        "head_1": "Крупнейшие компании группы в порядке убывания:",
                        "head_2": "Следующие компании группы имеют наибольшую чистую прибыль:",
                        "head_3": "Основные компании группы по валовому долгу:",
                        "head_4": "Следующие компании группы имеют наибольшие объемы долгосрочных активов:",
                        
                        "table_1_column_1": "Название компании",
                        "table_1_column_2": "Регистрационный идентификатор",
                        "table_1_column_3": "Статус",
                        "table_1_column_4": "Выручка в",
                        "table_1_column_5": "% от выручки группы",
                        
                        "table_2_column_1": "Название компании",
                        "table_2_column_2": "Регистрационный идентификатор",
                        "table_2_column_3": "Статус",
                        "table_2_column_4": "Чистая прибыль в",
                        "table_2_column_5": "% от чистой прибыли группы",
                        
                        "table_3_column_1": "Название компании",
                        "table_3_column_2": "Регистрационный идентификатор",
                        "table_3_column_3": "Статус",
                        "table_3_column_4": "Валовой долг в",
                        "table_3_column_5": "% от валового долга группы",
                        
                        "table_4_column_1": "Название компании",
                        "table_4_column_2": "Регистрационный идентификатор",
                        "table_4_column_3": "Статус",
                        "table_4_column_4": "Долгосрочные активы в",
                        "table_4_column_5": "% от долгосрочных активов группы",
                        "page": "Страница",
                    },
                    "balance_sheet_tables_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "БАЛАНС:",
                        
                        "head_1": f"Баланс компании на конец {self.aggregated_data_for_the_report['target_company_last_available_period']} и два предыдущих отчетных года выглядит следующим образом:",
                        "head_2": f"СВОДНЫЙ баланс группы на конец {self.aggregated_data_for_the_report['target_company_last_available_period']} и два предыдущих отчетных года выглядит следующим образом:",
                        
                        "table_1_column_1": "Статьи баланса",
                        "table_1_column_3": "% от общего объема активов",
                        "table_1_column_5": "% от общего объема активов",
                        "table_1_column_7": "% от общего объема активов",
                        
                        "table_2_column_1": "Статьи баланса",
                        "table_2_column_3": "% от общего объема активов",
                        "table_2_column_5": "% от общего объема активов",
                        "table_2_column_7": "% от общего объема активов",
                        "page": "Страница",
                    },
                    "balance_sheet_paragraph_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "БАЛАНС (ПРОДОЛЖЕНИЕ):",
                        "page": "Страница",
                    },
                    "profit_loss_accounts_tables_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "ОТЧЕТ О ПРИБЫЛЯХ И УБЫТКАХ:",
                        
                        "head_1": f"Отчет о прибылях и убытках компании за {self.aggregated_data_for_the_report['target_company_last_available_period']} и два предыдущих отчетных года выглядит следующим образом:",
                        "head_2": f"СВОДНЫЙ отчет о прибылях и убытках группы за {self.aggregated_data_for_the_report['target_company_last_available_period']} и два предыдущих отчетных года выглядит следующим образом:",
                        
                        "table_1_column_1": "Статьи отчета о прибыли",
                        "table_1_column_3": "% от общего объема выручки",
                        "table_1_column_5": "% от общего объема выручки",
                        "table_1_column_7": "% от общего объема выручки",
                        
                        "table_2_column_1": "Статьи отчета о прибыли",
                        "table_2_column_3": "% от общего объема выручки",
                        "table_2_column_5": "% от общего объема выручки",
                        "table_2_column_7": "% от общего объема выручки",
                        "page": "Страница",
                    },
                    "profit_loss_accounts_paragraph_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "ОТЧЕТ О ПРИБЫЛЯХ И УБЫТКАХ (ПРОДОЛЖЕНИЕ):",
                        "page": "Страница",
                    },
                    "financial_ratios_tables_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "Финансовые коэффициенты:",
                        
                        "head_1": "Коэффициенты рентабельности",
                        "head_2": "Коэффициенты ликвидности",
                        "head_3": "Коэффициенты оборачиваемости",
                        
                        "head_4": "Коэффициенты рентабельности (СВОДНЫЕ):",
                        "head_5": "Коэффициенты ликвидности (СВОДНЫЕ):",
                        "head_6": "Коэффициенты оборачиваемости (СВОДНЫЕ):",
                        
                        "table_1_column_1": "Коэффициенты",
                        "table_1_column_4": "% изменения",
                        "table_1_column_6": "% изменения",
                        
                        "table_2_column_1": "Коэффициенты",
                        "table_2_column_4": "% изменения",
                        "table_2_column_6": "% изменения",
                        
                        "table_3_column_1": "Коэффициенты",
                        "table_3_column_2": "(дней)",
                        "table_3_column_3": "(дней)",
                        "table_3_column_4": "% изменения",
                        "table_3_column_5": "(дней)",
                        "table_3_column_6": "% изменения",
                        
                        "table_4_column_1": "Коэффициенты",
                        "table_4_column_4": "% изменения",
                        "table_4_column_6": "% изменения",
                        
                        "table_5_column_1": "Коэффициенты",
                        "table_5_column_4": "% изменения",
                        "table_5_column_6": "% изменения",
                        
                        "table_6_column_1": "Коэффициенты",
                        "table_6_column_2": "(дней)",
                        "table_6_column_3": "(дней)",
                        "table_6_column_4": "% изменения",
                        "table_6_column_5": "(дней)",
                        "table_6_column_6": "% изменения",
                        "page": "Страница",
                    },
                    "dynamic_graphs_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "Финансовые показатели",
                        
                        "metric": "Метрика:",
                        "periods": "Периоды",
                        "values": "Значения",
                        
                        "profitability_graph_title": "Коэффициенты рентабильности:",
                        # "accounts_payable": "кредиторская задолженность",
                        # "accounts_receivable": "дебиторская задолженность",
                        "net_financial_result": "чистая прибыль/убыток",
                        "EBIT": "EBIT",
                        "revenue": "выручка",
                        
                        "turnover_graph_title": "Коэффициенты оборачиваемости:",
                        "DSO": "DSO",
                        "DPO": "DPO",
                        "DIO": "DIO",
                        
                        "legend_profitability": """
                        <span class="content" style="font-size: 7px">Чистая прибыль/убыток — Чистый финансовый результат (прибыль/убыток) после всех доходов и расходов.</span><br>
                        <span class="content" style="font-size: 7px">EBIT — Операционная прибыль до вычета процентов и налогов. Показывает рентабельность основной деятельности.</span><br>
                        <span class="content" style="font-size: 7px">Выручка — Выручка (объем продаж) без учета затрат.</span>
                        """,
                        "legend_turnover": """
                        <span class="content" style="font-size: 7px">DSO (Days Sales Outstanding) — Средний срок погашения дебиторской задолженности (в днях). Отражает эффективность работы с клиентами.</span><br>
                        <span class="content" style="font-size: 7px">DPO (Days Payable Outstanding) — Средний срок оплаты кредиторской задолженности (в днях). Показывает, как компания управляет обязательствами перед поставщиками.</span><br>
                        <span class="content" style="font-size: 7px">DIO (Days Inventory Outstanding) — Средний срок хранения запасов (в днях). Характеризует оборачиваемость товарных запасов.</span>
                        """,
                        
                        "page": "Страница",
                    },
                    "financial_ratios_paragraph_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "ФИНАНСОВЫЕ КОЭФФИЦИЕНТЫ (ПРОДОЛЖЕНИЕ):",
                        "page": "Страница",
                    },
                    "court_cases_page": {
                        "title": "Арбитражные дела",
                        "subtitle": "",
                        "table_name_sum": "Суммы по арбитражным делам",
                        "table_name_count": "Количества арбитражных дел",
                        "str_company_name": "Название компании",
                        "str_registration_identifier": "Идентификатор",
                        "str_defendant": "Ответчик",
                        "str_plaintiff": "Истец",
                        "page": "Страница",
                    },
                    "group_structure_page": {
                        "title": "Анализ кредитоспособности",
                        "subtitle": "СТРУКТУРА ГРУППЫ (КРУПНЫЕ КОМПАНИИ)",
                        
                        "table_1_column_1": "Название компании",
                        "table_1_column_2": "Регистрационный идентификатор",
                        "table_1_column_3": "Статус",
                        "table_1_column_4": "Вид деятельности",
                        "table_1_column_5": "% от выручки группы",
                        "table_1_column_6": "Чистая прибыль",
                        "table_1_column_7": "% от общих активов группы",
                        "table_1_column_8": "% от капитала группы",
                        "table_1_column_9": "% от валового долга группы",
                        "page": "Страница",
                    },
                }
            case "Kazakh":
                static_content = {
                    "general_information_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Жалпы ақпарат",
                        "head_company_name": "Компанияның атауы:",
                        "head_registration_date": "Тіркеу күні:",
                        "head_status": "Мәртебесі:",
                        "head_owners": "Иелері:",
                        "head_final_beneficiary": "",  # Есептен жойылған
                        "head_line_of_business": "Қызмет түрі:",
                        "head_registration_codes": "Тіркеу кодтары:",
                        "head_tax_identifier": "Салық идентификаторы:",
                        "head_registration_identifier": "Тіркеу идентификаторы:",
                        "head_address": "Мекен-жайы:",
                        "head_affiliated_active_companies": "Өзара байланысты компаниялар:",
                        "head_active": "Белсенді:",
                        "head_ceased": "Жойылған/қайта ұйымдастыру процесінде:",
                        # "head_requested_limit": "СҰРАЛҒАН НЕСИЕ ЛИМИТІ:",
                        "head_recomended_limit": "ҰСЫНЫЛҒАН НЕСИЕ ЛИМИТІ:",
                        "company": " - компания үшін",
                        "group": " - топ үшін (кепілдік есебінен)",
                        "head_COMBINED_credit_rating": "Топтық рейтинг",
                        "head_credit_rating": "НЕСИЕ РЕЙТИНГІ:",
                        "head_credit_rating_justification:": "НЕСИЕ РЕЙТИНГІНІҢ НЕГІЗДЕМЕСІ:",
                        "page": "Бет",
                    },
                    "conclusion_paragraph_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Қорытынды",
                        "reporting_period": "есепті кезең",
                        "page": "Бет",
                    },
                    "conclusion_tables_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Қорытынды (жалғасы)",
                        
                        "head_1": "Топтағы ең ірі компаниялар, төмендеу ретімен:",
                        "head_2": "Топтағы келесі компаниялардың ең үлкен таза пайдасы бар:",
                        "head_3": "Топтағы негізгі компаниялар жалпы қарыз бойынша:",
                        "head_4": "Топтағы келесі компаниялардың ең үлкен ұзақ мерзімді активтері бар:",
                        
                        "table_1_column_1": "Компанияның атауы",
                        "table_1_column_2": "Тіркеу идентификаторы",
                        "table_1_column_3": "Мәртебесі",
                        "table_1_column_4": "Табыс сомасы",
                        "table_1_column_5": "Топ табысының % үлесі",
                        
                        "table_2_column_1": "Компанияның атауы",
                        "table_2_column_2": "Тіркеу идентификаторы",
                        "table_2_column_3": "Мәртебесі",
                        "table_2_column_4": "Таза пайда сомасы",
                        "table_2_column_5": "Топтың таза пайдасының % үлесі",
                        
                        "table_3_column_1": "Компанияның атауы",
                        "table_3_column_2": "Тіркеу идентификаторы",
                        "table_3_column_3": "Мәртебесі",
                        "table_3_column_4": "Жалпы қарыз сомасы",
                        "table_3_column_5": "Топтың жалпы қарызының % үлесі",
                        
                        "table_4_column_1": "Компанияның атауы",
                        "table_4_column_2": "Тіркеу идентификаторы",
                        "table_4_column_3": "Мәртебесі",
                        "table_4_column_4": "Ұзақ мерзімді активтер сомасы",
                        "table_4_column_5": "Топтың ұзақ мерзімді активтерінің % үлесі",
                        "page": "Бет",
                    },
                    "balance_sheet_tables_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Баланс",
                        
                        "head_1": f"Компанияның балансы {self.aggregated_data_for_the_report['target_company_last_available_period']} кезеңінің соңында және екі алдыңғы есепті жылдар үшін келесідей:",
                        "head_2": f"Топтың СВОДНЫЙ балансы {self.aggregated_data_for_the_report['target_company_last_available_period']} кезеңінің соңында және екі алдыңғы есепті жылдар үшін келесідей:",
                        
                        "table_1_column_1": "Баланс баптары",
                        "table_1_column_3": "Жалпы активтердің % үлесі",
                        "table_1_column_5": "Жалпы активтердің % үлесі",
                        "table_1_column_7": "Жалпы активтердің % үлесі",
                        
                        "table_2_column_1": "Баланс баптары",
                        "table_2_column_3": "Жалпы активтердің % үлесі",
                        "table_2_column_5": "Жалпы активтердің % үлесі",
                        "table_2_column_7": "Жалпы активтердің % үлесі",
                        "page": "Бет",
                    },
                    "balance_sheet_paragraph_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Баланс (жалғасы)",
                        "page": "Бет",
                    },
                    "profit_loss_accounts_tables_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "ТАБЫСТАР МЕН ШЫҒЫНДАР ЕСЕБІ:",
                        
                        "head_1": f"Компанияның табыстар мен шығындар есебі {self.aggregated_data_for_the_report['target_company_last_available_period']} кезеңі және екі алдыңғы есепті жылдар үшін келесідей:",
                        "head_2": f"Топтың СВОДНЫЙ табыстар мен шығындар есебі {self.aggregated_data_for_the_report['target_company_last_available_period']} кезеңі және екі алдыңғы есепті жылдар үшін келесідей:",
                        
                        "table_1_column_1": "Табыстар мен шығындар баптары",
                        "table_1_column_3": "Жалпы табыстан %",
                        "table_1_column_5": "Жалпы табыстан %",
                        "table_1_column_7": "Жалпы табыстан %",
                        
                        "table_2_column_1": "Табыстар мен шығындар баптары",
                        "table_2_column_3": "Жалпы табыстан %",
                        "table_2_column_5": "Жалпы табыстан %",
                        "table_2_column_7": "Жалпы табыстан %",
                        "page": "Бет",
                    },
                    "profit_loss_accounts_paragraph_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "ТАБЫСТАР МЕН ШЫҒЫНДАР ЕСЕБІ (жалғасы):",
                        "page": "Бет",
                    },
                    "financial_ratios_tables_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Қаржылық коэффициенттер:",
                        
                        "head_1": "Рентабельділік коэффициенттері",
                        "head_2": "Өтімділік коэффициенттері",
                        "head_3": "Айналым коэффициенттері",
                        
                        "head_4": "Рентабельділік коэффициенттері (СВОДНЫЕ):",
                        "head_5": "Өтімділік коэффициенттері (СВОДНЫЕ):",
                        "head_6": "Айналым коэффициенттері (СВОДНЫЕ):",
                        
                        "table_1_column_1": "Коэффициенттер",
                        "table_1_column_4": "% өзгеріс",
                        "table_1_column_6": "% өзгеріс",
                        
                        "table_2_column_1": "Коэффициенттер",
                        "table_2_column_4": "% өзгеріс",
                        "table_2_column_6": "% өзгеріс",
                        
                        "table_3_column_1": "Коэффициенттер",
                        "table_3_column_2": "(күндер)",
                        "table_3_column_3": "(күндер)",
                        "table_3_column_4": "% өзгеріс",
                        "table_3_column_5": "(күндер)",
                        "table_3_column_6": "% өзгеріс",
                        
                        "table_4_column_1": "Коэффициенттер",
                        "table_4_column_4": "% өзгеріс",
                        "table_4_column_6": "% өзгеріс",
                        
                        "table_5_column_1": "Коэффициенттер",
                        "table_5_column_4": "% өзгеріс",
                        "table_5_column_6": "% өзгеріс",
                        
                        "table_6_column_1": "Коэффициенттер",
                        "table_6_column_2": "(күндер)",
                        "table_6_column_3": "(күндер)",
                        "table_6_column_4": "% өзгеріс",
                        "table_6_column_5": "(күндер)",
                        "table_6_column_6": "% өзгеріс",
                        "page": "Бет",
                    },
                    "dynamic_graphs_page": {
                        "title": "Тәуекелдер туралы есеп",
                        "subtitle": "Динамикалық графиктер",
                        
                        "metric": "Метрка:",
                        "periods": "Уақыттар",
                        "values": "Құндар",
                        
                        "profitability_graph_title": "Пайдалылық коэффициенттері:",
                        # "accounts_payable": "кредиторлық қарыз",
                        # "accounts_receivable": "дебиторлық қарыз",
                        "net_financial_result": "таза пайда/зиян",
                        "EBIT": "EBIT",
                        "revenue": "табыс",
                        
                        "turnover_graph_title": "Айналым коэффициенттері:",
                        "DSO": "DSO",
                        "DPO": "DPO",
                        "DIO": "DIO",
                        
                        "legend_profitability": """
                        <span class="content" style="font-size: 7px">Таза пайда/зиян — Барлық кірістер мен шығыстардың қорытындысы (пайда/зиян).</span><br>
                        <span class="content" style="font-size: 7px">EBIT — Пайыздар мен салықтарды шегермегендегі операциялық пайда. Негізгі қызметтің табыстылығын көрсетеді.</span><br>
                        <span class="content" style="font-size: 7px">Табыс — Шығындарсыз сатылым көлемі (табыс).</span>
                        """,
                        "legend_turnover": """
                        <span class="content" style="font-size: 7px">DSO (Days Sales Outstanding) — Дебиторлық берешекті өтеудің орташа мерзімі (күнмен). Клиенттермен жұмыс тиімділігін көрсетеді.</span><br>
                        <span class="content" style="font-size: 7px">DPO (Days Payable Outstanding) — Кредиторлық берешекті өтеудің орташа мерзімі (күнмен). Компанияның жеткізушілерге қаржылық міндеттемелерін басқаруын көрсетеді.</span><br>
                        <span class="content" style="font-size: 7px">DIO (Days Inventory Outstanding) — Қорларды сақтаудың орташа мерзімі (күнмен). Тауар айналымын сипаттайды.</span>
                        """,
                        
                        "page": "Бет",
                    },
                    "financial_ratios_paragraph_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "Қаржылық коэффициенттер (жалғасы):",
                        "page": "Бет",
                    },
                    "court_cases_page": {
                        "title": "Арбитраждық істер",
                        "subtitle": "",
                        "table_name_sum": "Арбитраждық істер бойынша сомалар",
                        "table_name_count": "Арбитраждық істер саны",
                        "str_company_name": "Компания атауы",
                        "str_registration_identifier": "Тіркеу идентификаторы",
                        "str_defendant": "Жауапкер",
                        "str_plaintiff": "Тарыпшы",
                        "page": "Бет",
                    },
                    "group_structure_page": {
                        "title": "Қауіп-қатер туралы есеп",
                        "subtitle": "ТОП ҚҰРЫЛЫМЫ (НЕГІЗГІ КОМПАНИЯЛАР)",
                        
                        "table_1_column_1": "Компанияның атауы",
                        "table_1_column_2": "Тіркеу идентификаторы",
                        "table_1_column_3": "Мәртебесі",
                        "table_1_column_4": "Қызмет түрі",
                        "table_1_column_5": "Топ табысының % үлесі",
                        "table_1_column_6": "Таза пайда",
                        "table_1_column_7": "Топтың жалпы активтерінің % үлесі",
                        "table_1_column_8": "Топ капиталының % үлесі",
                        "table_1_column_9": "Топтың жалпы қарызының % үлесі",
                        "page": "Бет",
                    },
                }
            case "Uzbek":
                static_content = {
                    "general_information_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Umumiy ma'lumot",
                        "head_company_name": "Kompaniya nomi:",
                        "head_registration_date": "Ro'yxatga olish sanasi:",
                        "head_status": "Holati:",
                        "head_owners": "Egalari:",
                        "head_final_beneficiary": "",  # Hisobotdan o'chirilgan
                        "head_line_of_business": "Faoliyat yo'nalishi:",
                        "head_registration_codes": "Ro'yxatga olish kodlari:",
                        "head_tax_identifier": "Soliq identifikatori:",
                        "head_registration_identifier": "Ro'yxatga olish identifikatori:",
                        "head_address": "Manzil:",
                        "head_affiliated_active_companies": "Filial kompaniyalar:",
                        "head_active": "Faol:",
                        "head_ceased": "Tugatilgan/qayta tashkil etish jarayonida:",
                        # "head_requested_limit": "SO'RALGAN KREDIT LIMIТI:",
                        "head_recomended_limit": "TAVSIYA ETILGAN KREDIT LIMITI:",
                        "company": " - kompaniya uchun",
                        "group": " - guruh uchun (kafillik hisobiga)",
                        "head_COMBINED_credit_rating": "Guruh reytingi",
                        "head_credit_rating": "KREDIT REYTINGI:",
                        "head_credit_rating_justification:": "KREDIT REYTINGINING ASOSI:",
                        "page": "Sahifa",
                    },
                    "conclusion_paragraph_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Xulosa",
                        "reporting_period": "hisobot davri",
                        "page": "Sahifa",
                    },
                    "conclusion_tables_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Xulosa (davomi)",
                        
                        "head_1": "Guruhdagi eng yirik kompaniyalar kamayish tartibida:",
                        "head_2": "Guruhdagi quyidagi kompaniyalar eng katta sof foydaga ega:",
                        "head_3": "Guruhdagi asosiy kompaniyalar yalpi qarz bo'yicha:",
                        "head_4": "Guruhdagi quyidagi kompaniyalar eng katta uzoq muddatli aktivlarga ega:",
                        
                        "table_1_column_1": "Kompaniya nomi",
                        "table_1_column_2": "Ro'yxatga olish identifikatori",
                        "table_1_column_3": "Holati",
                        "table_1_column_4": "Daromad summasi",
                        "table_1_column_5": "Guruh daromadining % ulushi",
                        
                        "table_2_column_1": "Kompaniya nomi",
                        "table_2_column_2": "Ro'yxatga olish identifikatori",
                        "table_2_column_3": "Holati",
                        "table_2_column_4": "Sof foyda summasi",
                        "table_2_column_5": "Guruhning sof foydasining % ulushi",
                        
                        "table_3_column_1": "Kompaniya nomi",
                        "table_3_column_2": "Ro'yxatga olish identifikatori",
                        "table_3_column_3": "Holati",
                        "table_3_column_4": "Yalpi qarz summasi",
                        "table_3_column_5": "Guruhning yalpi qarzining % ulushi",
                        
                        "table_4_column_1": "Kompaniya nomi",
                        "table_4_column_2": "Ro'yxatga olish identifikatori",
                        "table_4_column_3": "Holati",
                        "table_4_column_4": "Uzoq muddatli aktivlar summasi",
                        "table_4_column_5": "Guruhning uzoq muddatli aktivlarining % ulushi",
                        "page": "Sahifa",
                    },
                    "balance_sheet_tables_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Balans",
                        
                        "head_1": f"Kompaniyaning balans hisobi {self.aggregated_data_for_the_report['target_company_last_available_period']} davrining oxirida va ikki oldingi hisobot yilidagi holati quyidagicha:",
                        "head_2": f"Guruhning BIRLASHGAN balans hisobi {self.aggregated_data_for_the_report['target_company_last_available_period']} davrining oxirida va ikki oldingi hisobot yilidagi holati quyidagicha:",
                        
                        "table_1_column_1": "Balans elementlari",
                        "table_1_column_3": "Umumiy aktivlarning % ulushi",
                        "table_1_column_5": "Umumiy aktivlarning % ulushi",
                        "table_1_column_7": "Umumiy aktivlarning % ulushi",
                        
                        "table_2_column_1": "Balans elementlari",
                        "table_2_column_3": "Umumiy aktivlarning % ulushi",
                        "table_2_column_5": "Umumiy aktivlarning % ulushi",
                        "table_2_column_7": "Umumiy aktivlarning % ulushi",
                        "page": "Sahifa",
                    },
                    "balance_sheet_paragraph_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Balans (davomi)",
                        "page": "Sahifa",
                    },
                    "profit_loss_accounts_tables_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "FOYDA VA ZARAR HISOBI:",
                        
                        "head_1": f"Kompaniyaning foyda va zarar hisobi {self.aggregated_data_for_the_report['target_company_last_available_period']} davri va ikki oldingi hisobot yili uchun quyidagicha:",
                        "head_2": f"Guruhning BIRLASHGAN foyda va zarar hisobi {self.aggregated_data_for_the_report['target_company_last_available_period']} davri va ikki oldingi hisobot yili uchun quyidagicha:",
                        
                        "table_1_column_1": "Foyda va zarar elementlari",
                        "table_1_column_3": "Umumiy daromaddan %",
                        "table_1_column_5": "Umumiy daromaddan %",
                        "table_1_column_7": "Umumiy daromaddan %",
                        
                        "table_2_column_1": "Foyda va zarar elementlari",
                        "table_2_column_3": "Umumiy daromaddan %",
                        "table_2_column_5": "Umumiy daromaddan %",
                        "table_2_column_7": "Umumiy daromaddan %",
                        "page": "Sahifa",
                    },
                    "profit_loss_accounts_paragraph_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "FOYDA VA ZARAR HISOBI (davomi):",
                        "page": "Sahifa",
                    },
                    "financial_ratios_tables_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Moliyaviy koeffitsientlar:",
                        
                        "head_1": "Rentabellik koeffitsientlari",
                        "head_2": "Likvidlik koeffitsientlari",
                        "head_3": "Aylanma koeffitsientlari",
                        
                        "head_4": "Rentabellik koeffitsientlari (BIRLASHGAN):",
                        "head_5": "Likvidlik koeffitsientlari (BIRLASHGAN):",
                        "head_6": "Aylanma koeffitsientlari (BIRLASHGAN):",
                        
                        "table_1_column_1": "Koeffitsientlar",
                        "table_1_column_4": "% o'zgarish",
                        "table_1_column_6": "% o'zgarish",
                        
                        "table_2_column_1": "Koeffitsientlar",
                        "table_2_column_4": "% o'zgarish",
                        "table_2_column_6": "% o'zgarish",
                        
                        "table_3_column_1": "Koeffitsientlar",
                        "table_3_column_2": "(kunlar)",
                        "table_3_column_3": "(kunlar)",
                        "table_3_column_4": "% o'zgarish",
                        "table_3_column_5": "(kunlar)",
                        "table_3_column_6": "% o'zgarish",
                        
                        "table_4_column_1": "Koeffitsientlar",
                        "table_4_column_4": "% o'zgarish",
                        "table_4_column_6": "% o'zgarish",
                        
                        "table_5_column_1": "Koeffitsientlar",
                        "table_5_column_4": "% o'zgarish",
                        "table_5_column_6": "% o'zgarish",
                        
                        "table_6_column_1": "Koeffitsientlar",
                        "table_6_column_2": "(kunlar)",
                        "table_6_column_3": "(kunlar)",
                        "table_6_column_4": "% o'zgarish",
                        "table_6_column_5": "(kunlar)",
                        "table_6_column_6": "% o'zgarish",
                        "page": "Sahifa",
                    },
                    "dynamic_graphs_page": {
                        "title": "Xavf to'g'risidagi hisobot",
                        "subtitle": "Dinamik grafiklar",
                        
                        "metric": "Metrika:",
                        "periods": "Davrlar",
                        "values": "Qiymatlar",
                        
                        "profitability_graph_title": "Daromad koeffitsiyentlari:",
                        # "accounts_payable": "kredit qismi",
                        # "accounts_receivable": "qarzdorlik",
                        "net_financial_result": "sof foyda/zarar",
                        "EBIT": "EBIT",
                        "revenue": "daromad",
                        
                        "turnover_graph_title": "Aylanish koeffitsiyentlari:",
                        "DSO": "DSO",
                        "DPO": "DPO",
                        "DIO": "DIO",
                        
                        "legend_profitability": """
                        <span class="content" style="font-size: 7px">Sof foyda/zarar — Barcha daromadlar va xarajatlardan keyingi moliyaviy natija (foyda/zarar).</span><br>
                        <span class="content" style="font-size: 7px">EBIT — Foizlar va soliqlarni hisobga olmagan holda operatsion foyda. Asosiy faoliyat rentabelligini ko'rsatadi.</span><br>
                        <span class="content" style="font-size: 7px">Daromad — Xarajatlarsiz savdo hajmi (daromad).</span>
                        """,
                        "legend_turnover": """
                        <span class="content" style="font-size: 7px">DSO (Days Sales Outstanding) — Debitor qarzlarini o'rtacha to'lash muddati (kunlarda). Mijozlar bilan ishlash samaradorligini aks ettiradi.</span><br>
                        <span class="content" style="font-size: 7px">DPO (Days Payable Outstanding) — Kreditor qarzlarini o'rtacha to'lash muddati (kunlarda). Kompaniyaning yetkazib beruvchilarga bo'lgan majburiyatlarini boshqarishini ko'rsatadi.</span><br>
                        <span class="content" style="font-size: 7px">DIO (Days Inventory Outstanding) — Tovarlarni saqlashning o'rtacha muddati (kunlarda). Tovar aylanmasini tavsiflaydi.</span>
                        """,
                        
                        "page": "Sahifa",
                    },
                    "financial_ratios_paragraph_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "Moliyaviy koeffitsientlar (davomi):",
                        "page": "Sahifa",
                    },
                    "court_cases_page": {
                        "title": "Arbitraj ishlari",
                        "subtitle": "",
                        "table_name_sum": "Arbitraj ishlari boʻyicha summalar",
                        "table_name_count": "Arbitraj ishlari soni",
                        "str_company_name": "Kompaniya nomi",
                        "str_registration_identifier": "Roʻyxat identifikatori",
                        "str_defendant": "Javobgar",
                        "str_plaintiff": "Daʼvogar",
                        "page": "Sahifa",
                    },
                    "group_structure_page": {
                        "title": "Kredit hisoboti",
                        "subtitle": "GURUH TUZILMASI (ASOSIY KOMPANIYALAR)",
                        
                        "table_1_column_1": "Kompaniya nomi",
                        "table_1_column_2": "Ro'yxatga olish identifikatori",
                        "table_1_column_3": "Holati",
                        "table_1_column_4": "Faoliyat yo'nalishi",
                        "table_1_column_5": "Guruh daromadining % ulushi",
                        "table_1_column_6": "Sof foyda",
                        "table_1_column_7": "Guruhning umumiy aktivlarining % ulushi",
                        "table_1_column_8": "Guruh kapitalining % ulushi",
                        "table_1_column_9": "Guruhning umumiy qarzining % ulushi",
                        "page": "Sahifa",
                    },
                }
            case "Mongolian":
                static_content = {
                    "general_information_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Ерөнхий мэдээлэл",
                        "head_company_name": "Компанийн нэр:",
                        "head_registration_date": "Бүртгэлийн огноо:",
                        "head_status": "Төлөв:",
                        "head_owners": "Эзэмшигчид:",
                        "head_final_beneficiary": "",  # Тайлангаас хассан
                        "head_line_of_business": "Үйл ажиллагааны чиглэл:",
                        "head_registration_codes": "Бүртгэлийн код:",
                        "head_tax_identifier": "Татварын дугаар:",
                        "head_registration_identifier": "Бүртгэлийн дугаар:",
                        "head_address": "Хаяг:",
                        "head_affiliated_active_companies": "Хамаатан холбоотой компаниуд:",
                        "head_active": "Идэвхтэй:",
                        "head_ceased": "Татварлагдсан/зохион байгуулалтын явцад:",
                        # "head_requested_limit": "ХҮССЭН ЗЭЭЛИЙН ХЯЗГААР:",
                        "head_recomended_limit": "ЗӨВЛӨГДСӨН ЗЭЭЛИЙН ХЯЗГААР:",
                        "company": " - компанид зориулсан",
                        "group": " - бүлэгт зориулсан (баталгаажилтыг харгалзан)",
                        "head_COMBINED_credit_rating": "Бүлгийн рейтинг",
                        "head_credit_rating": "ЗЭЭЛИЙН ҮНЭЛГЭЭ:",
                        "head_credit_rating_justification:": "ЗЭЭЛИЙН ҮНЭЛГЭЭНИЙ ҮНДЭСЛЭЛ:",
                        "page": "Хуудас",
                    },
                    "conclusion_paragraph_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Дүгнэлт",
                        "reporting_period": "тайлангийн хугацаа",
                        "page": "Хуудас",
                    },
                    "conclusion_tables_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Дүгнэлт (үргэлжлэл)",
                        
                        "head_1": "Бүлгийн хамгийн том компаниуд буурах дарааллаар:",
                        "head_2": "Дараах компаниуд бүлгийн хамгийн их цэвэр ашигтай:",
                        "head_3": "Бүлгийн хамгийн их өртэй компаниуд:",
                        "head_4": "Дараах компаниуд бүлгийн хамгийн их урт хугацааны хөрөнгөтэй:",
                        
                        "table_1_column_1": "Компанийн нэр",
                        "table_1_column_2": "Бүртгэлийн дугаар",
                        "table_1_column_3": "Төлөв",
                        "table_1_column_4": "Орлого",
                        "table_1_column_5": "Бүлгийн орлогын % хувь",
                        
                        "table_2_column_1": "Компанийн нэр",
                        "table_2_column_2": "Бүртгэлийн дугаар",
                        "table_2_column_3": "Төлөв",
                        "table_2_column_4": "Цэвэр ашиг",
                        "table_2_column_5": "Бүлгийн цэвэр ашгийн % хувь",
                        
                        "table_3_column_1": "Компанийн нэр",
                        "table_3_column_2": "Бүртгэлийн дугаар",
                        "table_3_column_3": "Төлөв",
                        "table_3_column_4": "Нийт өр",
                        "table_3_column_5": "Бүлгийн нийт өрийн % хувь",
                        
                        "table_4_column_1": "Компанийн нэр",
                        "table_4_column_2": "Бүртгэлийн дугаар",
                        "table_4_column_3": "Төлөв",
                        "table_4_column_4": "Урт хугацааны хөрөнгө",
                        "table_4_column_5": "Бүлгийн урт хугацааны хөрөнгийн % хувь",
                        "page": "Хуудас",
                    },
                    "balance_sheet_tables_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Баланс",
                        
                        "head_1": f"Компанийн баланcын тайлан {self.aggregated_data_for_the_report['target_company_last_available_period']} оны эцсийн байдлаар болон өмнөх хоёр тайлант жилийн байдлаар дараах байдалтай байна:",
                        "head_2": f"Бүлгийн НЭГДСЭН балансын тайлан {self.aggregated_data_for_the_report['target_company_last_available_period']} оны эцсийн байдлаар болон өмнөх хоёр тайлант жилийн байдлаар дараах байдалтай байна:",
                        
                        "table_1_column_1": "Балансын зүйлс",
                        "table_1_column_3": "Нийт хөрөнгийн % хувь",
                        "table_1_column_5": "Нийт хөрөнгийн % хувь",
                        "table_1_column_7": "Нийт хөрөнгийн % хувь",
                        
                        "table_2_column_1": "Балансын зүйлс",
                        "table_2_column_3": "Нийт хөрөнгийн % хувь",
                        "table_2_column_5": "Нийт хөрөнгийн % хувь",
                        "table_2_column_7": "Нийт хөрөнгийн % хувь",
                        "page": "Хуудас",
                    },
                    "balance_sheet_paragraph_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Баланс (үргэлжлэл)",
                        "page": "Хуудас",
                    },
                    "profit_loss_accounts_tables_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "ОРЛОГО БА АЛДАГДЛЫН ТАЙЛАН:",
                        
                        "head_1": f"Компанийн орлого, алдагдлын тайлан {self.aggregated_data_for_the_report['target_company_last_available_period']} он болон өмнөх хоёр тайлант жилийн байдлаар дараах байдалтай байна:",
                        "head_2": f"Бүлгийн НЭГДСЭН орлого, алдагдлын тайлан {self.aggregated_data_for_the_report['target_company_last_available_period']} он болон өмнөх хоёр тайлант жилийн байдлаар дараах байдалтай байна:",
                        
                        "table_1_column_1": "Орлого ба алдагдлын зүйлс",
                        "table_1_column_3": "Нийт орлогын %",
                        "table_1_column_5": "Нийт орлогын %",
                        "table_1_column_7": "Нийт орлогын %",
                        
                        "table_2_column_1": "Орлого ба алдагдлын зүйлс",
                        "table_2_column_3": "Нийт орлогын %",
                        "table_2_column_5": "Нийт орлогын %",
                        "table_2_column_7": "Нийт орлогын %",
                        "page": "Хуудас",
                    },
                    "profit_loss_accounts_paragraph_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "ОРЛОГО БА АЛДАГДЛЫН ТАЙЛАН (үргэлжлэл):",
                        "page": "Хуудас",
                    },
                    "financial_ratios_tables_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Санхүүгийн харьцаанууд:",
                        
                        "head_1": "Ашигт ажиллагааны харьцаанууд",
                        "head_2": "Төлбөрийн чадварын харьцаанууд",
                        "head_3": "Эргэлтийн харьцаанууд",
                        
                        "head_4": "Ашигт ажиллагааны харьцаанууд (НЭГДСЭН):",
                        "head_5": "Төлбөрийн чадварын харьцаанууд (НЭГДСЭН):",
                        "head_6": "Эргэлтийн харьцаанууд (НЭГДСЭН):",
                        
                        "table_1_column_1": "Харьцаанууд",
                        "table_1_column_4": "% өөрчлөлт",
                        "table_1_column_6": "% өөрчлөлт",
                        
                        "table_2_column_1": "Харьцаанууд",
                        "table_2_column_4": "% өөрчлөлт",
                        "table_2_column_6": "% өөрчлөлт",
                        
                        "table_3_column_1": "Харьцаанууд",
                        "table_3_column_2": "(өдөр)",
                        "table_3_column_3": "(өдөр)",
                        "table_3_column_4": "% өөрчлөлт",
                        "table_3_column_5": "(өдөр)",
                        "table_3_column_6": "% өөрчлөлт",
                        
                        "table_4_column_1": "Харьцаанууд",
                        "table_4_column_4": "% өөрчлөлт",
                        "table_4_column_6": "% өөрчлөлт",
                        
                        "table_5_column_1": "Харьцаанууд",
                        "table_5_column_4": "% өөрчлөлт",
                        "table_5_column_6": "% өөрчлөлт",
                        
                        "table_6_column_1": "Харьцаанууд",
                        "table_6_column_2": "(өдөр)",
                        "table_6_column_3": "(өдөр)",
                        "table_6_column_4": "% өөрчлөлт",
                        "table_6_column_5": "(өдөр)",
                        "table_6_column_6": "% өөрчлөлт",
                        "page": "Хуудас",
                    },
                    "dynamic_graphs_page": {
                        "title": "Аюулын тайлан",
                        "subtitle": "Динамик графикууд",
                        
                        "metric": "Метрик:",
                        "periods": "Хугацаанууд",
                        "values": "Утгууд",
                        
                        "profitability_graph_title": "Ашигт ажиллагааны коэффициентүүд:",
                        # "accounts_payable": "кредиторын өр",
                        # "accounts_receivable": "дебиторын өр",
                        "net_financial_result": "цэвэр ашиг/алдагда",
                        "EBIT": "EBIT",
                        "revenue": "орлого",
                        
                        "turnover_graph_title": "Эргэлтийн коэффициентүүд:",
                        "DSO": "DSO",
                        "DPO": "DPO",
                        "DIO": "DIO",
                        
                        "legend_profitability": """
                        <span class="content" style="font-size: 7px">Цэвэр ашиг/алдагдал — Бүх орлого, зардлыг харгалзан гарсан санхүүгийн үр дүн (ашиг/алдагдал).</span><br>
                        <span class="content" style="font-size: 7px">EBIT — Хүү, татварыг тооцохгүйгээр үйл ажиллагааны ашиг. Үндсэн үйл ажиллагааны ашигт ажиллагааг харуулна.</span><br>
                        <span class="content" style="font-size: 7px">Орлого — Зардал ороогүй борлуулалтын хэмжээ (орлого).</span>
                        """,
                        "legend_turnover": """
                        <span class="content" style="font-size: 7px">DSO (Days Sales Outstanding) — Авлагын өрийг дунджаар төлөх хугацаа (хоногоор). Үйлчлүүлэгчтэй ажиллах үр ашгийг илтгэнэ.</span><br>
                        <span class="content" style="font-size: 7px">DPO (Days Payable Outstanding) — Өглөгийн өрийг дунджаар төлөх хугацаа (хоногоор). Компани нийлүүлэгчидтэй хэрхэн харилцаж байгааг харуулна.</span><br>
                        <span class="content" style="font-size: 7px">DIO (Days Inventory Outstanding) — Бараа материалыг дунджаар хадгалах хугацаа (хоногоор). Бараа эргэлтийг тодорхойлдог.</span>
                        """,
                        
                        "page": "Хуудас",
                    },
                    "financial_ratios_paragraph_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "Санхүүгийн харьцаанууд (үргэлжлэл):",
                        "page": "Хуудас",
                    },
                    "court_cases_page": {
                        "title": "Арбитрын хэргүүд",
                        "subtitle": "",
                        "table_name_sum": "Арбитрын хэргүүдийн дүн",
                        "table_name_count": "Арбитрын хэргүүдийн тоо",
                        "str_company_name": "Компанийн нэр",
                        "str_registration_identifier": "Бүртгэлийн дугаар",
                        "str_defendant": "Хариуцагч",
                        "str_plaintiff": "Иргэн тал",
                        "page": "Хуудас",
                    },
                    "group_structure_page": {
                        "title": "Эрсдэлийн тайлан",
                        "subtitle": "БҮЛГИЙН БҮТЭЦ (ГОЛ КОМПАНИУД)",
                        
                        "table_1_column_1": "Компанийн нэр",
                        "table_1_column_2": "Бүртгэлийн дугаар",
                        "table_1_column_3": "Төлөв",
                        "table_1_column_4": "Үйл ажиллагааны чиглэл",
                        "table_1_column_5": "Бүлгийн орлогын % хувь",
                        "table_1_column_6": "Цэвэр ашиг",
                        "table_1_column_7": "Бүлгийн нийт хөрөнгийн % хувь",
                        "table_1_column_8": "Бүлгийн хөрөнгийн % хувь",
                        "table_1_column_9": "Бүлгийн нийт өрийн % хувь",
                        "page": "Хуудас",
                    },
                }
        
        # TODO ---------------
        for registration_identifier in self.dict_with_data["data"]:
            for period in list(sorted(self.dict_with_data["data"][registration_identifier]))[-2 if len(list(self.dict_with_data["data"][registration_identifier])) >= 2 else 0:]:
                company_report_for_period = self.dict_with_data["data"][registration_identifier][period]
                exchange_rate = company_report_for_period["exchange_rate"]
                if exchange_rate:
                    break
        
        self.aggregated_data_for_the_report["owners"].sort(key=lambda x: str(x[1]), reverse=True)  # Сортировка в порядке убывания
        owners = "\n".join(
            [
                list(map((lambda x: str(x)), tup))[3] +
                " (" + list(map((lambda x: str(x)), tup))[1] +
                "%, " + (f"{int(list(map((lambda x: str(x)), tup))[2]):,}"
                if list(map((lambda x: str(x)), tup))[2] and str(list(map((lambda x: str(x)), tup))[2]).isdigit()
                else
                list(map((lambda x: str(x)), tup))[2]) +
                f" {self.aggregated_data_for_the_report.get('currency')});" for tup in self.aggregated_data_for_the_report["owners"][:5]
            ]
        ) if self.aggregated_data_for_the_report.get("owners") else "-"
        if len(self.aggregated_data_for_the_report["owners"]) > 5:
            remaining_owners = len(self.aggregated_data_for_the_report["owners"]) - 5
            match self.language:
                case "English":
                    owners += f"\n<small>and {remaining_owners} more owner(s) of company shares.</small>"
                case "Russian":
                    if remaining_owners == 1:
                        owners += f"\n<small>и еще {remaining_owners} владелец доли компании.</small>"
                    elif 2 <= remaining_owners <= 4:
                        owners += f"\n<small>и еще {remaining_owners} владельца долей компании.</small>"
                    else:
                        owners += f"\n<small>и еще {remaining_owners} владельцев долей компании.</small>"
                case "Kazakh":
                    owners += f"\n<small>және компания үлесінің тағы {remaining_owners} иесі.</small>"
                case "Uzbek":
                    owners += f"\n<small>va kompaniya ulushlarining yana {remaining_owners} egasi.</small>"
                case "Mongolian":
                    owners += f"\n<small>бас {remaining_owners} компанийн хувьцаа эзэмшигч.</small>"
                case _:
                    owners += f"\n<small>+{remaining_owners} more</small>"
        
        revenue_main_companies = "\n".join([
            row[0] for row in self.aggregated_data_for_the_report["revenue_main_company_matrix"]
            ][
                :5 if len(self.aggregated_data_for_the_report["revenue_main_company_matrix"]) >= 5 else len(self.aggregated_data_for_the_report["revenue_main_company_matrix"])
            ]) if self.aggregated_data_for_the_report.get("revenue_main_company_matrix") else "-"
                
        net_financial_result_main_companies = "\n".join([
            row[0] for row in self.aggregated_data_for_the_report["net_financial_result_main_company_matrix"]
            ][
                :5 if len(self.aggregated_data_for_the_report["net_financial_result_main_company_matrix"]) >= 5 else len(self.aggregated_data_for_the_report["net_financial_result_main_company_matrix"])
            ]) if self.aggregated_data_for_the_report.get("net_financial_result_main_company_matrix") else "-"
        
        gross_debt_main_companies = "\n".join([
            row[0] for row in self.aggregated_data_for_the_report["gross_debt_main_company_matrix"]
            ][
                :5 if len(self.aggregated_data_for_the_report["gross_debt_main_company_matrix"]) >= 5 else len(self.aggregated_data_for_the_report["gross_debt_main_company_matrix"])
            ]) if self.aggregated_data_for_the_report.get("gross_debt_main_company_matrix") else "-"
        
        total_long_term_assets_main_companies = "\n".join([
            row[0] for row in self.aggregated_data_for_the_report["total_long_term_assets_main_company_matrix"]
            ][
                :5 if len(self.aggregated_data_for_the_report["total_long_term_assets_main_company_matrix"]) >= 5 else len(self.aggregated_data_for_the_report["total_long_term_assets_main_company_matrix"])
            ]) if self.aggregated_data_for_the_report.get("total_long_term_assets_main_company_matrix") else "-"
        
        group_structure_company_names = "\n".join([
            row[0] for row in self.aggregated_data_for_the_report["group_structure_matrix"]
        ][
            :40 if len(self.aggregated_data_for_the_report["group_structure_matrix"]) >= 40 else len(self.aggregated_data_for_the_report["group_structure_matrix"])
        ]) if self.aggregated_data_for_the_report.get("group_structure_matrix") else "-"
        # TODO ---------------
        translated_paragraphs = await self.__translate(
            company_name=self.aggregated_data_for_the_report.get("company_name"),
            status=self.aggregated_data_for_the_report.get("status", "-"),
            owners=owners,
            address=self.aggregated_data_for_the_report.get("address", "="),
            main_companies_sales=revenue_main_companies,
            net_financial_result_main_companies=net_financial_result_main_companies,
            gross_debt_main_companies=gross_debt_main_companies,
            total_long_term_assets_main_companies=total_long_term_assets_main_companies,
            rating_description_paragraph="\n".join(self.aggregated_data_for_the_report["rating_description"]) if self.aggregated_data_for_the_report.get("rating_description") else "",
            group_structure_company_names=group_structure_company_names
        )
        
        # TODO ТУТ ПЕРИОДИЧЕСКИ ПАДАЮТ НЕПЕРЕВЕДЕННЫЕ ПАРАГРАФЫ РАСШИФРОВКИ РЕЙТИНГА!!!
        if translated_paragraphs.get("rating_description_paragraph"):
            language: str = detect_language(translated_paragraphs["rating_description_paragraph"])
            
            if language != self.language.lower()[:2]:
                translated_rating_description = await self.__translate_rating_description(
                    rating_description_paragraph=translated_paragraphs["rating_description_paragraph"],
                )
                translated_paragraphs["rating_description_paragraph"] = translated_rating_description["rating_description_paragraph"]
        
        
        self.aggregated_data_for_the_report.update(static_content)
        self.aggregated_data_for_the_report.update(translated_paragraphs)
        
        return self.dict_with_data
    
    async def __translate_rating_description(self, rating_description_paragraph: str):  # FIXME нужно реализовать
        LCA_instance = LangChainAbstract()
        input_data = {
            "rating_description_paragraph": rating_description_paragraph,
        }
        
        input_data = InputModelRatingDescription(**input_data)
        
        prompt = TRANSLATE_TRANLITERATE_PROMPTS_BY_LANGUAGE_FOR_DESCRIPTION[self.language]
        
        template_str = "{query}\n" + "{format_instructions}."
        
        prompt = prompt + template_str
        
        return await LCA_instance._execute_langchain_task(
            input_data=input_data,
            pydantic_object=OutputModelRatingDescription,
            prompt=prompt,
            input_variables_name="query",
            metadata={"source": "Translation Task"}
        )
    
    async def __translate(
        self,
        company_name: str,
        status: str,
        owners: str,
        address: str,
        main_companies_sales: str,
        net_financial_result_main_companies: str,
        gross_debt_main_companies: str,
        total_long_term_assets_main_companies: str,
        rating_description_paragraph: str | List[str],
        group_structure_company_names: str,
    ) -> Dict[str, Any]:
        LCA_instance = LangChainAbstract()
        input_data = {
            "company_name": company_name,
            "status": status,
            "owners": owners,
            "address": address,
            "main_companies_sales": main_companies_sales,
            "net_financial_result_main_companies": net_financial_result_main_companies,
            "gross_debt_main_companies": gross_debt_main_companies,
            "total_long_term_assets_main_companies": total_long_term_assets_main_companies,
            "rating_description_paragraph": "\n".join(rating_description_paragraph) if isinstance(rating_description_paragraph, list) else rating_description_paragraph,
            "group_structure_company_names": group_structure_company_names,
        }
        
        input_data = InputModel(**input_data)
        
        prompt = TRANSLATE_TRANLITERATE_PROMPTS_BY_LANGUAGE[self.language]
        
        template_str = "{query}\n" + "{format_instructions}."
        
        prompt = prompt + template_str
        
        # Выполняем перевод для одного текста
        return await LCA_instance._execute_langchain_task(
            input_data=input_data,
            pydantic_object=OutputModel,
            prompt=prompt,
            input_variables_name="query",
            metadata={"source": "Translation Task"}
        )
