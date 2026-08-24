from datetime import date, datetime
from decimal import Decimal


def convert_dates_to_strings(data):
    if isinstance(data, dict):
        return {key: convert_dates_to_strings(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [convert_dates_to_strings(element) for element in data]
    elif isinstance(data, (datetime, date)):
        return data.isoformat()
    else:
        return data

def convert_decimal_to_float(data):
    if isinstance(data, dict):
        return {key: convert_decimal_to_float(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [convert_decimal_to_float(element) for element in data]
    elif isinstance(data, Decimal):
        return data.__float__()
    else:
        return data
