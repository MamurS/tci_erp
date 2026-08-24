import asyncio
import json
import os
import traceback
from typing import Any, Dict, Optional

import aio_pika

from src.mapping import COUNTRY_MAPPING
from src.app import Fineye
from src.config import (
    rabbit_user, rabbit_pass, rabbit_host, rabbit_port,
)
from service_logger.app import Log
from .amqp_connection_controller import AMQPConnector




class RPC:
    @staticmethod
    async def on_request(
        request_uuid: str,
        file_uuid: str,
        country: int,
        identifier: str,
        currency: str,
        data: Dict[str, Any],
        with_court_cases: Optional[bool],
        count_not_active: Optional[int]=None,
        queue_name: Optional[str]=None,
        language: str="English",
    ) -> None:
        try:
            await Fineye(
                data=data,
                with_court_cases=True if with_court_cases else False,
                count_not_active=count_not_active,
                country=list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(country)],
                identifier=identifier,
                currency=currency,
                language=language,
                request_uuid=request_uuid,
                file_uuid=file_uuid,
                queue_name=queue_name,
            ).start()
            if queue_name:
                try:
                    await RPC.response(
                        queue_name=queue_name,
                        message=f"Отчет по запросу - {request_uuid} готов.",
                        status=True,
                        request_uuid=request_uuid,
                        data={"file_uuid": file_uuid},
                    )
                except Exception as e:
                    print(e)
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            # print(log_content)
            if queue_name:
                try:
                    await RPC.response(
                        queue_name=queue_name,
                        message=f"Ошибка в запросе - {request_uuid}.",
                        status=False,
                        request_uuid=request_uuid,
                        data={"error": e}
                    )
                except Exception as e:
                    print(e)
            await Log.add_log(
                log_type="error",
                request_uuid=request_uuid,
                message=f"Ошибка при обработке запроса:\nuuid: {request_uuid}\n{log_content}."
            )
    
    @staticmethod
    async def consume():
        while True:
            try:
                print(f"Worker {os.getpid()} connecting to RabbitMQ...")
                connection = await aio_pika.connect_robust(
                    f"amqp://{rabbit_user}:{rabbit_pass}@{rabbit_host}:{rabbit_port}/",
                    client_properties={"connection_name": f"worker_{os.getpid()}"}
                )
                
                async with connection:
                    channel = await connection.channel()
                    # Увеличьте или уберите prefetch_count для параллельной обработки
                    await channel.set_qos(prefetch_count=10)  
                    
                    exchange = await channel.get_exchange("fineye_exchange")
                    queue = await channel.declare_queue(
                        "fineye_pro",
                        durable=True,
                        arguments={
                            'x-message-ttl': 86400000,
                            'x-dead-letter-exchange': 'fineye_dlx',
                            'x-dead-letter-routing-key': 'fineye_dlq'
                        }
                    )
                    await queue.bind(exchange, routing_key="fineye_pro")
                    
                    print(f"Worker {os.getpid()} started and waiting for messages...")
                    async with queue.iterator() as queue_iter:
                        async for message in queue_iter:
                            try:
                                body = json.loads(message.body.decode())
                                await RPC.on_request(
                                    request_uuid=body.get("uuid"),
                                    file_uuid=body.get("file_uuid"),
                                    country=body.get("country"),
                                    identifier=body.get("identifier"),
                                    currency=body.get("currency"),
                                    data=body.get("data"),
                                    with_court_cases=body.get("with_court_cases"),
                                    count_not_active=body.get("count_not_active"),
                                    queue_name=body.get("queue_name"),
                                    language=body.get("language"),
                                )
                                await message.ack()
                            except Exception as e:
                                print(f"Error processing message: {str(e)}")
                                await message.nack(requeue=False)
                                await asyncio.sleep(1)
            except Exception as e:
                print(f"Connection error: {str(e)}. Reconnecting in 5 seconds...")
                await asyncio.sleep(5)
    
    @staticmethod
    async def response(queue_name: str, message: str, status: bool, request_uuid: str, data: Optional[Dict]=None, ) -> None:
        async with AMQPConnector.get_async_amqp_connection() as connection:
            channel = await connection.channel()
            await channel.default_exchange.publish(
                aio_pika.Message(body=json.dumps(
                    {
                        "status": status,
                        "msg": message,
                        "data": data,
                        "request_uuid": request_uuid,
                    }
                ).encode()),
                routing_key=queue_name,
            )
