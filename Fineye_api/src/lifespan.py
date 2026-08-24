import aio_pika
import aioredis
from fastapi import FastAPI
from fastapi.concurrency import asynccontextmanager
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend


# from service_runners.postgres_runner import PostgresRunner
# from service_runners.rabbitmq_runner import RabbitMQRunner
# from service_runners.redis_runner import RedisRunner

from .config import (
    rabbit_user, rabbit_pass, rabbit_host, rabbit_port,
)

from .data_insertion_module.prepare_reference_data import prepare_reference as prepare_reference_dim
from .users.prepare_reference_data import prepare_reference as prepare_reference_users
from .billing.prepare_reference_data import prepare_reference as prepare_reference_billing
from .fineye.prepare_reference_data import prepare_reference as prepare_reference_fineye
from .logger.prepare_reference_data import prepare_reference as prepare_reference_logger
from .connection_manager import Base, sync_engine_without_bouncer

from src.utils.redis_connection_controller import RedisConnector
from src.utils.create_user import create_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis_conns = aioredis.create_connection(RedisConnector.DSN_CONN)
    redis_cache = aioredis.create_connection(RedisConnector.DSN_CACHE)
    FastAPICache.init(RedisBackend(redis_cache), prefix="fastapi-cache")
    
    # Улучшенное подключение к RabbitMQ с таймаутами и повторными попытками
    connection = await aio_pika.connect_robust(
        f"amqp://{rabbit_user}:{rabbit_pass}@{rabbit_host}:{rabbit_port}/",
        connection_timeout=10,
        client_properties={"connection_name": "fastapi_producer"}
    )
    create_user()
    async with connection:
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=1)
        # await channel.declare_queue("data_insertion_modules", durable=True)
        
        # Объявление обменника и очередей с дополнительными параметрами для отказоустойчивости
        exchange_pro = await channel.declare_exchange(
            "fineye_exchange",
            aio_pika.ExchangeType.DIRECT,
            durable=True,
            auto_delete=False
        )
        exchange_dim = await channel.declare_exchange(
            "fineye_dim_exchange",
            aio_pika.ExchangeType.DIRECT,
            durable=True,
            auto_delete=False
        )
        
        # Очередь для задач
        queue_pro = await channel.declare_queue(
            "fineye_pro",
            durable=True,
            arguments={
                'x-message-ttl': 86400000,  # TTL для сообщений (24 часа)
                'x-dead-letter-exchange': 'fineye_dlx',  # Обменник для мертвых сообщений
                'x-dead-letter-routing-key': 'fineye_dlq'  # Очередь для мертвых сообщений
            }
        )
        queue_dim = await channel.declare_queue(
            "fineye_dim",
            durable=True,
            arguments={
                'x-message-ttl': 86400000,  # TTL для сообщений (24 часа)
                'x-dead-letter-exchange': 'fineye_dim_dlx',  # Обменник для мертвых сообщений
                'x-dead-letter-routing-key': 'fineye_dim_dlq'  # Очередь для мертвых сообщений
            }
        )
        
        # Очередь для мертвых сообщений
        dlx_exchange_pro = await channel.declare_exchange(
            "fineye_dlx",
            aio_pika.ExchangeType.DIRECT,
            durable=True
        )
        dlx_exchange_dim = await channel.declare_exchange(
            "fineye_dim_dlx",
            aio_pika.ExchangeType.DIRECT,
            durable=True
        )
        dlq_pro = await channel.declare_queue("fineye_dlq", durable=True)
        dlq_dim = await channel.declare_queue("fineye_dim_dlq", durable=True)
        await dlq_pro.bind(dlx_exchange_pro, routing_key="fineye_dlq")
        await dlq_dim.bind(dlx_exchange_dim, routing_key="fineye_dim_dlq")
        
        await queue_pro.bind(exchange_pro, routing_key="fineye_pro")
        await queue_dim.bind(exchange_dim, routing_key="fineye_dim")
    
    # Base.metadata.drop_all(sync_engine_without_bouncer)
    Base.metadata.create_all(sync_engine_without_bouncer)
    await prepare_reference_dim()
    await prepare_reference_users()
    await prepare_reference_billing()
    await prepare_reference_fineye()
    await prepare_reference_logger()
    yield
    redis_cache.close()
    redis_conns.close()
# @asynccontextmanager
# async def lifespan(app: FastAPI):
#     redis_conns = aioredis.create_connection(RedisConnector.DSN_CONN)
#     redis_cache = aioredis.create_connection(RedisConnector.DSN_CACHE)
#     FastAPICache.init(RedisBackend(redis_cache), prefix="fastapi-cache")
#     connection = await aio_pika.connect_robust(f"amqp://{rabbit_user}:{rabbit_pass}@{rabbit_host}:{rabbit_port}/")
#     async with connection:
#         channel = await connection.channel()
#         await channel.set_qos(prefetch_count=1)
#         await channel.declare_queue("data_insertion_modules", durable=True)
#         await channel.declare_queue("fineye", durable=True)
#     Base.metadata.create_all(sync_engine_without_bouncer)
#     await prepare_reference_dim()
#     await prepare_reference_users()
#     await prepare_reference_billing()
#     await prepare_reference_fineye()
#     await prepare_reference_logger()
#     yield
#     redis_cache.close()
#     redis_conns.close()
