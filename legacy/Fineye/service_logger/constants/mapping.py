from typing import Dict, List


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