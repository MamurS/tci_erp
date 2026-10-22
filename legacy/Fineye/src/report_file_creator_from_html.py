import datetime
import math
import re
from typing import Optional

import pandas as pd
import plotly.express as px
import plotly.io as pio

from jinja2 import FileSystemLoader, Environment
import plotly.graph_objects as go
from kaleido.scopes.plotly import PlotlyScope

import os


class ReportFileCreator:
    def __init__(
        self,
        dict_with_data: dict,
        target_company_registration_identifier: str,
        with_court_cases: bool,
        dir_path: str='tmp',
    ):
        self.dict_with_data = dict_with_data
        self.target_company_registration_identifier = target_company_registration_identifier
        self.with_court_cases = with_court_cases
        # added dir for saving temp files
        self.dir_path = dir_path
    
    @staticmethod
    def custom_round(number: float|int) -> float|int:
        if number == 0:
            return 0
            
        abs_num = abs(number)
        magnitude = 10 ** (len(str(int(abs_num))) - 1)
        
        if magnitude >= 1000:
            rounded = round(number / 1000) * 1000
        else:
            rounded = round(number / magnitude) * magnitude
        
        return int(rounded) if isinstance(number, int) else rounded
        
    @staticmethod
    def __sanitize_filename(filename: str) -> str:
        """
        Удаление всех символов, которые недопустимы в названиях файлов/директорий
        
        :param filename: str | название для файла с вотенциальным присутствием недопустимых символов
        :return: str | очищенная страка под наименование файла/директории
        """
        
        return re.sub(r'[\\/*?:"<>|]', "", filename)
    
    @staticmethod
    def __create_grade_graph_object(current_grade: float|int, previous_grade: float|int, group_grade_head: str, COMBINED_last_grade: Optional[float|int] = None,):
        SCORE = current_grade
        PREVIOUS_SCORE = previous_grade
        
        # Calculate the delta
        delta_value = SCORE - PREVIOUS_SCORE
        if delta_value == 0:
            absolute_delta_value = '-'
            x_value_delta = 0.5
        else:
            absolute_delta_value = abs(delta_value)
            x_value_delta = 0.495
        
        # Determine color based on increase or decrease
        # delta_color = 'red' if delta_value < 0 else 'green'
        
        def draw_bezier_semicircle(x0, y0, x1, y1):
            c = 0.551915024494
            d = math.hypot((x0-x1), (y0-y1))
            r = d/2 * c
            mid = [(x0+x1)/2, (y0+y1)/2]
            direction = 1 if x0 < x1 else -1
            rot = math.atan((y1-mid[1])/(x1-mid[0]))
            rot_parallel = (direction * math.pi/2) + rot
            apex = [math.cos(rot_parallel)*(d/2)+mid[0], math.sin(rot_parallel)*(d/2)+mid[1]]
            p0 = [x0+math.cos(rot_parallel)*r, y0+math.sin(rot_parallel)*r]
            p1 = [apex[0]-math.cos(rot)*r*direction, apex[1]-math.sin(rot)*r*direction]
            p2 = [apex[0]+math.cos(rot)*r*direction, apex[1]+math.sin(rot)*r*direction]
            p3 = [x1+math.cos(rot_parallel)*r, y1+math.sin(rot_parallel)*r]
            
            path = f"M {x0},{y0} C {p0[0]},{p0[1]} {p1[0]},{p1[1]} {apex[0]},{apex[1]} C {p2[0]},{p2[1]} {p3[0]},{p3[1]} {x1},{y1}"
            return path
        
        def map_value(value):
            return value * (285 - 35) / 100 - 35
        
        def create_pointer():
            radius = 0.45
            size = 0.025
            theta = map_value(SCORE)
            rads = math.radians(theta)
            x1 = -1 * radius * math.cos(rads) + 0.5
            y1 = radius * math.sin(rads) + 0.5
            p0 = [-1 * size * math.cos(math.radians(theta-90)) + 0.5,
                size * math.sin(math.radians(theta-90)) + 0.5]
            p1 = [-1 * size * math.cos(math.radians(theta+90)) + 0.5,
                size * math.sin(math.radians(theta+90)) + 0.5]
            
            path = f"M {x1} {y1} L {p0[0]} {p0[1]} L {p1[0]} {p1[1]} {draw_bezier_semicircle(p1[0], p1[1], p0[0], p0[1])} Z"
            
            return go.layout.Shape(
                type="path",
                path=path,
                fillcolor="black",
                line=dict(width=0)
            )
        
        SCORE_VALUES = [
            {"label": "Excellent", "color": 'rgb(72, 210, 45)'},
            {"label": "Good", "color": 'rgb(183, 210, 45)'},
            {"label": "Average", "color": 'rgb(229, 161, 26)'},
            {"label": "Poor", "color": 'rgb(229, 128, 26)'},
            {"label": "Very poor", "color": 'rgb(229, 60, 26)'}
        ]
        
        # Create the gauge chart
        fig = go.Figure()
        
        # Add the difference from the previous score indicator
        trend_color = 'green' if PREVIOUS_SCORE > SCORE else 'red' if PREVIOUS_SCORE < SCORE else 'black'
        trend_symbol = '▼' if PREVIOUS_SCORE > SCORE else '▲' if PREVIOUS_SCORE < SCORE else ''
        
        # Add the main score number
        fig.add_trace(go.Indicator(
            mode="number",
            value=SCORE,
            domain={'x': [0, 1], 'y': [0.15, 0.35]},
            number={
                'font': {'size': 70, 'color': "black"},
            }
        ))
        
        # Manually add the delta value as an annotation (no minus sign)
        fig.add_annotation(
            text=f"{trend_symbol}{int(absolute_delta_value) if isinstance(absolute_delta_value, (int, float)) else absolute_delta_value}",
            xref="paper", yref="paper",
            x=x_value_delta, y=0.08,
            showarrow=False,
            font=dict(size=34, color=trend_color)
        )
        if COMBINED_last_grade:
            fig.add_annotation(
                text=f"\n{group_grade_head}: {round(COMBINED_last_grade, 1)}",
                xref="paper", yref="paper",
                x=x_value_delta, y=0.0,
                showarrow=False,
                font=dict(size=34, color="black")
            )
        
        # Add the gauge
        fig.add_trace(go.Pie(
            values=[14, 14, 14, 14, 14, 30],
            labels=[s["label"] for s in SCORE_VALUES] + [" "],
            marker=dict(
                colors=[s["color"] for s in SCORE_VALUES] + ['rgba(255, 255, 255, 0)'],
                line=dict(width=4, color="white")
            ),
            rotation=-126,
            hole=0.75,
            direction="clockwise",
            sort=False,
            showlegend=False,
            hoverinfo="none",
            textinfo="none",
            textposition="outside"
        ))
        
        # Update the layout
        fig.update_layout(
            shapes=[create_pointer()],
            width=500,
            height=500,
            margin=dict(t=1, b=1, l=1, r=1)
        )
        
        return fig
    
    @staticmethod
    def __create_dynamic_graph_object(data_for_graph: dict, tempdir: str, name: str, static_content: dict):
        if name == "profitability":
            _title = static_content["profitability_graph_title"]
            _metric = static_content["metric"]
            _periods = static_content["periods"]
            _values = static_content["values"]
            
            _net_financial_result = static_content["net_financial_result"]
            _EBIT = static_content["EBIT"]
            _revenue = static_content["revenue"]
            
            _metric_list = [_net_financial_result, _EBIT, _revenue]
            
        elif name == "turnover":
            _title = static_content["turnover_graph_title"]
            _metric = static_content["metric"]
            _periods = static_content["periods"]
            _values = static_content["values"]
            
            _dso = static_content["DSO"]
            _dpo = static_content["DPO"]
            _dio = static_content["DIO"]
            
            _metric_list = sorted([_dso, _dpo, _dio])
        # Преобразование словаря в DataFrame
        data = []
        for period, metrics in data_for_graph.items():
            for idx, (metric, value) in enumerate(sorted(metrics.items())):
                data.append({_periods: period, _metric: _metric_list[idx], _values: value})
        
        df = pd.DataFrame(data)
        
        # Построение графика
        fig = px.line(
            df, x=_periods, y=_values, color=_metric, markers=True,
            title=_title,
        )
        
        # Настройка фона
        fig.update_layout(
            paper_bgcolor='white',   # Фон всего графика
            plot_bgcolor='white'     # Фон области графика
        )
        
        # Обновление осей
        min_value = df[_values].min()
        max_value = df[_values].max()
        range_max = max_value + 0.1 * (max_value - min_value)
        
        fig.update_yaxes(range=[min_value, range_max])
        
        # Сохранение графика в формате PNG
        pio.write_image(fig, 'plot.png', format='png')
        
        scope = PlotlyScope(
            plotlyjs=os.path.join(os.getcwd(), "src/plotly.js"),
        )
        with open(os.path.join(tempdir, f"{name}_dynamic_graph.png"), "wb") as f:
            f.write(scope.transform(fig, format="png"))
    
    @staticmethod
    def __create_html_page(template_name, page_number, output_dict, tmpdir):
        file_loader = FileSystemLoader('src/templates')
        env = Environment(loader=file_loader)
        env.filters["integer_format"] = ReportFileCreator.integer_format  # number_format
        env.filters["float_format_one_decimal_place"] = ReportFileCreator.float_format_one_decimal_place  # number_format
        env.filters["float_format_percent"] = ReportFileCreator.float_format_percent
        env.filters["float_format"] = ReportFileCreator.float_format
        template = env.get_template(template_name)
        
        output_dict['page_number'] = page_number
        
        output = template.render(output_dict)
        
        # new path to file in temp dir
        with open(os.path.join(tmpdir, f'output_{page_number}.html'), 'w', encoding="utf-8") as file:
            file.write(output)
    
    @staticmethod
    def integer_format(value):
        try:
            value = float(str(value).replace(",", "").replace(" ", ""))
            if value == float('inf'):
                value = 100
            elif value == float('-inf'):
                value = -100
            elif value == float('nan'):
                value = "-"
        except ValueError:
            return value
        finally:
            return "{:,.0f}".format(value) if isinstance(value, (float, int)) else value
    
    @staticmethod
    def float_format(value):
        try:
            value = float(str(value).replace(",", "").replace(" ", ""))
            if value == float('nan'):
                value = "-"
        except ValueError:
            return value
        finally:
            return "{:,.2f}".format(value) if isinstance(value, (float, int)) else value
    
    @staticmethod
    def float_format_one_decimal_place(value):
        try:
            value = float(str(value).replace(",", "").replace(" ", ""))
            if value == float('nan'):
                value = "-"
        except ValueError:
            return value
        finally:
            return "{:,.1f}".format(value) if isinstance(value, (float, int)) else value
    
    @staticmethod
    def float_format_percent(value):
        try:
            value = float(str(value).replace(",", "").replace(" ", "")) * 100
            if value == float('inf'):
                value = 100
            elif value == float('-inf'):
                value = -100
            elif value == float('nan'):
                value = "-"
        except ValueError:
            return value
        finally:
            return "{:,.1f}".format(value) if isinstance(value, (float, int)) else value
    
    def create_report_file(self) -> None:
        """
        Метод создающий PDF-файл с отчетом
        
        :return: None
        """
        # Загрузите шаблоны из каталога templates
        exchange_rate = 1
        data = self.dict_with_data["aggregated_data_for_the_report"]
        for registration_identifier in self.dict_with_data["data"]:
            for period in list(sorted(self.dict_with_data["data"][registration_identifier]))[-2 if len(list(self.dict_with_data["data"][registration_identifier])) >= 2 else 0:]:
                company_report_for_period = self.dict_with_data["data"][registration_identifier][period]
                exchange_rate = company_report_for_period["exchange_rate"]
                if exchange_rate:
                    break
        
        
        is_group = data.get("is_group")
        with_court_cases = self.with_court_cases
        
        
        currency = data.get("currency")
        
        COMBINED_last_available_period = data.get("COMBINED_last_available_period", None)
        target_company_last_available_period = int(data.get("target_company_last_available_period", None))
        
        credit_limit = data.get("credit_limit", None)
        group_credit_limit = data["group_credit_limit"] if data.get("group_credit_limit", None) and data["group_credit_limit"] > credit_limit else None
        
        year_today = datetime.datetime.now().year
        previous_year_today = year_today - 1
        before_previous_year_today = previous_year_today - 1
        
        year_today_str, previous_year_today_str, before_previous_year_today_str = tuple(map(str, [year_today, previous_year_today, before_previous_year_today]))
        
        # TODO <PERIOD>
        financial_statement_period_types: list = data.get("financial_statement_period_types")
        current_period = ""
        
        if financial_statement_period_types:
            if financial_statement_period_types[-1] == "Annual":
                current_period = str(target_company_last_available_period)
            elif financial_statement_period_types[-1] == "Quarterly":
                current_period = f"3M{target_company_last_available_period}"
            elif financial_statement_period_types[-1] == "Semi-annual":
                current_period = f"6M{target_company_last_available_period}"
            elif financial_statement_period_types[-1] == "Nine month":
                current_period = f"9M{target_company_last_available_period}"
        previous_period = ""
        if len(financial_statement_period_types) >= 2:
            if financial_statement_period_types[-2] == "Annual":
                previous_period = str(target_company_last_available_period - 1)
            elif financial_statement_period_types[-2] == "Quarterly":
                previous_period = f"3M{target_company_last_available_period - 1}"
            elif financial_statement_period_types[-2] == "Semi-annual":
                previous_period = f"6M{target_company_last_available_period - 1}"
            elif financial_statement_period_types[-2] == "Nine month":
                previous_period = f"9M{target_company_last_available_period - 1}"
                
        before_previous_period = ""
        if len(financial_statement_period_types) >= 3:
            if financial_statement_period_types[-3] == "Annual":
                before_previous_period = str(target_company_last_available_period - 2)
            elif financial_statement_period_types[-3] == "Quarterly":
                before_previous_period = f"3M{target_company_last_available_period - 2}"
            elif financial_statement_period_types[-3] == "Semi-annual":
                before_previous_period = f"6M{target_company_last_available_period - 2}"
            elif financial_statement_period_types[-3] == "Nine month":
                before_previous_period = f"9M{target_company_last_available_period - 2}"
        # TODO <PERIOD>
        
        company_name = data["company_name"] if data.get("company_name", None) else None
        founding_date = data["founding_date"] if data.get("founding_date", None) else "-"  # TODO (!!!) .strftime("%d.%m.%Y")
        status = data.get("status", None)  #"Active" if data.get("status", None) and data["status"] == "Действующее" else 'Difference from "Active"'  # TODO (???) исправить костыль в виде константы
        
        owners = data.get("owners", None)
        
        line_of_business = data.get("line_of_business", "-")
        tax_identifier = data.get("tax_identifier")
        registration_identifier = data.get("registration_identifier")
        address = data["address"] if data.get("address") else "-"
        number_active_companies = data["number_active_companies"]
        main_companies_sales = data.get("main_companies_sales", None)
        number_companies_in_group = data.get("number_companies_in_group", None)
        last_grade = data.get("last_grade", None)
        previous_grade = data.get("previous_grade", None)
        COMBINED_last_grade = data.get("COMBINED_last_grade", None)
        COMBINED_previous_grade = data.get("COMBINED_previous_grade", None)
        
        rating_description = data["rating_description_paragraph"].split("\n") if data.get("rating_description_paragraph", None) else None
        
        conclusion_paragraph = data.get("conclusion_paragraph", None)
        balance_paragraph = data.get("balance_paragraph", None)
        income_paragraph = data.get("income_paragraph", None)
        ratios_paragraph = data.get("ratios_paragraph", None)
        
        combined_balance_matrix = data.get("combined_balance_matrix", None)
        combined_pl_matrix = data.get("combined_pl_matrix", None)
        
        company_balance_matrix = data.get("company_balance_matrix", None)
        company_pl_matrix = data.get("company_pl_matrix", None)
        
        net_financial_result_main_companies = data.get("net_financial_result_main_companies")
        gross_debt_main_companies = data.get("gross_debt_main_companies")
        total_long_term_assets_main_companies = data.get("total_long_term_assets_main_companies")
        
        group_structure_companies = data.get("group_structure_company_names")
        
        
        revenue_main_company_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["revenue_main_company_matrix"])) \
            if data.get("revenue_main_company_matrix", None) else None
        
        if revenue_main_company_matrix:
            for idx, main_company_sales_name in enumerate(main_companies_sales.split("\n") if main_companies_sales else []):
                revenue_main_company_matrix[idx][0] = main_company_sales_name
        
        net_financial_result_main_company_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["net_financial_result_main_company_matrix"])) \
            if data.get("net_financial_result_main_company_matrix", None) else None
        
        if net_financial_result_main_company_matrix:
            for idx, net_financial_result_main_company_name in enumerate(net_financial_result_main_companies.split("\n") if net_financial_result_main_companies else []):
                net_financial_result_main_company_matrix[idx][0] = net_financial_result_main_company_name
        
        gross_debt_main_company_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["gross_debt_main_company_matrix"])) \
            if data.get("gross_debt_main_company_matrix", None) else None
        
        if gross_debt_main_company_matrix:
            for idx, gross_debt_main_company_name in enumerate(gross_debt_main_companies.split("\n") if gross_debt_main_companies else []):
                gross_debt_main_company_matrix[idx][0] = gross_debt_main_company_name
        
        total_long_term_assets_main_company_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["total_long_term_assets_main_company_matrix"])) \
            if data.get("total_long_term_assets_main_company_matrix", None) else None
        
        if total_long_term_assets_main_company_matrix:
            for idx, total_long_term_assets_main_company_name in enumerate(total_long_term_assets_main_companies.split("\n") if total_long_term_assets_main_companies else []):
                total_long_term_assets_main_company_matrix[idx][0] = total_long_term_assets_main_company_name
        
        company_profitability_ratios_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["company_profitability_ratios_matrix"])) \
            if data.get("company_profitability_ratios_matrix", None) else None
        
        company_liquidity_ratios_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["company_liquidity_ratios_matrix"])) \
            if data.get("company_liquidity_ratios_matrix", None) else None
        
        company_turnover_ratios_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["company_turnover_ratios_matrix"])) \
            if data.get("company_turnover_ratios_matrix", None) else None
        
        combined_profitability_ratios_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["combined_profitability_ratios_matrix"])) \
            if data.get("combined_profitability_ratios_matrix", None) else None
        
        combined_liquidity_ratios_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["combined_liquidity_ratios_matrix"])) \
            if data.get("combined_liquidity_ratios_matrix", None) else None
        
        combined_turnover_ratios_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["combined_turnover_ratios_matrix"])) \
            if data.get("combined_turnover_ratios_matrix", None) else None
        
        group_structure_matrix = list(
            map(lambda x: [x[0]] + [x[1]] + [
                "Active" if x[2] == "Действующее" else "Other"] + x[3:],
                data["group_structure_matrix"])) \
            if data.get("group_structure_matrix", None) else None
        
        translated_name_reg_identifier_mapping = {}  # СОПОСТОВЛЕНИЕ, ГДЕ КЛЮЧ - РЕГИСТРАЦИОННЫЙ ИДЕНТИФИКАТОР, А ЗНАЧЕНИЕ - ПЕРЕВЕДЕННОЕ НАЗВАНИЕ КОМПАНИИ
        
        if group_structure_matrix:
            for idx, group_structure_company_name in enumerate(group_structure_companies.split("\n") if group_structure_companies else []):
                group_structure_matrix[idx][0] = group_structure_company_name
                translated_name_reg_identifier_mapping[group_structure_matrix[idx][1]] = group_structure_company_name
        
        court_cases_objects = data["court_cases"]
        for court_cases_object in court_cases_objects:
            if is_group:
                court_cases_object["company_name"] = translated_name_reg_identifier_mapping.get(court_cases_object["registration_identifier"], "-")
            else:
                court_cases_object["company_name"] = company_name
        
        count_not_active = data["count_not_active"] if data.get("count_not_active") is not None else "-"
        
        general_information_page: dict = data.get("general_information_page")
        conclusion_paragraph_page: dict = data.get("conclusion_paragraph_page")
        conclusion_tables_page: dict = data.get("conclusion_tables_page")
        balance_sheet_tables_page: dict = data.get("balance_sheet_tables_page")
        balance_sheet_paragraph_page: dict = data.get("balance_sheet_paragraph_page")
        profit_loss_accounts_tables_page: dict = data.get("profit_loss_accounts_tables_page")
        profit_loss_accounts_paragraph_page: dict = data.get("profit_loss_accounts_paragraph_page")
        financial_ratios_tables_page: dict = data.get("financial_ratios_tables_page")
        dynamic_graphs_page: dict = data.get("dynamic_graphs_page")
        financial_ratios_paragraph_page: dict = data.get("financial_ratios_paragraph_page")
        court_cases_page: dict = data.get("court_cases_page")
        group_structure_page: dict = data.get("group_structure_page")
        reporting_period: str = conclusion_paragraph_page.get("reporting_period")
        
        ReportFileCreator.file_name = ReportFileCreator.__sanitize_filename(
            f"{datetime.datetime.now().day}{datetime.datetime.now().month}{datetime.datetime.now().year}_{company_name.replace('  ', ' ').replace(' ', '_') if company_name else '___'}_{self.target_company_registration_identifier}_{self.dict_with_data['data'][registration_identifier][list(self.dict_with_data['data'][registration_identifier])[-1]].get('country', '')}.pdf"
        )
        
        # added tempdir - class attribute path_dir
        tempdir = self.dir_path
        
        # _____________________________________________________________________________________________________________
        # создадим картинку для первой страницы отчета
        
        grade_fig = self.__create_grade_graph_object(
            current_grade=last_grade,
            previous_grade=previous_grade,
            group_grade_head=general_information_page["head_COMBINED_credit_rating"],
            COMBINED_last_grade=COMBINED_last_grade,
        )
        
        scope = PlotlyScope(
            plotlyjs=os.path.join(os.getcwd(), "src/plotly.js"),
        )
        with open(os.path.join(tempdir, "grade_speedometer.png"), "wb") as f:
            f.write(scope.transform(grade_fig, format="png"))
        
        data_for_financial_dynamic_graph = {}
        data_for_turnover_dynamic_graph = {}
        for year in data["data_for_graph"]:
            data_by_period = data["data_for_graph"][year]
            
            data_for_financial_dynamic_graph[year] = {}
            data_for_financial_dynamic_graph[year]["revenue"] = data_by_period["revenue"]
            data_for_financial_dynamic_graph[year]["net_financial_result"] = data_by_period["net_financial_result"]
            data_for_financial_dynamic_graph[year]["EBIT"] = data_by_period["EBIT"]
            
            data_for_turnover_dynamic_graph[year] = {}
            data_for_turnover_dynamic_graph[year]["DSO"] = data_by_period["DSO"]
            data_for_turnover_dynamic_graph[year]["DPO"] = data_by_period["DPO"]
            data_for_turnover_dynamic_graph[year]["DIO"] = data_by_period["DIO"]
        
        static_content_for_dynamic_graphs = data["dynamic_graphs_page"]
        
        self.__create_dynamic_graph_object(data_for_graph=data_for_financial_dynamic_graph, tempdir=tempdir, name="profitability", static_content=static_content_for_dynamic_graphs,)
        self.__create_dynamic_graph_object(data_for_graph=data_for_turnover_dynamic_graph, tempdir=tempdir, name="turnover", static_content=static_content_for_dynamic_graphs,)
        # grade_fig.write_image(os.path.join(tempdir, "grade_speedometer.png"), engine="kaleido")
        
        # _____________________________________________________________________________________________________________
        html_page_number = 1
        general_information_data = {
            **general_information_page,            
            "is_group": is_group,
            "company_name": company_name,
            "founding_date": founding_date,
            "status": status,
            "owners": owners,
            "line_of_business": line_of_business if line_of_business else "-",
            "registration_identifier": registration_identifier if registration_identifier else "-",
            "tax_identifier": tax_identifier if tax_identifier else "-",
            "address": address,
            "number_active_companies": number_active_companies,
            "number_ceased_companies": count_not_active,
            "main_companies_sales": main_companies_sales, # !!! 'NoneType' object is not iterable  #
            "credit_limit": self.custom_round(credit_limit) if credit_limit else 0,
            "group_credit_limit": self.custom_round(group_credit_limit) if group_credit_limit else None,
            "last_grade": round(last_grade),
            "rating_description": rating_description,
            "currency": currency,
            "limit_currency": currency if exchange_rate == 1 else "USD",
            #"rating_description": "\n".join(rating_description),
            "page_number": html_page_number,
        }
        template_name = 'template_general_information_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, general_information_data, tempdir)
        # ______________________________________________________________________________________________________________
        
        # создадим Conclusion
        html_page_number += 1
        conclusion_paragraph_data = {
            **conclusion_paragraph_page,
            "conclusion_paragraph": conclusion_paragraph,
            "current_period": current_period,
            "reporting_period": reporting_period,
            "page_number": html_page_number,
        }
        template_name = 'template_conclusion_paragraph_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, conclusion_paragraph_data, tempdir)
        
        if is_group:
            html_page_number += 1
            conclusion_tables_data = {
                **conclusion_tables_page,
                "currency": currency,
                "target_company_registration_identifier": registration_identifier,
                "target_company_last_available_period": target_company_last_available_period,
                "revenue_main_company_matrix": revenue_main_company_matrix if revenue_main_company_matrix else None,
                "net_financial_result_main_company_matrix": net_financial_result_main_company_matrix,
                "gross_debt_main_company_matrix": gross_debt_main_company_matrix,
                "total_long_term_assets_main_company_matrix": total_long_term_assets_main_company_matrix,
                
                "current_period": current_period,
                "previous_period": previous_period,
                "before_previous_period": before_previous_period,
                # "multiplier_str": multiplier_str,
                
                "page_number": html_page_number,
            }
            template_name = 'template_conclusion_tables_page.html'
            ReportFileCreator.__create_html_page(template_name, html_page_number, conclusion_tables_data, tempdir)
        # ______________________________________________________________________________________________________________
        
        # создадим Balance Sheet
        html_page_number += 1
        balance_tables_data = {
            **balance_sheet_tables_page,
            "is_group": is_group,
            "currency": currency,
            "target_company_last_available_period": target_company_last_available_period,
            "company_balance_matrix": company_balance_matrix,
            "combined_balance_matrix": combined_balance_matrix,
            
            "current_period": current_period,
            "previous_period": previous_period,
            "before_previous_period": before_previous_period,
            # "multiplier_str": multiplier_str,
            
            "page_number": html_page_number,
        }
        
        template_name = 'template_balance_sheet_tables_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, balance_tables_data, tempdir)
        
        html_page_number += 1
        balance_paragraph_data = {
            **balance_sheet_paragraph_page,
            "is_group": is_group,
            "balance_paragraph": balance_paragraph,
            "current_period": current_period,
            "reporting_period": reporting_period.capitalize(),
            "page_number": html_page_number,
        }
        template_name = 'template_balance_sheet_paragraph_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, balance_paragraph_data, tempdir)
        # ______________________________________________________________________________________________________________
        # создадим PROFIT & LOSS ACCOUNTS
        html_page_number += 1
        profit_loss_accounts_tables_data = {
            **profit_loss_accounts_tables_page,
            "is_group": is_group,
            "currency": currency,
            "target_company_last_available_period": target_company_last_available_period,
            "company_pl_matrix": company_pl_matrix,
            "combined_pl_matrix": combined_pl_matrix,
            
            "current_period": current_period,
            "previous_period": previous_period,
            "before_previous_period": before_previous_period,
            # "multiplier_str": multiplier_str,
            
            "page_number": html_page_number,
        }
        template_name = 'template_profit_loss_accounts_tables_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, profit_loss_accounts_tables_data, tempdir)
        
        html_page_number += 1
        profit_loss_accounts_paragraph_data = {
            **profit_loss_accounts_paragraph_page,
            "is_group": is_group,
            "income_paragraph": income_paragraph,
            "current_period": current_period,
            "reporting_period": reporting_period.capitalize(),
            "page_number": html_page_number,
        }
        template_name = 'template_profit_loss_accounts_paragraph_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, profit_loss_accounts_paragraph_data, tempdir)
        # ______________________________________________________________________________________________________________
        
        # создадим FINANCIAL RATIOS
        html_page_number += 1
        financial_ratios_tables_data = {
            **financial_ratios_tables_page,
            "is_group": is_group,
            "currency": currency,
            "company_name": company_name,
            "target_company_registration_identifier": registration_identifier,
            "target_company_last_available_period": target_company_last_available_period,
            
            "company_profitability_ratios_matrix": company_profitability_ratios_matrix,
            "company_liquidity_ratios_matrix": company_liquidity_ratios_matrix,
            "company_turnover_ratios_matrix": company_turnover_ratios_matrix,
            
            "combined_profitability_ratios_matrix": combined_profitability_ratios_matrix,
            "combined_liquidity_ratios_matrix": combined_liquidity_ratios_matrix,
            "combined_turnover_ratios_matrix": combined_turnover_ratios_matrix,
            
            "current_period": current_period,
            "previous_period": previous_period,
            "before_previous_period": before_previous_period,
            
            # "multiplier_str": multiplier_str,
            
            "page_number": html_page_number,
        }
        template_name = 'template_financial_ratios_tables_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, financial_ratios_tables_data, tempdir)
        
        html_page_number += 1
        template_name = 'template_dynamic_graph_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, {**dynamic_graphs_page, "page_number": html_page_number}, tempdir)
        
        html_page_number += 1
        financial_ratios_paragraph_data = {
            **financial_ratios_paragraph_page,
            "is_group": is_group,
            "ratios_paragraph": ratios_paragraph,
            "current_period": current_period,
            "reporting_period": reporting_period.capitalize(),
            "page_number": html_page_number,
        }
        template_name = 'template_financial_ratios_paragraph_page.html'
        ReportFileCreator.__create_html_page(template_name, html_page_number, financial_ratios_paragraph_data, tempdir)
        # ______________________________________________________________________________________________________________
        if with_court_cases and data.get("court_cases"):
            html_page_number += 1
            court_cases_data = {
                **court_cases_page,
                "target_company_registration_identifier": registration_identifier,
                "court_cases": court_cases_objects,
                "current_period": year_today_str,
                "previous_period": previous_year_today_str,
                "before_previous_period": before_previous_year_today_str,
                
                "page_number": html_page_number,
            }
            template_name = 'template_court_cases_page.html'
            ReportFileCreator.__create_html_page(template_name, html_page_number, court_cases_data, tempdir)
        
        # создадим GROUP STRUCTURE (MAJOR COMPANIES):
        if is_group:
            html_page_number += 1
            group_structure_data = {
                **group_structure_page,
                'currency': currency,
                "target_company_registration_identifier": registration_identifier,
                'group_structure_matrix': group_structure_matrix,
                # "multiplier_str": multiplier_str,
                "page_number": html_page_number,
            }
            template_name = 'template_group_structure_page.html'
            ReportFileCreator.__create_html_page(template_name, html_page_number, group_structure_data, tempdir)
        
        # ______________________________________________________________________________________________________________
        
        
        return credit_limit, last_grade
