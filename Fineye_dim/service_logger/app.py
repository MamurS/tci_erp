from typing import Optional
from sqlalchemy import insert

from src.database import get_async_session
from .models import ServiceLog
from .constants.mapping import SERVICE_MAPPING, LOG_TYPE_MAPPING
from .constants.schemas import LogTypeKey

class Log:
    @staticmethod
    async def add_log(request_uuid: str, log_type: LogTypeKey, message: Optional[str]): # type: ignore
        async with get_async_session() as session:
            stmt = insert(ServiceLog).values(
                service_id=SERVICE_MAPPING["dim"],
                log_type_id=LOG_TYPE_MAPPING[log_type],
                uuid=request_uuid,
                message=message,
            )
            await session.execute(stmt)
            await session.commit()