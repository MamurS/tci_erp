
import json
import os
import sys
from typing import AsyncGenerator

import aioredis
from fastapi.concurrency import asynccontextmanager

from src.config import redis_pass, redis_host, redis_port
from .constants.users.schemas import TokenScheme

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)
from schema import AMQPConnectionScheme  # noqa: E402



class RedisConnector:
    DSN_CONN = f"redis://:{redis_pass}@{redis_host}:{redis_port}/1"
    DSN_CACHE = f"redis://:{redis_pass}@{redis_host}:{redis_port}/2"

    @asynccontextmanager
    @staticmethod
    async def get_async_redis_session() -> AsyncGenerator[aioredis.Redis, None]:
        redis_pool = await aioredis.create_redis_pool(RedisConnector.DSN_CONN)  # Создаем пул соединений Redis
        try:
            yield redis_pool
        finally:  # Закрываем пул соединений Redis
            redis_pool.close()
            await redis_pool.wait_closed()
    
    @staticmethod
    async def check_connection(token: TokenScheme, amqp_connect: AMQPConnectionScheme):
        async with RedisConnector.get_async_redis_session() as redis_conn:
            if await redis_conn.exists(token.value):
                amqp_data = await redis_conn.get(token.value)
                assert amqp_data, "Требуется создать amqp подключение."
                decode_amqp_data = json.loads(amqp_data.decode())
                assert (
                    amqp_connect.username == decode_amqp_data.get("username") and
                    amqp_connect.password == decode_amqp_data.get("password") and
                    amqp_connect.queuename == decode_amqp_data.get("queuename")
                ), "Не действующее amqp соединение, требуется новое подключение."
            else:
                raise AssertionError("Требуется создать amqp подключение.")