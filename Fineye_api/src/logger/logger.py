import datetime
import pickle
from typing import Dict
import zlib

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from .models import EndpointLog
from connection_manager import async_session_maker
from src.users.models import Token
from src.utils.constants.logger.mapping import LOG_TYPE_MAPPING, ENDPOINT_MAPPING
from utils.constants.logger.schemas import EndpointKey, LogScheme



def compress_dict(data: Dict) -> bytes:
    serialized_data = pickle.dumps(data)  # Сериализация словаря в байты
    compressed_data = zlib.compress(serialized_data)  # Сжатие сериализованных данных
    return compressed_data

def decompress_dict(compressed_data: bytes) -> Dict:
    serialized_data = zlib.decompress(compressed_data)  # Распаковка сжатых данных
    data: Dict = pickle.loads(serialized_data)  # Десериализация байтов обратно в словарь
    return data

async def create_log(token: str, endpoint: EndpointKey, uuid: str) -> int: # type: ignore
    async with async_session_maker() as session:
        query = select(Token).where(Token.value == token)
        query_result = await session.execute(query)
        data_query_result = query_result.one_or_none()
        token_id = data_query_result[0].id
        data: Dict = {
            "token_id": token_id,
            "endpoint_id": list(ENDPOINT_MAPPING.keys()).index(endpoint) + 1,
            "log_type_id": LOG_TYPE_MAPPING["info"],
            "uuid": uuid,
        }
        stmt_log = insert(EndpointLog).values(**data).returning(EndpointLog.id)
        
        stmt_log_result = await session.execute(stmt_log)
        data_from_stmt_log_result = stmt_log_result.one_or_none()
        log_id: int = data_from_stmt_log_result[0]
        await session.commit()
                
        return log_id

async def update_log(id: int, log: LogScheme) -> None:
    log_type_id = log.log_type
    message = log.message
    status = log.status
    if log.data and isinstance(log.data, dict):
        data = compress_dict(log.data)
    else:
        data = None
        
    updated_data: Dict = {
        "log_type_id": log_type_id,
        "message": message,
        "data": data,
        "status": status,
        "responded_at": datetime.datetime.now(datetime.UTC)
    }
    async with async_session_maker() as session:
        stmt = update(EndpointLog).where(EndpointLog.id == id).values(**updated_data)
        await session.execute(stmt)
        await session.commit()
