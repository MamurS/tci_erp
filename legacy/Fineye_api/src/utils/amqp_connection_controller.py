from contextlib import asynccontextmanager
import json
from typing import AsyncGenerator
from uuid import uuid4

import aiohttp
import aio_pika
from aio_pika.abc import AbstractRobustConnection
from aioredis import Redis

from src.config import (
    rabbit_user, rabbit_pass, rabbit_host, rabbit_port, rabbit_port_http,
)

class AMQPConnector:
    DSN = f"amqp://{rabbit_user}:{rabbit_pass}@{rabbit_host}:{rabbit_port}/"
    BASE_URL = f'http://{rabbit_host}:{rabbit_port_http}/api/'

    @staticmethod
    def create_username_password_queuename(token: str):
        if token:
            additional_complexity = token[:int(len(token) / 2)]
            username = (str(uuid4()) + "_" + additional_complexity).replace("-", "_")
            password = (str(uuid4()) + "_" + additional_complexity).replace("-", "_")
            queuename = (str(uuid4()) + "_" + additional_complexity).replace("-", "_")
            
            return username, password, queuename
        else:
            return None, None, None
    
    @asynccontextmanager
    @staticmethod
    async def get_async_amqp_connection() -> AsyncGenerator[AbstractRobustConnection, None]:
        connection = await aio_pika.connect_robust(AMQPConnector.DSN)
        try:
            yield connection
        finally:
            await connection.close()
    
    @asynccontextmanager
    @staticmethod
    async def __get_aiohttp_session_with_rabbit_auth():
        auth = aiohttp.BasicAuth(login=rabbit_user, password=rabbit_pass)
        async with aiohttp.ClientSession(auth=auth) as session:
            try:
                yield session
            finally:
                await session.close()
    
    @staticmethod
    async def __create_user(username: str, password: str) -> bool:
        url = AMQPConnector.BASE_URL + f"users/{username}"
        async with AMQPConnector.__get_aiohttp_session_with_rabbit_auth() as session:
            async with session.put(url, json={"password": password, "tags": "user"}) as response:
                if response.status in range(200, 300):
                    print("Пользователь успешно создан")
                    return True
                else:
                    error_message = await response.text()
                    print(f"Ошибка при создании пользователя: {error_message}")
                    return False       

    @staticmethod
    async def __create_queue(queuename: str) -> bool:
        url = AMQPConnector.BASE_URL + f"queues/%2F/{queuename}"
        async with AMQPConnector.__get_aiohttp_session_with_rabbit_auth() as session:
            async with session.put(url, json={}) as response:
                if response.status in range(200, 300):
                    print(f"Очередь {queuename} успешно создана")
                    return True
                else:
                    error_message = await response.text()
                    print(f"Ошибка при создании очереди {queuename}: {error_message}")
                    return False

    @staticmethod
    async def __set_read_only_permissions(username: str, queuename: str) -> bool:
        url = AMQPConnector.BASE_URL + f"permissions/%2F/{username}"
        async with AMQPConnector.__get_aiohttp_session_with_rabbit_auth() as session:
            async with session.put(url, json={
                "configure": "^$",
                "write": "^$",
                "read": f"^{queuename}$"
            }) as response:
                if response.status in range(200, 300):
                    print("Права только на чтение успешно установлены")
                    return True
                else:
                    print(response.status)
                    error_message = await response.text()
                    print(f"Ошибка при настройке прав: {error_message}")
                    return False
    
    @staticmethod
    async def __delete_user( username: str) -> bool:
        url = AMQPConnector.BASE_URL + f"users/{username}"
        async with AMQPConnector.__get_aiohttp_session_with_rabbit_auth() as session:
            async with session.delete(url) as response:
                if response.status in range(200, 300):
                    print(f"Пользователь {username} успешно удален")
                    return True
                else:
                    error_message = await response.text()
                    print(f"Ошибка при удалении пользователя {username}: {error_message}")
                    return False
    
    @staticmethod
    async def __delete_queue(queuename: str) -> bool:
        url = AMQPConnector.BASE_URL + f"queues/%2F/{queuename}"
        async with AMQPConnector.__get_aiohttp_session_with_rabbit_auth() as session:
            async with session.delete(url) as response:
                if response.status in range(200, 300):
                    print(f"Очередь {queuename} успешно удалена")
                    return True
                else:
                    error_message = await response.text()
                    print(f"Ошибка при удалении очереди {queuename}: {error_message}")
                    return False
    
    @staticmethod
    async def __save_user_in_redis(redis: Redis, token: str, user_data: dict) -> bool:
        """Сохраняет данные пользователя в Redis."""
        try:
            await redis.set(token, json.dumps(user_data))
            
            return True
        except Exception as e:
            print(e)
            return False

    @staticmethod
    async def __remove_user_from_redis(redis: Redis, token: str) -> bool:
        """Удаляет пользователя из Redis."""
        try:
            await redis.delete(token)
            
            return True
        except Exception as e:
            print(e)
            return False
        
    @classmethod
    async def _cleanup_connection(cls, username: str, queuename: str) -> bool:
        try:
            delete_user_status: bool = await cls.__delete_user(username=username)
            delete_queue_status: bool = await cls.__delete_queue(queuename=queuename)
            assert delete_user_status and delete_queue_status, f"Не удалось очистить пользователя - {username} в rabbitMQ."
            
            return True
        except Exception as e:
            print(e)
            return False
    
    @classmethod
    async def create_connection(cls, redis: Redis, token: str, username: str, password: str, queuename: str,) -> bool:
        try:
            create_user_status: bool = await cls.__create_user(username=username, password=password)
            create_queue_status: bool = await cls.__create_queue(queuename=queuename)
            set_permissons_status: bool = await cls.__set_read_only_permissions(username=username, queuename=queuename)
            assert create_user_status and create_queue_status and set_permissons_status, f"Не удалось создать соединение для - {token}."
            save_user_in_redis_status: bool = await cls.__save_user_in_redis(redis=redis, token=token, user_data={
                "username": username,
                "queuename": queuename,
                "password": password,
            })
            assert save_user_in_redis_status, f"Не удалось сохранить соединение для пользователя - {token} в redis."
            
            return True
        except Exception as e:
            print(e)
            return False
    
    @classmethod
    async def delete_connection(cls, redis: Redis, token: str, username: str, queuename: str) -> bool:
        """Очищает данные пользователя, удаляя его из RabbitMQ и Redis."""
        try:
            delete_status: bool = await cls._cleanup_connection(username=username, queuename=queuename)
            remove_user_from_redis_status: bool = await cls.__remove_user_from_redis(redis=redis, token=token)
            assert delete_status, f"Не удалось удалить соединение для пользователя {token}"
            assert remove_user_from_redis_status, f"Не удалось удалить пользователя - {token} из redis"
            
            return True
        except Exception as e:
            print(e)
            return False
