from math import ceil
import random
from collections.abc import Iterable

from src.mapping import CURRENCY_MAPPING
import src.utils as utils



class CommentGenerator:
    def __init__(
        self, dict_with_data: dict,
        target_company_registration_identifier: str,
        #  activity_mapping: dict,
    ):
        self.dict_with_data = dict_with_data
        self.target_company_registration_identifier = target_company_registration_identifier
        # self.activity_mapping = activity_mapping

    @staticmethod
    def __to_unit(digit: int | float, currency: str = 'RUB', lang: str = 'EN') -> str:
        """
        Функция преобразующая в корректный вид денежные значения в соответствии с валютой и языком

        :param digit: int|float | денежное значение
        :param currency: str | валюта
        :param lang: str | язык
        :return: str | корректное денежное значение
        """
        units = {
            'RU': {-1: '', 0: 'тыс.', 1: 'млн.', 2: 'млрд.', 3: 'трнл.'},
            'EN': {-1: '', 0: 'K', 1: 'M', 2: 'B', 3: 'T'}
        }

        currencies = {  # todo тут подключаются новые валюты
            'RUB': {'RU': 'руб.',
                    'EN': 'RUB'},
            'EUR': {'RU': 'евро',
                    'EN': 'Euro'},
            'USD': {'RU': 'долл. США',
                    'EN': 'USD'},
            'UZS': {'RU': 'сум.',
                    'EN': 'UZS'},
            'MNT': {'RU': 'MNT',
                    'EN': 'MNT'},
            'KZT': {'RU': 'тенге',
                    'EN': 'KZT'},
        }

        unit_index = -1
        
        while abs(digit) >= 1000:
            digit /= 1000
            unit_index += 1
        if digit > 99 and unit_index >= 1:
            
            return f'{round(digit)}' + f" {units[lang][unit_index]} {currencies[currency][lang]}"
        else:
            return '{:,.2f}'.format(digit) + f" {units[lang][unit_index]} {currencies[currency][lang]}"

    @staticmethod
    def __get_assesment_text(number: int | float, assesment_dict: dict) -> str | None:
        """
        Выбор характеризующего словосочетания по значению из диапазона для комментариев

        :param number: int|float | значение показателя
        :param assesment_dict: dict | диапазон для выбора подходящего словосочетания
        :return: str|None | подходящее словосочетание
        """

        for size_range in sorted(assesment_dict.keys()):

            if isinstance(number, (int, float)) and number <= size_range:
                return assesment_dict[size_range]

            elif not number:
                return None

        return assesment_dict[max(sorted(assesment_dict.keys()))]

    @staticmethod
    def __get_dynamic_phrase(
        num: int | float,
        lang: str = 'EN'
    ) -> str | None:  # (?) возможно стоит перевести ключи на английский язык
        """
        Функция выбирающая выражение для комментариев о динамике показателей

        :param num: int|float | значение показателя динамики в процентах(1 - 999...)
        :param lang: str | язык фраз выражения
        :return: str|None выражение для комментария о динамики
        """
        num = num * 100 if isinstance(num, (int, float)) else None
        dynamic_dict = {'EN': {'фраза': {
            'слабый_рост': random.choice(['showed slight growth by', 'slightly grew by', 'showed small growth by']),
            'неизменно': random.choice(['ramained on the same level', 'unchanged']),
            'рост': random.choice(['increased by', 'showed growth by', 'grew by', 'went up by']),
            'существенный_рост': random.choice(['showed significant growth by', 'showed sharp growth by',
                                                'grew rapidly by', 'grew substantially by']),
            'аномальный_рост': random.choice(['showed very high growth by', 'showed outstanding growth by']),
            'слабое_падение': random.choice(['slightly decreased by', 'showed small decreased by', 'declined by']),
            'падение': random.choice(['dropped by', 'fell by', 'went down by', 'showed decrease by']),
            'существенное_падение': random.choice(['decreased significantly by', 'showed sharp fall by',
                                                   'substantially decreased by']),
            'аномальное_падение': random.choice(['dropped by', 'fell dramatically by',
                                                 'plummeted by'])}}}

        if not isinstance(num, (int, float)):
            num_dyn_phrase = None
            return num_dyn_phrase

        if num >= 0:  # если динамика роста выручки ПОЛОЖИТЕЛЬНАЯ, то...
            if num == 0:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['неизменно']}"
                return num_dyn_phrase

            if 0 < num <= 5:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['слабый_рост']}"  # слабый рост
                return num_dyn_phrase

            elif 5 < num <= 20:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['рост']}"  # просто рост, без прилагательного
                return num_dyn_phrase

            elif 20 < num <= 50:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['существенный_рост']}"  # существенный рост
                return num_dyn_phrase

            else:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['аномальный_рост']}"  # аномальный рост
                return num_dyn_phrase
        else:  # если динамика роста ОТРИЦАТЕЛЬНА, то...
            if 0 > num >= -5:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['слабое_падение']}"  # слабое падение
                return num_dyn_phrase

            elif -5 > num >= -20:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['падение']}"  # просто падение, без прилагательного
                return num_dyn_phrase

            elif -20 > num >= -50:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['существенное_падение']}"  # существенное падение
                return num_dyn_phrase

            else:
                num_dyn_phrase = f"{dynamic_dict[lang]['фраза']['аномальное_падение']}"  # аномальное падение
                return num_dyn_phrase

    @staticmethod
    def __get_dynamic_keys_comments(current_dict: dict, previouse_dict: dict,
                                  ratio: str,
                                  registration_identifier: str) -> list:  # Функцию следует использовать к каждому ключу словаря, задействуя
        """
        Функция формирования текста по шаблонам.

        :param current_dict: dict | данные за текущий год
        :param previouse_dict:  dict | данные за предыдущий год
        :param ratio: str | оцениваемый финансовый показатель
        :param registration_identifier: str | регистрационный номер компании
        :return: list | список комментариев по показателю
        """

        fin_ratios_keys = ['debt_to_equity', 'current_ratio', 'interest_coverage', 'debt_to_EBIT',
                           'cash_conversion_cycle',
                           'days_sales_outstanding', 'days_inventory_outstanding',
                           # ['Financial leverage', 'Current ratio', 'ICR', 'Debt / EBIT', 'CCC', 'DSO, days', 'DIO, days',
                           'days_payable_outstanding']  # 'DPO, days']

        financial_amounts = ['revenue', 'net_financial_result', 'EBIT',
                             'gross_debt', 'long_term_debt',
                             # ['Revenue', 'Net profit', 'EBIT', 'Gross debt', 'Borrowed funds (long-term)',
                             'short_term_debt',
                             'free_cashflow',
                             'total_operating_costs',  # 'Borrowed funds (short-term)', 'FCF', 'Total operating costs',
                             'total_assets', 'equity',
                             'gross_financial_result']  # 'TOTAL ASSETS', 'CAPITAL AND RESERVES', 'Gross profit (loss)']

        financial_shares = ['net_profitability', 'EBIT_margin', 'debt_to_assets', 'equity_ratio', 'gross_margin',
                            # ['Net profitability', 'EBIT margin', 'Debt / Assets', 'Equity ratio', 'Gross margin',
                            'total_operating_costs_to_revenue_ratio']  # 'Costs / Revenue']

        company_group_share = ['revenue', 'EBIT', 'gross_debt', 'total_operating_costs',
                               'net_financial_result']  # ['Revenue', 'EBIT', 'Gross debt', 'Total operating costs', 'Net profit']

        important_keys = ['revenue', 'gross_debt']  # ['Revenue', 'Gross debt']

        assesments_keys = {'net_profitability': utils.net_profitability_assessment_comment,
                           'equity_ratio': utils.equity_ratio_assessment_comment,
                           'debt_to_assets': utils.debt_to_assets_assessment_comment,
                           'current_ratio': utils.current_ratio_assessment_comment,
                           'interest_coverage': utils.interest_coverage_assessment_comment,
                           'debt_to_equity': utils.debt_to_equity_assessment_comment,
                           'cash_conversion_cycle': utils.ccc_assessment_comment,
                           'revenue': utils.revenue_assessment_comment,
                           'age': utils.age_assessment_comment,
                           'debt_to_EBIT': utils.debt_to_EBIT_assessment_comment,
                           'revenue_dynamic': utils.revenue_dynamic_assessment_comment}

        comment_text_list = []  # todo список с комментариями

        company_score_assesment = {}

        GROUP_or_COMPANY = 'Group' if registration_identifier == 'COMBINED' else 'company'  # Текст будет обращен к группе, если registration_number == 'COMBINED' или к компании в противном случае

        if not current_dict:  # ЕСЛИ словарь с данными по текущему году пустой, то возвращаем пустой список
            return comment_text_list

        elif not previouse_dict and current_dict:  # ЕСЛИ есть текущий год, НО нет предыдущего, то ...
            current_val = current_dict[ratio] if ratio in current_dict else None  # получаем значение

            if current_val is None or current_val == 0:  # если текущее значение отсутствует или равно 0, то ...
                if ratio in important_keys:  # если показатель находится в списке важных, то ...
                    comment_dyn = "The {} did not have any {} for the current period ".format(GROUP_or_COMPANY,
                                                                                             ratio.lower())  # добавляем комментарий о динамике
                    comment_text_list.append(comment_dyn)

                    return comment_text_list  # завершаем функцию, возвращая список из 1 элемента

            else:  # если текущее значение есть и отлично от 0, то ...
                current_val_assesment = CommentGenerator.__get_assesment_text(
                    float(current_val),
                    assesments_keys[ratio]
                ) if ratio in assesments_keys and (
                        current_val is not None and current_val != 0) else None  # получаем текст из диапазонов при условии, что есть

                # TODO (!!!) ТУТ СДЕЛАЛ СМЕЩЕНИЯ БЛОКА НИЖЕ НА 1 ТАБУЛЯЦИЮ ВПРАВО
                if current_val is not None and current_val != 0:  # если значение показателя существует и не равно 0, то ...

                    if ratio in financial_amounts:  # Если показатель находиться среди денежных показателей
                        current_val_string = CommentGenerator.__to_unit(current_val,
                                                                        currency=current_dict.get("currency", "n.c."),
                                                                        lang='EN') if (
                                current_val and current_val != 0
                        ) else None

                    if ratio in financial_shares:  # добавляем %, если речь о долях

                        current_val_string = f"{current_val * 100:.2f} %" \
                            if current_val and (current_val * 100) <= 150 \
                            else f"{round(current_val * 100):,} %" if current_val and current_val not in (
                        float("nan"), float("inf"), float("-inf")
                    ) else f"{current_val} %" if current_val else None

                    if ratio in fin_ratios_keys:  # добавляем х, если речь о финансовых показателях
                        current_val_string = f"{current_val:.2f} x" \
                            if current_val and (current_val) <= 150 \
                            else f"{round(current_val):,} x" if current_val and current_val not in (
                        float("nan"), float("inf"), float("-inf")
                    ) else f"{current_val} x" if current_val else None

                    if not current_val_assesment:  # Если не получен текст из диапазона, то ...
                        comment_dyn = "{} of the {} was {} ".format(ratio,
                                                                   GROUP_or_COMPANY,
                                                                   current_val_string)  # делаем простой комментарий о динамике
                        comment_text_list.append(comment_dyn)

                    else:  # Если текст из диапазона получен, то ...
                        if ratio == 'revenue':  # если речь идет о выручке, то генерируем текст следующим образом ...
                            comment_val = "The {} generated a {} {} in the amount of {} ".format(GROUP_or_COMPANY,
                                                                                                current_val_assesment,
                                                                                                ratio.lower(),
                                                                                                current_val_string)
                            comment_text_list.append(comment_val)
                        else:  # в остальных случаях, генерируем следующим образом ...
                            comment_val = "The {} had a {} {} of {} ".format(GROUP_or_COMPANY,
                                                                            current_val_assesment,
                                                                            ratio.lower(),
                                                                            current_val_string)
                            comment_text_list.append(comment_val)

            return comment_text_list

        else:  # ЕСЛИ есть оба года, то ...
            current_val = current_dict[ratio] if ratio in current_dict else None
            previouse_val = previouse_dict[ratio] if ratio in previouse_dict else None

            if current_val is None or current_val == 0:  # Если нет текущего значения, то ...
                if ratio in important_keys:  # если показатель в списке важных, то ...
                    comment_dyn = "The {} did not have any {} for the current period".format(GROUP_or_COMPANY,
                                                                                             ratio.lower())
                    comment_text_list.append(comment_dyn)

                    return comment_text_list

            else:  # Если есть текущее значение, то ...
                current_val_assesment = CommentGenerator.__get_assesment_text(float(current_val),
                                                           assesments_keys[ratio]) if ratio in assesments_keys and (
                        current_val and current_val != 0) else None  # получаем текст из диапазона

                change_dyn = current_dict.get(ratio + "_dynamic", None)
                change_text = CommentGenerator.__get_dynamic_phrase(float(change_dyn), lang='EN') if isinstance(
                    change_dyn, (int, float)) else None  # генерируем фразу для описания динамики изменения показателя

                if ratio in financial_amounts:  # Если показатель находиться среди денежных показателей
                    # print(f"{current_dict.get("currency", 'n.c.')=}")
                    current_val_string = CommentGenerator.__to_unit(current_val,
                                                                    currency=current_dict.get("currency", 'n.c.'),
                                                                    lang='EN') if (
                            current_val and current_val != 0
                    ) else None
                    previouse_val_string = CommentGenerator.__to_unit(previouse_val,
                                                                      currency=current_dict.get("currency", 'n.c.'),
                                                                      lang='EN') if (
                            previouse_val and previouse_val != 0) else None

                if ratio in financial_shares:  # добавляем %, если речь о долях
                    current_val_string = f"{current_val * 100:.2f} %" \
                        if current_val and (current_val * 100) <= 150 \
                        else f"{round(current_val * 100):,} %" if current_val and current_val not in (
                        float("nan"), float("inf"), float("-inf")
                    ) else f"{current_val} %" if current_val else None

                    previouse_val_string = f"{previouse_val * 100:.2f} %" \
                        if previouse_val and (previouse_val * 100) <= 150 \
                        else f"{round(previouse_val * 100):,} %" if previouse_val and previouse_val not in (
                        float("nan"), float("inf"), float("-inf")
                    ) else f"{previouse_val} %" if previouse_val else None


                if ratio in fin_ratios_keys:  # добавляем х, если речь о финансовых показателях
                    current_val_string = f"{current_val:.2f} x" \
                        if current_val and (current_val) <= 150 \
                        else f"{round(current_val):,} x" if current_val and current_val not in (
                        float("nan"), float("inf"), float("-inf")
                    ) else f"{current_val} x" if current_val else None

                    previouse_val_string = f"{previouse_val:.2f} x" \
                        if previouse_val and (previouse_val) <= 150 \
                        else f"{round(previouse_val):,} x" if previouse_val and previouse_val not in (
                        float("nan"), float("inf"), float("-inf")
                    ) else f"{previouse_val} %" if previouse_val else None

                if previouse_val_string and current_val_string and change_dyn:  # Если есть оба комментария, то...
                    if current_val_assesment:
                        if ratio == 'Revenue':  # если показатель - выручка, то используется следующий шаблон для комментария
                            comment_val = "The {} generated a {} {} in the amount of {} ".format(GROUP_or_COMPANY,
                                                                                                current_val_assesment,
                                                                                                ratio.lower(),
                                                                                                current_val_string)
                            comment_text_list.append(comment_val)
                        else:  # остальные используют следующий шаблон ...
                            comment_val = "The {} had a {} {} of {} ".format(GROUP_or_COMPANY,
                                                                            current_val_assesment,
                                                                            ratio.lower(),
                                                                            current_val_string)
                            comment_text_list.append(comment_val)

                    comment_dyn = "{} of the {} {} {:.2f} % from {} to {} ".format(ratio.capitalize()
                                                                                    if not ratio.isupper() else ratio,
                                                                                    GROUP_or_COMPANY,
                                                                                    change_text,
                                                                                    abs(change_dyn) * 100,
                                                                                    previouse_val_string,
                                                                                    current_val_string)

                    comment_text_list.append(comment_dyn)

                elif (
                        not previouse_val_string or previouse_val == 0) and current_val_assesment:  # Если нет комментария по предыдущему году или предыдущее значение показателя равно 0 И характеризующее словосочетание есть, то ...| TODO (???) Проверить правильность условия
                    if ratio == 'Revenue':  # если показатель - выручка, то используется следующий шаблон для комментария
                        comment_val = "The {} generated a {} {} in the amount of {} ".format(GROUP_or_COMPANY,
                                                                                            current_val_assesment,
                                                                                            ratio.lower(),
                                                                                            current_val_string)
                        comment_text_list.append(comment_val)
                    else:  # остальные используют следующий шаблон ...
                        comment_val = "The {} had a {} {} of {} ".format(GROUP_or_COMPANY,
                                                                        current_val_assesment,
                                                                        ratio.lower(),
                                                                        current_val_string)
                        comment_text_list.append(comment_val)

                elif (
                        not previouse_val_string or previouse_val == 0) and not current_val_assesment:  # Если нет комментария по предыдущему году или предыдущее значение показателя равно 0 И отсутствует характеризующее словосочетание, то ...|TODO (???)
                    comment_dyn = "{} of the {} was {} ".format(ratio,
                                                               GROUP_or_COMPANY,
                                                               current_val_string)
                    comment_text_list.append(comment_dyn)

                elif previouse_val_string and not isinstance(current_val_assesment,
                                                             str):  # Если есть комментарий по предыдущему году и нет характеризующего словосочетания, то ...
                    comment_dyn = "{} of the {} was {} ".format(ratio,
                                                               GROUP_or_COMPANY,
                                                               current_val_string)
                    comment_text_list.append(comment_dyn)

                elif not current_val_assesment:  # Если нет текущего словосочетания
                    comment_dyn = "{} of the {} {} {:.2f} % from {} to {} ".format(ratio.capitalize()
                                                                                    if not ratio.isupper() else ratio,
                                                                                  GROUP_or_COMPANY,
                                                                                  change_text,
                                                                                  abs(change_dyn) * 100,
                                                                                  previouse_val_string,
                                                                                  current_val_string)
                    comment_text_list.append(comment_dyn)

                return comment_text_list

    @staticmethod
    def __get_share_keys_comments(group_current_dict: dict, ratio: str) -> str | None:
        """
        Функция формирующая комментарии по долям показателя компании в COMBINED

        :param group_current_dict: dict | COMBINED отчетность
        :param ratio: str | финансовый показатель
        :return: str|None
        """
        if group_current_dict:
            if group_current_dict.get(f'{ratio}_share', None):
                share_comment_text = f"Company's {ratio} share in total Group's {ratio} was {group_current_dict[f'{ratio}_share']:.2f} %."
            else:
                return None
            return share_comment_text
        else:
            return None

    @staticmethod
    def __flatten(list_: iter) -> str:
        """
        Функция очистки словарей комментариев от пустых значений и вложенностей

        :param list_: list | список предложений с комментариями
        :return: str | отчищенный текст
        """  # todo (?)
        for item in list_:
            if isinstance(item, Iterable) and not isinstance(item, str):
                for x in CommentGenerator.__flatten(item):
                    yield x
            else:
                yield item

    @staticmethod
    def __financial_analysys_comments(group_current_period: dict, group_previous_period: dict,
                                    company_current_period: dict, company_previous_period: dict,
                                    registration_number: str) -> tuple:
        """
        Функция формирующая финансовые абзацы.

        :param group_current_period: dict | COMBINED - отчет за текущий период
        :param group_previous_period: dict | COMBINED - отчет за предыдущий период
        :param company_current_period: dict | отчет целевой компании за текущий период
        :param company_previous_period: dict | отчет целевой компании за предыдущий период
        :param registration_number: str | регистрационный номер целевой компании
        :return: tuple[list] | коллекция комментариев к отчёту
        """

        INCOME_STATEMENT = ['revenue', 'gross_financial_result', 'gross_margin', 'total_operating_costs',
                            'total_operating_costs_to_revenue_ratio',
                            'EBIT', 'EBIT_margin', 'interest_coverage', 'net_financial_result', 'net_profitability']

        BALANCE_STATEMENT = ['gross_debt', 'long_term_debt', 'short_term_debt', 'debt_to_assets',
                             'debt_to_equity', 'equity', 'equity_ratio', 'current_ratio']

        RATIO_ANALYSYS = ['cash_conversion_cycle', 'days_sales_outstanding', 'days_inventory_outstanding',
                          'days_payable_outstanding']

        # TODO (!!!) Этот блок для развития проекта (пока не используется)
        # COMPANY_GROUP_SHARE_TEST = ['revenue', 'EBIT', 'gross_debt', 'total_operating_costs', 'net_financial_result']

        # COMPANY_GROUP_SHARE = ['revenue_share', 'EBIT_share', 'gross_debt_share', 'total_operating_costs_share',
        #                        'net_financial_result_share']

        income_comments = []
        balance_comments = []
        ratio_comments = []

        income_comments_paragraph = []
        balance_comments_paragraph = []
        ratio_comments_paragraph = []

        income_dict = {}
        balance_dict = {}
        ratio_dict = {}

        for ratio in INCOME_STATEMENT:  # Цикл прохода по показателям отчета о прибылях/убытках
            income_comments.append([' * '])
            income_comments.append(
                CommentGenerator.__get_dynamic_keys_comments(company_current_period, company_previous_period, ratio, registration_number))
            income_comments.append(CommentGenerator.__get_share_keys_comments(group_current_period, ratio))
            income_comments.append(
                CommentGenerator.__get_dynamic_keys_comments(group_current_period, group_previous_period, ratio, "COMBINED"))

            income_comments = list(CommentGenerator.__flatten(income_comments))
            income_comments = list(filter(None, income_comments))
            income_comments = [' ' + txt for txt in income_comments]
            income_comments_paragraph.append(
                ''.join(income_comments) if ''.join(income_comments) != '  * ' and ' inf ' not in ''.join(
                    income_comments) and ' nan ' not in ''.join(income_comments) and '-inf' not in ''.join(
                    income_comments) else '')
            income_comments = []

        for ratio in BALANCE_STATEMENT:  # Цикл прохода по показателям баланса
            balance_comments.append([' * '])
            balance_comments.append(
                CommentGenerator.__get_dynamic_keys_comments(company_current_period, company_previous_period, ratio, registration_number))
            balance_comments.append(CommentGenerator.__get_share_keys_comments(group_current_period, ratio))
            balance_comments.append(
                CommentGenerator.__get_dynamic_keys_comments(group_current_period, group_previous_period, ratio, "COMBINED"))

            balance_comments = list(CommentGenerator.__flatten(balance_comments))
            balance_comments = list(filter(None, balance_comments))
            balance_comments = [' ' + txt for txt in balance_comments]
            balance_comments_paragraph.append(
                ''.join(balance_comments) if ''.join(balance_comments) != '  * ' and ' inf ' not in ''.join(
                    balance_comments) and ' nan ' not in ''.join(balance_comments) and '-inf' not in ''.join(
                    balance_comments) else '')
            balance_comments = []

        for ratio in RATIO_ANALYSYS:  # Цикл прохода по показателям финансовых коэффициентов
            ratio_comments.append([' * '])
            ratio_comments.append(
                CommentGenerator.__get_dynamic_keys_comments(company_current_period, company_previous_period, ratio, registration_number))
            ratio_comments.append(
                CommentGenerator.__get_dynamic_keys_comments(group_current_period, group_previous_period, ratio, "COMBINED"))

            ratio_comments = list(CommentGenerator.__flatten(ratio_comments))
            ratio_comments = list(filter(None, ratio_comments))
            ratio_comments = [' ' + txt for txt in ratio_comments]
            ratio_comments_paragraph.append(
                ''.join(ratio_comments) if ''.join(ratio_comments) != '  * ' and ' inf ' not in ''.join(
                    ratio_comments) and ' nan ' not in ''.join(ratio_comments) and '-inf' not in ''.join(
                    ratio_comments) else '')
            ratio_comments = []

        balance_comments_paragraph = list(
            filter(lambda x: x is not None, list(
                filter(lambda x: x if x else None, balance_comments_paragraph))))
        income_comments_paragraph = list(
            filter(lambda x: x is not None, list(
                filter(lambda x: x if x else None, income_comments_paragraph))))
        ratio_comments_paragraph = list(
            filter(lambda x: x is not None, list(
                filter(lambda x: x if x else None, ratio_comments_paragraph))))

        return (balance_comments_paragraph, income_comments_paragraph, ratio_comments_paragraph)

    def __get_sectors_activity(self) -> dict:
        """
        Метод, делящий компании из группы, на сектора по видам деятельности

        :return: dict | информацию о компании/группе с распределением по секторам
        """

        data = self.dict_with_data["data"]
        for registration_identifier in data:
            for period in list(sorted(list(data[registration_identifier])))[1 if len(list(data[registration_identifier])) > 1 else 0:]:
                company_report_for_period = data[registration_identifier][period]
                main_activity_code = company_report_for_period["main_activity"]

                # activity_sector = self.activity_mapping[company_report_for_period["country"]].get(main_activity_code,
                #                                                                              None)  # todo сделать в activity_mapping.py сопоставление типов деятельности разных стран с производственными секторами

                # if not activity_sector:
                #     raise ValueError(
                #         f"Не существует по данной стране, данного кода вида деятельности - {main_activity_code}")

                company_report_for_period['activity_sector'] = main_activity_code

        return self.dict_with_data

    def __create_conclusion_list_with_comments(self) -> dict:
        """
        Метод, формирующий заключение по компании/группе
        
        :return: dict | данные о компании/группе со сформированным заключением
        """
        
        data = self.dict_with_data["data"]
        
        is_group = True if len(data) > 1 else False
        
        last_available_year = list(sorted(list(data[self.target_company_registration_identifier])))[-1]
        group_report_for_period = None
        group_report_for_previouse_period = None
        # print(data)
        if data.get("COMBINED", None):
            # print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
            group_report_for_period = data["COMBINED"][last_available_year]
            group_report_for_previouse_period = \
                data["COMBINED"][str(int(last_available_year) - 1)] if \
                    data["COMBINED"].get(str(int(last_available_year) - 1), None) else None
        
        company_report_for_period = data[self.target_company_registration_identifier][last_available_year]
        company_report_for_previouse_period = data[self.target_company_registration_identifier][
            str(int(last_available_year) - 1)] if data[
            self.target_company_registration_identifier].get(str(int(last_available_year) - 1), None) else None
        
        # БЛОК : активные/неактивные/всего компаний; Время на рынке - компании/группы
        revenue = CommentGenerator.__get_dynamic_keys_comments(
            group_report_for_period if is_group else company_report_for_period,
            group_report_for_previouse_period if is_group else company_report_for_previouse_period,
            'revenue',
            registration_identifier="COMBINED" if is_group else str(self.target_company_registration_identifier))
        
        net_financial_result = CommentGenerator.__get_dynamic_keys_comments(
            group_report_for_period if is_group else company_report_for_period,
            group_report_for_previouse_period if is_group else company_report_for_previouse_period,
            'net_financial_result',
            registration_identifier="COMBINED" if is_group else str(self.target_company_registration_identifier))
        
        capital_and_reserves = CommentGenerator.__get_dynamic_keys_comments(
            group_report_for_period if is_group else company_report_for_period,
            group_report_for_previouse_period if is_group else company_report_for_previouse_period,
            'equity',
            registration_identifier="COMBINED" if is_group else str(self.target_company_registration_identifier))
        
        ccc = CommentGenerator.__get_dynamic_keys_comments(
            group_report_for_period if is_group else company_report_for_period,
            group_report_for_previouse_period if is_group else company_report_for_previouse_period,
            'cash_conversion_cycle',
            registration_identifier="COMBINED" if is_group else str(self.target_company_registration_identifier))
        
        gross_debt = CommentGenerator.__get_dynamic_keys_comments(
            group_report_for_period if is_group else company_report_for_period,
            group_report_for_previouse_period if is_group else company_report_for_previouse_period,
            'gross_debt',
            registration_identifier="COMBINED" if is_group else str(self.target_company_registration_identifier))
        
        conclusions_list = []
        
        if is_group:
            affiliated_companies_count = len(
                data) - 1  # Количество ЮЛ в группе
            active_companies_count = len(
                list(
                    filter(
                        lambda x: x is not None,
                        [
                            data[ci]
                            if ci != "COMBINED" and data[ci][list(data[ci])[-1]]["status"] == "Действующее"
                            else None for ci in list(data)
                        ]
                    )
                )
            )
            other_status_count = len(
                list(
                    filter(
                        lambda x: x is not None,
                        [
                            data[ci]
                            if ci != "COMBINED" and data[ci][list(data[ci])[-1]]["status"] != "Действующее"
                            else None for ci in list(data)
                        ]
                    )
                )
            )
            
            company_age = company_report_for_period.get("age", None)
            group_age = group_report_for_period.get("age", None)
            
            if company_age and group_age and group_age > company_age:
                conclusions_list.append(
                    f'  * The company has been operating for {ceil(company_age)} years. But the Group has been operating for {ceil(group_age)} years.')
            elif company_age and group_age and group_age == company_age:
                conclusions_list.append(
                    f'  * The company has been operating for {ceil(company_age)} years (the oldest company in the group).')
            
            if other_status_count:
                conclusions_list.append(
                    f'  * There are {affiliated_companies_count} affiliated companies in the Group, incl. {other_status_count} companies with a status other then "Active".')
            else:
                conclusions_list.append(f'  * There are {affiliated_companies_count} affiliated companies in the Group.')
            
            conclusions_list.append((''.join(revenue) if isinstance(revenue, list) else None))
            conclusions_list.append((''.join(net_financial_result) if isinstance(net_financial_result, list) else None))
            conclusions_list.append((''.join(capital_and_reserves) if isinstance(capital_and_reserves, list) else None))
            conclusions_list.append((''.join(ccc) if isinstance(ccc, list) else None))
            conclusions_list.append((''.join(gross_debt) if isinstance(gross_debt, list) else None))
        
        # ___________________________________________________________________________
        else:
            company_age = company_report_for_period.get("age", None)
            if company_age:
                conclusions_list.append(
                    f'  * The company has been operating for {ceil(company_age)} years (the oldest company in the group).')
            
            conclusions_list.append((''.join(revenue) if isinstance(revenue, list) else None))
            conclusions_list.append((''.join(net_financial_result) if isinstance(net_financial_result, list) else None))
            conclusions_list.append((''.join(capital_and_reserves) if isinstance(capital_and_reserves, list) else None))
            conclusions_list.append((''.join(ccc) if isinstance(ccc, list) else None))
            conclusions_list.append((''.join(gross_debt) if isinstance(gross_debt, list) else None))
        
        company_report_for_period["conclusion_list_comments"] = list(filter(
            lambda x: x != "  * ", [
            "  * " + conclusion_comment.replace("_", " ")
            if conclusion_comment and " * " not in conclusion_comment and conclusion_comment != "  * "
            else conclusion_comment.replace("_", " ") if conclusion_comment else ''
            for conclusion_comment in conclusions_list
        ]))
        return self.dict_with_data
    
    
    def get_comments(self):
        """
        Метод генерирующий и сохраняющий параграфы по balance, income и ratios
        
        :return: dict | данные с параграфами по balance, income, ratios
        """
        self.__get_sectors_activity()
        self.__create_conclusion_list_with_comments()
        
        data = self.dict_with_data["data"]
        
        # paragraphs
        for registration_identifier in data:
            for period in list(sorted(list(data[registration_identifier])))[
                        -2 if len(list(data[registration_identifier])) >= 2 else 0:]:
                # print(period)
                group_report_for_period = None
                group_report_for_previouse_period = None
                if data.get("COMBINED", None):
                    group_report_for_period = data["COMBINED"][period]
                    group_report_for_previouse_period = data["COMBINED"][str(int(period) - 1)] \
                            if data["COMBINED"].get(str(int(period) - 1), None) else None
                
                company_report_for_period = data[registration_identifier][period]
                company_report_for_previouse_period = data[registration_identifier][str(int(period) - 1)] \
                    if data[registration_identifier].get(str(int(period) - 1), None) else None
                
                # if not company_report_for_previouse_period:  # TODO тут можно настроить поведение в случае отсутствия предыдущего года относительно текущего
                #     continue
                
                if not company_report_for_period.get("balance_comments_paragraph", None):
                    company_report_for_period["balance_comments_paragraph"] = []
                if not company_report_for_period.get("income_comments_paragraph", None):
                    company_report_for_period["income_comments_paragraph"] = []
                if not company_report_for_period.get("ratio_comments_paragraph", None):
                    company_report_for_period["ratio_comments_paragraph"] = []
                
                conclusion_paragraph = "\n".join(data[self.target_company_registration_identifier][list(sorted(list(data[self.target_company_registration_identifier])))[-1]]["conclusion_list_comments"]) \
                    if data[self.target_company_registration_identifier][list(sorted(list(data[self.target_company_registration_identifier])))[-1]].get("conclusion_list_comments", None) else None
                
                data[self.target_company_registration_identifier][list(sorted(list(data[self.target_company_registration_identifier])))[-1]]["conclusion_paragraph"] = conclusion_paragraph
                
                balance_comments_paragraph_ = company_report_for_period["balance_comments_paragraph"]
                income_comments_paragraph_ = company_report_for_period["income_comments_paragraph"]
                ratio_comments_paragraph_ = company_report_for_period["ratio_comments_paragraph"]
                
                (
                    balance_comments_paragraph,
                    income_comments_paragraph,
                    ratio_comments_paragraph
                ) = CommentGenerator.__financial_analysys_comments(
                    group_current_period=group_report_for_period,
                    group_previous_period=group_report_for_previouse_period,
                    company_current_period=company_report_for_period,
                    company_previous_period=company_report_for_previouse_period,
                    registration_number=registration_identifier,
                )
                
                balance_comments_paragraph_.append(balance_comments_paragraph if income_comments_paragraph else None)
                income_comments_paragraph_.append(income_comments_paragraph if income_comments_paragraph else None)
                ratio_comments_paragraph_.append(ratio_comments_paragraph if income_comments_paragraph else None)
        
        return self.dict_with_data
