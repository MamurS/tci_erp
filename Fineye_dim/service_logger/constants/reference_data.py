import datetime
from typing import List, Tuple

ENDPOINT: List[Tuple] = [
    (1, "get_amqp_connection", "Getting an AMQP connection to receive notifications"),
    (2, "delete_amqp_connection", "Removing an AMQP connection"),
    (3, "prepare_information", "Preparation of information about legal entities/individuals and relationships"),
    (4, "get_information", "Obtaining information about legal entities/individuals and relationships"),
    (5, "prepare_report", "Preparation of a report on a legal entity"),
    (6, "get_file", "Receiving a files"),
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
