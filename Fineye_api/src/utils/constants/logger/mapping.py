from typing import Dict, List


# ______________________________________________________________________
ENDPOINT_MAPPING: Dict[str, int] = {
    "get_amqp_connection": 1,
    "delete_amqp_connection": 2,
    "prepare_information": 3,
    "get_information": 4,
    "prepare_report": 5,
    "get_file": 6,
    "manual_input": 7,
    "get_activity_statistics": 8,
    "get_exchange_rate": 9,
    "get_service_log": 10,
    "get_endpoint_log": 11,
}

ENDPOINT_FOR_KEYS: List[int] = list(range(1, 12))
# ______________________________________________________________________
SERVICE_MAPPING: Dict[str, int] = {
    "dim": 1,
    "fineye": 2,
}

SERVICE_FOR_KEYS: List[int] = list(range(1, 3))
# ______________________________________________________________________
LOG_TYPE_MAPPING: Dict[str, int] = {
    "info": 1,
    "warning": 2,
    "error": 3,
}

LOG_TYPE_FOR_KEYS: List[int] = list(range(1, 4))
# ______________________________________________________________________