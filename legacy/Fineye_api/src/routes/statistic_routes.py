import datetime
import traceback
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import Depends
from fastapi.routing import APIRouter

from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from connection_manager import get_async_session

from src.schema import ResponseScheme

from src.logger.models import Endpoint, EndpointLog
from src.users.models import Contract, User, Token

from src.utils.constants.users.schemas import TokenScheme
from utils.constants.logger.schemas import LogScheme
from src.utils.constants.logger.mapping import LOG_TYPE_MAPPING
from src.utils.queries_and_statements import Query as Q
from src.logger.logger import create_log, update_log

router = APIRouter(
    tags=["Statistic"],
)


@router.post("/get_activity_statistics", dependencies=[Depends(Q.get_current_token),])
async def get_activity_statistics(
    contract_uuid: str,
    token: TokenScheme = Depends(Q.get_current_token),
    session: AsyncSession = Depends(get_async_session),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="get_activity_statistics", uuid=request_uuid)
    try:
        assert contract_uuid and len(contract_uuid) == 36, f"Указан некорректный идентификатор контракта - {contract_uuid}."
        
        subquery = (
            select(Token.id)
            .join(User, User.id == Token.user_id)
            .join(Contract, Contract.id == User.contract_id)
            .where(Contract.uuid == contract_uuid)
            .scalar_subquery()
        )
        conditions = [EndpointLog.token_id.in_(subquery)]
        
        from_date = None
        to_date = None
        
        if date_from and date_to:
            try:
                # Парсим даты (добавляем время, если его нет)
                from_date = datetime.datetime.strptime(
                    date_from + " 00:00:00" if len(date_from) < 12 else date_from, 
                    "%d.%m.%Y %H:%M:%S"
                )
                to_date = datetime.datetime.strptime(
                    date_to + " 23:59:59" if len(date_to) < 12 else date_to, 
                    "%d.%m.%Y %H:%M:%S"
                )
                
                
                # Добавляем 3 часа для перевода в московское время
                from_date += datetime.timedelta(hours=3)
                to_date += datetime.timedelta(hours=3)
                
                if from_date > to_date:
                    raise ValueError("Дата начала периода не может быть позже даты окончания")
                    
            except ValueError as e:
                raise ValueError(f"Некорректный формат даты. Ожидается ДД.ММ.ГГГГ [ЧЧ:ММ:СС]: {e}")
        
        if from_date and to_date:
            conditions.extend([
                EndpointLog.requested_at >= from_date,
                EndpointLog.requested_at < to_date,
            ])
        main_query = (
            select(
                Token.value,
                Endpoint.name,
                EndpointLog.status,
                func.count().label('request_count')
            )
            .select_from(EndpointLog)  # Явно указываем начальную таблицу
            .join(Token, Token.id == EndpointLog.token_id)
            .join(Endpoint, Endpoint.id == EndpointLog.endpoint_id)
            .where(and_(*conditions))
            .group_by(Token.value, Endpoint.name, EndpointLog.endpoint_id, EndpointLog.status)
        )
        
        result = await session.execute(main_query)
        
        data: Dict[str, Any] = {}
        
        for row in result:
            token = row.value
            endpoint_name = row.name
            status = row.status
            count = row.request_count
            
            if not data.get(token):
                data[token] = {}
            if not data[token].get(endpoint_name):
                data[token][endpoint_name] = {
                    "successfully": 0,
                    "failed": 0,
                }
            if status:
                data[token][endpoint_name]["successfully"] = count
            else:
                data[token][endpoint_name]["failed"] = count
        
        response = ResponseScheme(
            status=True,
            msg=f"success: статистические данные по контракту - {contract_uuid} подготовлены.",
            data=data,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["info"],
                message=response.msg,
                status=response.status,
                data=response.data,
            ),
        )
        
        return response
        
    except Exception as e:
        error_message = str(e)
        formatted_traceback = traceback.format_exc()
        log_content = f"{error_message}\n{formatted_traceback}"
        print(log_content)
        response = ResponseScheme(
            status=False,
            msg=f"error: {e}",
            data=None,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["error"],
                message=f"error: {log_content}",
                status=response.status,
                data=response.data,
            ),
        )
        return response

@router.post("/get_service_log")
async def get_service_log(
    uuid: Optional[str] = None,
    limit: Optional[int] = None,
    
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="get_service_log", uuid=request_uuid)
    try:
        log_objects = await Q.get_service_log(uuid=uuid, limit=limit)
        data = []
        print(log_objects)
        for log_object in log_objects:
            data.append(log_object.message + "\n")
        
        response = ResponseScheme(
            status=True,
            msg="success: Логи получены.",
            data=data,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["info"],
                message="success: Логи получены.",
                status=True,
                data=data,
            ),
        )
    except Exception as e:
        error_message = str(e)
        formatted_traceback = traceback.format_exc()
        log_content = f"{error_message}\n{formatted_traceback}"
        print(log_content)
        response = ResponseScheme(
            status=False,
            msg=f"error: {e}",
            data=None,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["error"],
                message=f"error: {log_content}",
                status=response.status,
                data=response.data,
            ),
        )
    return response

@router.post("/get_endpoint_log")
async def get_endpoint_log(
    uuid: Optional[str] = None,
    limit: Optional[int] = None,
    
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="get_endpoint_log", uuid=request_uuid)
    try:
        log_objects = await Q.get_endpoint_log(uuid=uuid, limit=limit)
        data = []
        for log_object in log_objects:
            data.append(log_object.message + "\n")
        
        response = ResponseScheme(
            status=True,
            msg="success: Логи получены.",
            data=data,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["info"],
                message="success: Логи получены.",
                status=True,
                data=data,
            ),
        )
    except Exception as e:
        error_message = str(e)
        formatted_traceback = traceback.format_exc()
        log_content = f"{error_message}\n{formatted_traceback}"
        print(log_content)
        response = ResponseScheme(
            status=False,
            msg=f"error: {e}",
            data=None,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["error"],
                message=f"error: {log_content}",
                status=response.status,
                data=response.data,
            ),
        )
    return response

@router.post("/get_request_execution_time")
async def get_request_execution_time(
    uuid: Optional[str] = None,
    
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    try:
        time_intervals: Dict[str, datetime.timedelta] = await Q.get_request_execution_time(uuid=uuid, )
        if not time_intervals.get("warning"):
            response = ResponseScheme(
                status=True,
                msg="success.",
                data=time_intervals,
                request_uuid=request_uuid,
            )
        else:
            response = ResponseScheme(
                status=True,
                msg=f"success: {time_intervals.get("warning")}",
                data=time_intervals,
                request_uuid=request_uuid,
            )
    except Exception as e:
        error_message = str(e)
        formatted_traceback = traceback.format_exc()
        log_content = f"{error_message}\n{formatted_traceback}"
        print(log_content)
        response = ResponseScheme(
            status=False,
            msg=f"error: {e}",
            data=None,
            request_uuid=request_uuid,
        )
    
    return response
