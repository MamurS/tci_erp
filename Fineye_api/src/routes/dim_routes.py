import json
import traceback
from typing import Any, Dict
from uuid import uuid4

import aio_pika

from fastapi import Depends
from fastapi.routing import APIRouter

from src.schema import (
    ResponseScheme,
    AMQPConnectionScheme,
    PrepareInformationScheme,
)

from src.utils.constants.users.schemas import TokenScheme
from utils.constants.logger.schemas import LogScheme
from src.utils.constants.logger.mapping import LOG_TYPE_MAPPING
from src.utils.queries_and_statements import Query as Q
from src.utils.amqp_connection_controller import AMQPConnector
from src.utils.redis_connection_controller import RedisConnector
from src.logger.logger import create_log, update_log


router = APIRouter(
    tags=["DIM"],
)

@router.post("/prepare_information")
async def prepare_data(
    amqp_connect: AMQPConnectionScheme,
    request: PrepareInformationScheme,
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="prepare_information", uuid=request_uuid)
    request_dict: Dict[str, Any] = request.model_dump()
    try:
        await RedisConnector.check_connection(token=token, amqp_connect=amqp_connect)
        
        async with AMQPConnector.get_async_amqp_connection() as connection:
            channel = await connection.channel()
            exchange = await channel.get_exchange("fineye_dim_exchange")
            
            
            message = aio_pika.Message(
                body=json.dumps(
                    {
                        **request_dict,
                        "uuid": request_uuid,
                        "queue_name": amqp_connect.queuename,
                    }
                ).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,  # Сообщение сохраняется на диск
                expiration=86400000  # TTL сообщения 24 часа
            )
            await exchange.publish(
                message,
                routing_key="fineye_dim"
            )
            
        response = ResponseScheme(
            status=True,
            msg="success: запрос поступил в обработку",
            data=None,
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

@router.put("/manual_input", dependencies=[Depends(Q.get_current_token),])
async def manual_input(
    request: PrepareInformationScheme,
    data_from_manual_input_service: Dict[str, Any],
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="manual_input", uuid=request_uuid)
    request_dict: Dict[str, Any] = request.model_dump()
    
    try:
        async with AMQPConnector.get_async_amqp_connection() as connection:
            channel = await connection.channel()
            queue = await channel.declare_queue("data_insertion_modules", durable=True)
            await channel.default_exchange.publish(
                aio_pika.Message(body=json.dumps(
                    {
                        **request_dict,
                        "uuid": request_uuid,
                        "manual_input": True,
                        "data_from_manual_input_service": data_from_manual_input_service,
                    }
                ).encode()),
                routing_key=queue.name,
            )
        response = ResponseScheme(
            status=True,
            msg="success: запрос поступил в обработку",
            data=None,
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
