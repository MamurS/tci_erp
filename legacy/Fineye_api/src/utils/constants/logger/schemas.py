from typing import Literal, Optional, Any

from pydantic import BaseModel

from src.utils.constants.logger.mapping import ENDPOINT_FOR_KEYS, LOG_TYPE_FOR_KEYS

LogTypeKey: type = Literal[*LOG_TYPE_FOR_KEYS] # type: ignore
EndpointKey: type = Literal[*ENDPOINT_FOR_KEYS] # type: ignore

class LogScheme(BaseModel):
    log_type: LogTypeKey # type: ignore
    message: Optional[str]
    status: bool
    data: Optional[Any]
