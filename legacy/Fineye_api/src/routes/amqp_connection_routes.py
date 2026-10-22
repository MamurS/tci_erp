import json
import traceback
from uuid import uuid4

from fastapi import Depends
from fastapi import APIRouter

from src.schema import AMQPConnectionScheme, ResponseScheme
from src.utils.constants.users.schemas import TokenScheme
from utils.constants.logger.schemas import LogScheme
from src.utils.constants.logger.mapping import LOG_TYPE_MAPPING
from src.utils.queries_and_statements import Query as Q
from src.utils.amqp_connection_controller import AMQPConnector
from src.utils.redis_connection_controller import RedisConnector
from src.logger.logger import create_log, update_log


router = APIRouter(
    tags=["AMQP Connection"],
)


@router.post("/get_amqp_connection")
async def get_amqp_connection(
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="get_amqp_connection", uuid=request_uuid)
    try:
        async with RedisConnector.get_async_redis_session() as redis_conn:
            if await redis_conn.exists(token.value):
                data_from_redis = await redis_conn.get(token.value)
                old_user_data = json.loads(data_from_redis.decode("utf-8"))
                await AMQPConnector._cleanup_connection(
                    queuename=old_user_data.get("queuename"),
                    username=old_user_data.get("username"),
                )
                
            username, password, queuename = AMQPConnector.create_username_password_queuename(token.value)  # создание токена
            assert username and password and queuename, "Ошибка генерации username, password, queuename - проверьте токен."
            connection_status: bool = await AMQPConnector.create_connection(redis=redis_conn, token=token.value, username=username, password=password, queuename=queuename)
            assert connection_status, f"Не удалось создать подключение для {token.value}"
            response = ResponseScheme(
                status=True,
                msg="success",
                data=AMQPConnectionScheme(
                    username=username,
                    password=password,
                    queuename=queuename,
                ),
                request_uuid=request_uuid,
            )
            await update_log(
                id=log_id,
                log=LogScheme(
                    log_type=LOG_TYPE_MAPPING["info"],
                    message=response.msg,
                    status=response.status,
                    data=response.data.model_dump(),
                ),
            )
            return response
    except Exception as e:
        error_message = str(e)
        formatted_traceback = traceback.format_exc()
        log_content = f"{error_message}\n{formatted_traceback}"
        print(log_content)
        try:
            await AMQPConnector._cleanup_connection(
                queuename=queuename,
                username=username,
            )
        except: pass  # noqa: E722, E701
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

@router.post("/delete_amqp_connection")
async def delete_amqp_connection(
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="delete_amqp_connection", uuid=request_uuid)
    try:
        async with RedisConnector.get_async_redis_session() as redis_conn:
            if await redis_conn.exists(token.value):
                data_from_redis = await redis_conn.get(token.value)
                old_user_data = json.loads(data_from_redis.decode("utf-8"))
                delete_status: bool = await AMQPConnector.delete_connection(
                    redis=redis_conn,
                    token=token.value,
                    queuename=old_user_data.get("queuename"),
                    username=old_user_data.get("username"),
                )
                assert delete_status, f"Не удалось удалить соединение - {old_user_data.get('username')}"
                response = ResponseScheme(
                    status=True,
                    msg=f"success: соединение {old_user_data.get('username')} закрыто",
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
                return response
            else:
                response = ResponseScheme(
                    status=False,
                    msg="error: нет активного соединения",
                    data=None,
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
            msg=f"error: соединение {old_user_data.get('username')} не было закрыто",
            data=None,
            request_uuid=request_uuid,
        )
        await update_log(
                    id=log_id,
                    log=LogScheme(
                        log_type=LOG_TYPE_MAPPING["error"],
                        message=response.msg + f"\n{log_content}",
                        status=response.status,
                        data=response.data,
                    ),
                )
        return response
