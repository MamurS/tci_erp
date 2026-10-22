from typing import Literal, Optional, Any

from pydantic import BaseModel

from service_logger.constants.mapping import LOG_TYPE_FOR_KEYS



LogTypeKey: type = Literal[*LOG_TYPE_FOR_KEYS] # type: ignore

class LogScheme(BaseModel):
    log_type: LogTypeKey # type: ignore
    message: Optional[str]
    status: bool
    data: Optional[Any]