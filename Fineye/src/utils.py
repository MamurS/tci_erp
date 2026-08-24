from typing import Any, Dict


debt_to_equity_assessment_grade_description = {
    99: "Equity deficit",  # float("-inf")
    97: "Equity deficit",  # float("-inf")
    94: "Extremely high Debt-to-Dquity ratio",  # 5
    89: "Very high Debt-to-Equity ratio",  # 4
    87: "Very high Debt-to-Equity ratio",  # 4
    79: "High Debt-to-Equity ratio",  # 3
    69: "High Debt-to-Equity ratio",  # 2.4
    67: "High Debt-to-Equity ratio",  # 2.4
    59: "Relatively high Debt-to-Equity ratio",  # 2
    57: "Relatively high Debt-to-Equity ratio",  # 2
    49: "Adequate Debt-to-Equity ratio",  # 1
    47: "Adequate Debt-to-Equity ratio",  # 1
    39: "Relatively low Debt-to-Equity ratio",  # 0.5
    37: "Relatively low Debt-to-Equity ratio",  # 0.5
    29: "Low Debt-to-Equity ratio",  # 0.25
    27: "Very low Debt-to-Equity ratio",  # 0.00001
    24: "No Debt",  # 0
}

equity_ratio_assessment_grade_description = {
    97: "Equity deficit",  # float("-inf")
    89: "No Equity",  # 0
    84: "Very low Equity ratio",  # 0.02
    79: "Low Equity ratio",  # 0.1
    74: "Low Equity ratio",  # 0.15
    64: "Relatively Low Equity ratio",  # 0.30
    54: "Adequate Equity ratio",  # 0.40
    44: "Sound Equity ratio",  # 0.55
    34: "Strong Equity ratio",  # 0.65
    24: "Very strong Equity ratio",  # 0.75
    14: "Extremely strong Equity ratio",  # 0.80
}

current_ratio_assessment_grade_description = {
    84: "Extremely weak Current ratio",  # float("-inf")
    74: "Extremely weak Current ratio",  # 0
    64: "Weak Current ratio",  # 0.5
    54: "Adequate Current ratio",  # 1.0
    45: "Average Current ratio",  # 1 - 2
    40: "Strong Current ratio",  # 2
}

interest_coverage_assessment_grade_description = {
    99: "Negative EBIT",  # float("-inf")
    89: "Extremely low Interest Coverage",  # 0
    79: "Very low Interest Coverage",  # 0.5
    69: "Low Interest Coverage",  # 1
    59: "Relatively low Interest Coverage",  # 2
    49: "Adequate Interest Coverage",  # 3
    30: "High Interest Coverage",  # 4
    17: "Very high Interest Coverage",  # 6
}

interest_coverage_dynamic_assessment_grade_description = {
    60: "Deteriorating Interest Coverage",  # float("-inf")
    50: "Stable Interest Coverage",  # 0
    40: "Improving Interest Coverage",  # float("inf")
}

net_profitability_assessment_grade_description = {
    99: "Huge loss",  # float("-inf")
    90: "Substantial loss",  # -0.05
    79: "Significant loss",  # 0
    69: "Loss",  # 0.005
    59: "Low Profitability",  # 0.025
    49: "Acceptable Profitability",  # 0.05
    44: "Good Profitability",  # 0.1
    39: "High Profitability",  # 0.15
    29: "Very high Profitability",  # 0.3
    19: "Extremely high Profitability",  # float("inf")
}

debt_to_assets_assessment_grade_description = {
    87: "Extremely high Debt-to-Assets ratio",  # 0.9
    78: "Very high Debt-to-Assets ratio",  # 0.7
    74: "Drop in total assets by more than 50%",
    # company_report_for_period["total_assets_dynamic"] and company_report_for_period["total_assets_dynamic"] < -0.50
    69: "High Debt-to-Assets ratio",  # 0.6
    58: "Relatively high Debt-to-Assets ratio",  # 0.5
    49: "Adequate Debt-to-Assets ratio",  # 0.4
    39: "Relatively low Debt-to-Assets ratio",  # 0.3
    29: "Low Debt-to-Assets ratio",  # 0.1
    25: "Very low Debt-to-Assets",  # 0
    17: "Negative Debt(!)",  # float("-inf")
}

ccc_assessment_grade_description = {
    17: "Very good Cash Conversion Cycle",  # float("-inf")
    19: "Very quick Cash Conversion Cycle",  # 0
    29: "Quick Cash Conversion Cycle",  # 10
    39: "Acceptable Cash Conversion Cycle",  # 30
    49: "Relatively slow Cash Conversion Cycle",  # 60
    59: "Slow Cash Conversion Cycle",  # 90
    69: "Very slow Cash Conversion Cycle",  # 120
    79: "Extremely slow Cash Conversion Cycle",  # 150  # TODO (???) slow -> long(?)
}

revenue_assessment_grade_description = {
    90: "No Revenue",  # 0
    84: "Very small Revenue",  # 100_000
    80: "Very small Revenue",  # 1_000_000
    74: "Small Revenue",  # 10_000_000
    64: "Relatively small Revenue",  # 30_000_000
    54: "Medium size Revenue",  # 70_000_000
    44: "Relatively large Revenue",  # 100_000_000
    39: "Large Revenue",  # 250_000_000
    34: "Large Revenue",  # 500_000_000
    24: "Very large Revenue",  # 1_000_000_000
    14: "Very large Revenue",  # 10_000_000_000
    10: "Huge Revenue",  # float("inf")
}

