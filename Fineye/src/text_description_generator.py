from src.mapping import CURRENCY_MAPPING
import src.utils as utils


class TextDescriptionGenerator:
    def __init__(self, dict_with_data: dict):
        self.dict_with_data = dict_with_data
    
    
    def __important_features_creating_objects(self) -> dict:  # grade_description
        """
        Метод, формирования коллекции с описательными предложениями обоснования рейтинг
        
        :return: dict | данные со структурой содержащей предложения с обоснованиями рейтинга
        """
        data = self.dict_with_data["data"]
        for registration_identifier in data:
            for period in list(sorted(list(data[registration_identifier])))[-2 if len(list(data[registration_identifier])) >= 2 else 0:]:
                company_report_for_period = data[registration_identifier][period]
                
                
                rating_items = []
                
                # sort_by_influential = []
                # most_influential = []  # Самые влиятельный показатель ❕
                # best = []              # Лучшие показатели ✔
                # worst = []             # Плохие показатели ❌
                
                for ratio_key in list(company_report_for_period):
                    if ratio_key.endswith("rating") and ratio_key != "summary_rating":
                        rating_items.append({ratio_key: company_report_for_period[ratio_key]})
                rating_items.sort(key=lambda x: len(x[list(x)[0]]) if x[list(x)[0]] is not None else 0)
                rating_items = list(reversed(rating_items))
                most_influential = rating_items.copy()[:10]
                most_influential.sort(key=lambda x: x[list(x)[0]][0] if x[list(x)[0]] else 100)
                
                # most_influential.extend(rating_items[-3:].copy() if len(rating_items) >= 6 else rating_items[-1:].copy())
                #  зеленый  < 55 <= красный (9 показателей)
                
                
                # best.extend(rating_items[:3].copy() if len(rating_items) >= 6 else rating_items[:1].copy())
                # worst.extend(rating_items[-3:].copy() if len(rating_items) >= 6 else rating_items[-1:].copy())
                
                
                company_report_for_period["important_features"] = most_influential
        
        return self.dict_with_data
    
    def __important_features_finaliser(self) -> dict:
        """
        Метод, объединяющий обоснование рейтинга в единый параграф
        
        :return: dict | данные с параграфом обоснования рейтинга
        """
        
        data = self.dict_with_data["data"]
        for registration_identifier in data:
            for period in list(sorted(list(data[registration_identifier])))[-2 if len(list(data[registration_identifier])) >= 2 else 0:]:
                company_report_for_period = data[registration_identifier][period]
                
                company_report_for_period["rating_description"] = []
                if company_report_for_period.get("important_features", None):
                    important_features = company_report_for_period["important_features"]  # {"k": {"k": }}
                    for feature_dict in important_features:
                        if feature_dict:
                            if feature_dict[list(feature_dict)[0]] and feature_dict[list(feature_dict)[0]][0] < 55:
                                colour_part = "✔ "
                            else:
                                colour_part = "❌ "
                            if list(feature_dict)[0].startswith("debt_to_equity"):
                                try:
                                    feature = utils.debt_to_equity_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['debt_to_equity'], 2)}x)" \
                                        if isinstance(company_report_for_period['debt_to_equity'], (float, int)) else ""
                                
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("debt_to_equity")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("equity_ratio"):
                                try:
                                    feature = utils.equity_ratio_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['equity_ratio'] * 100, 2)}%)" \
                                        if isinstance(company_report_for_period['equity_ratio'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("equity_ratio")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("current_ratio"):
                                try:
                                    feature = utils.current_ratio_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['current_ratio'], 2)}x)" \
                                        if isinstance(company_report_for_period['current_ratio'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("current_ratio")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("interest_coverage_dynamic"):
                                try:
                                    feature = utils.interest_coverage_dynamic_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['interest_coverage_dynamic'] * 100, 2)}%)" \
                                        if isinstance(company_report_for_period['interest_coverage_dynamic'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("interest_coverage_dynamic")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("interest_coverage"):
                                try:
                                    feature = utils.interest_coverage_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['interest_coverage'], 2)}x)" \
                                        if isinstance(company_report_for_period['interest_coverage'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("interest_coverage")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("net_profitability"):
                                try:
                                    
                                    feature = utils.net_profitability_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['net_profitability'] * 100, 2)}%)" \
                                        if isinstance(company_report_for_period['net_profitability'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("net_profitability")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("debt_to_equity"):
                                try:
                                    feature = utils.debt_to_equity_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['net_profitability'] * 100, 2)}%)" \
                                        if isinstance(company_report_for_period['net_profitability'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("debt_to_equity")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("ccc"):
                                try:
                                    feature = utils.ccc_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['cash_conversion_cycle'], 2)} days)" \
                                        if isinstance(company_report_for_period['cash_conversion_cycle'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("ccc")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("revenue_dynamic"):
                                try:
                                    feature = utils.revenue_dynamic_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['revenue_dynamic'] * 100, 2)}%)" \
                                        if isinstance(company_report_for_period['revenue_dynamic'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("revenue_dynamic")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("revenue"):
                                try:
                                    feature = utils.revenue_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    currency_values = list(CURRENCY_MAPPING.keys())
                                    currency = list(CURRENCY_MAPPING.keys())[currency_values.index(company_report_for_period['currency'])] if company_report_for_period['currency'] else None
                                    value_and_unit = f" ({round(company_report_for_period['revenue'], 2):,} {currency if currency else ''})" \
                                        if isinstance(company_report_for_period['revenue'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("revenue")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("debt_to_EBIT"):
                                try:
                                    feature = utils.debt_to_EBIT_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['debt_to_EBIT'], 2)}x)" \
                                        if isinstance(company_report_for_period['debt_to_EBIT'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("debt_to_EBIT")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                            
                            elif list(feature_dict)[0].startswith("age"):
                                try:
                                    feature = utils.age_assessment_grade_description[
                                        feature_dict[list(feature_dict)[0]][0]]
                                    value_and_unit = f" ({round(company_report_for_period['age'], 2)} years)" \
                                        if isinstance(company_report_for_period['age'], (float, int)) else ""
                                except Exception as e:  # noqa: E722
                                    import traceback
                                    error_message = str(e)
                                    formatted_traceback = traceback.format_exc()
                                    log_content = f"{error_message}\n{formatted_traceback}"
                                    print("age")
                                    print(f"{log_content=}")
                                    feature = ''
                                    value_and_unit = ''
                                already_exists = any(
                                    feature in existing for existing in company_report_for_period["rating_description"]
                                )
                                if not already_exists:
                                    company_report_for_period["rating_description"].append(
                                        colour_part + feature + value_and_unit
                                    )
                
                company_report_for_period["rating_description"] = (
                    '\n'.join(list(sorted(list(set(company_report_for_period["rating_description"])), key=lambda x: x[0] if len(x) else x)))
                    .replace("(-infx)", "")
                    .replace("(infx)", "")
                    .replace("(-inf%)", "")
                    .replace("(inf%)", "")
                    .replace("(nan%)", "")
                    .replace("(nanx)", "")
                )
        
        return self.dict_with_data
    
    def get_data_with_grade_description(self):
        self.__important_features_creating_objects()
        self.__important_features_finaliser()
        
        return self.dict_with_data
