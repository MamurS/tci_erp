from abc import ABC

from .amqp_connection_controller import AMQPConnector

class RPC(ABC):
    @staticmethod
    async def on_request(request):
        pass
    
    @staticmethod
    async def consume():
        async with AMQPConnector.get_async_amqp_connection() as connection:
            channel = await connection.channel()  # Создаем канал
            queue = await channel.declare_queue("data_insertion_modules", passive=True, durable=True)  # Объявляем очередь, если её нет

            async with queue.iterator() as queue_iter:
                async for request in queue_iter:
                    await RPC.on_request(request=request)