revenue_dynamic_assessment_grade_description = {
    99: "Revenue collapse",  # float("-inf")
    96: "Revenue collapse",  # -0.50
    90: "Revenue plummeted",  # -0.3
    79: "Revenue Droped",  # -0.1
    69: "Stagnant Revenue",  # -0.02
    59: "Modest Revenue growth",  # 0.02
    49: "Small Revenue growth",  # 0.1
    39: "Healthy Revenue growth",  # 0.2
    27: "Strong Revenue growth",  # 0.4
    17: "Very strong Revenue growth",  # 0.5
    10: "Revenue skyrocketed",  # float("inf")
}

debt_to_EBIT_assessment_grade_description = {
    24: "No Debt",  # 0
    39: "Very low Debt-to-EBIT",  # 0.5
    49: "Low Debt-to-EBIT",  # 2
    59: "Acceptable Debt-to-EBIT",  # 3
    69: "Relatively high Debt-to-EBIT",  # 4
    79: "High Debt-to-EBIT",  # 6
    89: "Very high Debt-to-EBIT",  # 7
}

age_assessment_grade_description = {
    69: "Recently registered business",  # 0
    60: "New company",  # 1
    49: "Young business",  # 3
    39: "Established business",  # 8
    29: "Old company",  # 20
    19: "Old company",  # 19
}

# ______________________________________________________________________________________________________________________

debt_to_equity_assessment_comment = {
    float("-inf"): "negative",
    0: "low level",
    0.000001: "low level",
    0.25: "low level",
    0.5: "low level",
    1: "moderate level",
    2: "moderate level",
    2.4: "acceptable level",
    3: "high level",
    4: "high level",
    5: "very high level",
}

equity_ratio_assessment_comment = {
    float("-inf"): "negative",
    0: "low level",
    0.15: "low level",
    0.30: "moderate level",
    0.40: "acceptable level",
    0.55: "high level",
    0.65: "high level",
    0.75: "high level",
    0.80: "high level",
}

current_ratio_assessment_comment = {
    float("-inf"): "negative",
    0: "very low level",
    0.5: "low level",
    1.0: "medium level",
    2: "high level",
}

interest_coverage_assessment_comment = {
    float("-inf"): "negative",
    0: "low level",
    0.5: "low level",
    1: "low level",
    2: "low level",
    3: "moderate level",
    4: "high level",
    6: "very high level",
}

# interest_coverage_dynamic_assessment_comment = {  # TODO пока не задействуется
#     float("-inf"): "",  # negative
#     0: "",       # neutral
#     float("inf"): "",   # positive
# }

net_profitability_assessment_comment = {
    float("-inf"): "negative",
    0: "low level",
    0.005: "low level",
    0.025: "low level",
    0.05: "moderate level",
    0.1: "moderate level",
    0.15: "high level",
    0.3: "very high level",
    float("inf"): "very high level"
}

# total_assets_dynamic_assessment_comment = {  # TODO пока не задействуется
#     float("-inf"): "",
#     -0.99: "",
#     -0.50: "",
#     -0.30: "",
#     0: "",
# }

debt_to_assets_assessment_comment = {
    float("-inf"): "negative",
    0: "low level",
    0.1: "low level",
    0.3: "low level",
    0.4: "moderate level",
    0.5: "high level",
    0.6: "high level",
    0.7: "very high level",
    0.9: "very high level",
}

ccc_assessment_comment = {
    float("-inf"): "negative",
    0: "very short",
    10: "very short",
    30: "short",
    60: "average",
    90: "long",
    120: "very long",
    150: "very long",
}

revenue_assessment_comment = {
    0: "negative",
    100_000: "very small",
    1_000_000: "very small",
    10_000_000: "small",
    30_000_000: "small",
    70_000_000: "medium",
    100_000_000: "medium",
    250_000_000: "large",
    500_000_000: "large",
    1_000_000_000: "very large",
    10_000_000_000: "very large",
    float("inf"): "very large",
}

revenue_dynamic_assessment_comment = {
    float("-inf"): "drop",
    -0.50: "drop",
    -0.3: "drop",
    -0.1: "drop",
    -0.02: "decline",
    0.02: "stagnation",
    0.1: "modest",
    0.2: "medium",
    0.4: "high",
    0.5: "very high",
    float("inf"): "very high",
}

debt_to_EBIT_assessment_comment = {
    0: "negative",
    0.5: "very low",
    2: "low",
    3: "acceptable",
    4: "high",
    6: "high",
    7: "very high",
}

age_assessment_comment = {
    0: "new established",
    1: "new established",
    3: "young",
    8: "average",
    20: "long established",
    float("inf"): "mature",
}


# FUNC
def categorize_cases(cases_dict: Dict[str, Any], year_filter: str) -> Dict[str, Any]:
    result = {}
    
    for case_id, case_data in cases_dict.items():
        year = case_data['date'].split('-')[0]
        
        if year != year_filter:
            continue
        
        participant_type = case_data['participant_type']
        
        
        if participant_type not in result:
            result[participant_type] = {}
        
        result[participant_type][case_data['number']] = case_data["amount"]
    
    return result
