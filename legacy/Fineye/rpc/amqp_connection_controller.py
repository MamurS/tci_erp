from contextlib import asynccontextmanager
from typing import AsyncGenerator

import aio_pika
from aio_pika.abc import AbstractRobustConnection

from src.config import (
    rabbit_user, rabbit_pass, rabbit_host, rabbit_port, rabbit_port_http,
)

class AMQPConnector:
    DSN = f"amqp://{rabbit_user}:{rabbit_pass}@{rabbit_host}:{rabbit_port}/"
    BASE_URL = f'http://{rabbit_host}:{rabbit_port_http}/api/'
    
    @asynccontextmanager
    @staticmethod
    async def get_async_amqp_connection() -> AsyncGenerator[AbstractRobustConnection, None]:
        connection = await aio_pika.connect_robust(AMQPConnector.DSN)
        try:
            yield connection
        finally:
            await connection.close()
