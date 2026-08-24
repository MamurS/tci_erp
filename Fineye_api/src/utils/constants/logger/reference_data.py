import datetime
from typing import List, Tuple

ENDPOINT: List[Tuple] = [
    (1, "get_amqp_connection", "Getting an AMQP connection to receive notifications"),
    (2, "delete_amqp_connection", "Removing an AMQP connection"),
    (3, "prepare_information", "Preparation of information about legal entities/individuals and relationships"),
    (4, "get_information", "Obtaining information about legal entities/individuals and relationships"),
    (5, "prepare_report", "Preparation of a report on a legal entity"),
    (6, "get_file", "Receiving a files"),
    (7, "manual_input", "Entering information using the manual entry module"),
    (8, "get_activity_statistics", "Getting statistics on service usage"),
    (9, "get_exchange_rate", "Get exchange rates from specific banks for specific currency pairs"),
    (10, "get_service_log", "Getting logs from services"),
    (11, "get_endpoint_log", "Getting logs from API"),
]

SERVICE: List[Tuple] = [
    (1, "dim", 100.00, datetime.datetime.now(datetime.UTC).date(), None, "Service for placing data in a data warehouse"),
    (2, "fineye", 1000.00, datetime.datetime.now(datetime.UTC).date(), None, "Service for obtaining a financial report about a company/group"),
]

LOG_TYPE: List[Tuple] = [
    (1, "info"),
    (2, "warning"),
    (3, "error"),
]
