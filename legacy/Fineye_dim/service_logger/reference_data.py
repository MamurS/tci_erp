import datetime
from typing import List, Tuple


SERVICE: List[Tuple] = [
    (1, "dim", 100.00, datetime.datetime.now(datetime.UTC).date(), None, "Service for placing data in a data warehouse"),
    (2, "fineye", 1000.00, datetime.datetime.now(datetime.UTC).date(), None, "Service for obtaining a financial report about a company/group"),
]

LOG_TYPE: List[Tuple] = [
    (1, "info"),
    (2, "warning"),
    (3, "error"),
]
