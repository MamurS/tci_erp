import asyncio
import json
import os
import traceback
from typing import Any, Dict, List, Optional, Tuple

import aio_pika
from sqlalchemy import and_, update

from src.adapters.manual_input.kazakhstan.financial_and_registration_data.kazakhstan_manual_input import KazakhstanManualInputAdapterFinancialAndRegistrationData
from src.adapters.manual_input.mongolia.financial_and_registration_data.mongolia_manual_input import MongoliaManualInputAdapterFinancialAndRegistrationData
from src.adapters.manual_input.uzbekistan.financial_and_registration_data.uzbekistan_manual_input import UzbekistanManualInputAdapterFinancialAndRegistrationData
from src.schemas import CourtCase, DataForInsertionModuleScheme
from src.models import Company
from service_logger.app import Log
from src.app import DIM
from .amqp_connection_controller import AMQPConnector
from src.adapters.api_input.russia.financial_and_registration_data.fns import FNSAdapterFinancialAndRegistrationData
from src.adapters.api_input.russia.group_data.fns import FNSGroupDataAdapter
from src.adapters.api_input.russia.court_cases.checko import CheckoCourtCaseDataAdapter
from src.database import get_async_session



class RPC:
    @staticmethod
    async def on_request(
        request_uuid: str,
        country: int,
        identifier: str,
        with_group: bool,
        with_court_cases: bool,
        tokens: Dict[str, str],
        queue_name: Optional[str] = None,
        manual_input: bool = False,
        data_from_manual_input_service: Optional[Dict[str, Any]] = None,
    ) -> None:
        try:
            await Log.add_log(
                log_type="info",
                request_uuid=request_uuid,
                message=f"Старт обработки запроса:\ncountry: {country};\nidentifier: {identifier};\nwith_group: {with_group};\nwith_court_cases: {with_court_cases}."
            )
            
            match country, with_group, with_court_cases, manual_input:
                
                case 170, False, False, False:
                    data = await FNSAdapterFinancialAndRegistrationData(
                        token=tokens["FNS"],
                        identifier=identifier,
                        request_uuid=request_uuid
                    ).adapt_data()
                    if queue_name:
                        await RPC.response(
                            queue_name=queue_name,
                            message=f"Данные по ЮР лицу {request_uuid} - готовы.",
                            status=True,
                            request_uuid=request_uuid,
                        )
                
                case 170, True, False, False:
                    data = await FNSAdapterFinancialAndRegistrationData(
                        token=tokens["FNS"],
                        identifier=identifier,
                        request_uuid=request_uuid,
                    ).adapt_data()
                    app = DIM(request_uuid=request_uuid, data=data)    
                    await app.insert()
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Сбор идентификаторов ЮР лиц группы:\ncountry: {country};\nidentifier: {identifier}."
                    )
                    
                    group_identifiers: Tuple[str] = await FNSGroupDataAdapter(
                        token=tokens["FNS"],
                        identifier=identifier,
                        request_uuid=request_uuid,
                    ).get_group_identifiers()
                    
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Собраны идентификаторы ЮР лиц группы:\ncountry: {country};\nidentifier: {identifier}\ngroup identifiers: {", ".join(group_identifiers)}."
                    )
                    
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Старт сборки информации о ЮР лицах группы:\ncountry: {country};\nidentifier: {identifier}\ngroup identifiers: {", ".join(group_identifiers)}."
                    )
                    data_to_insert: list[DataForInsertionModuleScheme] = []
                    # print(group_identifiers)
                    for group_identifier in group_identifiers:
                        try:
                            data: DataForInsertionModuleScheme = await FNSAdapterFinancialAndRegistrationData(
                                    token=tokens["FNS"],
                                    identifier=group_identifier,
                                    request_uuid=request_uuid,
                                ).adapt_data()
                            data_to_insert.append(data)
                        except Exception as e:
                            await Log.add_log(
                                log_type="error",
                                request_uuid=request_uuid,
                                message=f"Ошибка при адаптации информации о компании группы:\nidentifier: {group_identifier}\n{e}."
                            )
                    
                    # dim_tasks: List[asyncio.Task] = []
                    for data in data_to_insert:
                        app = DIM(request_uuid=request_uuid, data=data)
                        await app.insert()
                    #     dim_tasks.append(asyncio.create_task(app.insert()))
                    
                    # for chunk in split_list_into_chunks(list_=dim_tasks, chunk_size=2):
                    #     await asyncio.gather(*chunk)
                    await app.update_groups_identifiers()
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Успешная сборка информации о ЮР лицах группы:\ncountry: {country};\nidentifier: {identifier}\ngroup identifiers: {", ".join(group_identifiers)}."
                    )
                    
                    async with get_async_session() as session:
                        stmt = (
                            update(Company)
                            .filter(
                                and_(
                                    Company.country_id == country,
                                    Company.registration_identifier_value == identifier,
                                )
                            )
                            .values({"with_group": True})
                        )
                        await session.execute(stmt)
                        await session.commit()
                    if queue_name:
                        try:
                            await RPC.response(
                                queue_name=queue_name,
                                message=f"Данные по группе ЮР лица {request_uuid} - готовы.",
                                status=True,
                                request_uuid=request_uuid,
                                data={"group_identifiers": group_identifiers}
                            )
                        except Exception as e:
                            print(e)
                
                case 170, False, True, False:
                    data: DataForInsertionModuleScheme = await FNSAdapterFinancialAndRegistrationData(
                        token=tokens["FNS"],
                        identifier=identifier,
                        request_uuid=request_uuid
                    ).adapt_data()
                    
                    
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Сбор судебных дел ЮР лица:\ncountry: {country};\nidentifier: {identifier}."
                    )
                    
                    data.companies_court_cases = {}
                    data.companies_court_cases["company_1"] = []
                    
                    data.company_identifier_type_for_court_case = "tax_identifier"
                    adapted_court_data: List[Optional[CourtCase]] = await CheckoCourtCaseDataAdapter(
                        token=tokens["CHECKO"],
                        identifier=identifier,
                        request_uuid=request_uuid,
                    ).adapt_court_case_data()
                    
                    data.companies_court_cases["company_1"].extend(adapted_court_data)
                    
                    # FIXME ПРОВЕРИТЬ сбор арбитражей ПО 1 КОМПАНИИ
                    if queue_name:
                        await RPC.response(
                            queue_name=queue_name,
                            message=f"Данные по ЮР лицу с судебными делами {request_uuid} - готовы.",
                            status=True,
                            request_uuid=request_uuid,
                        )
                
                case 170, True, True, False:
                    data = await FNSAdapterFinancialAndRegistrationData(
                        token=tokens["FNS"],
                        identifier=identifier,
                        request_uuid=request_uuid,
                    ).adapt_data()
                    app = DIM(request_uuid=request_uuid, data=data)    
                    await app.insert()
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Сбор идентификаторов ЮР лиц группы:\ncountry: {country};\nidentifier: {identifier}."
                    )
                    
                    group_identifiers: Tuple[str] = await FNSGroupDataAdapter(
                        token=tokens["FNS"],
                        identifier=identifier,
                        request_uuid=request_uuid,
                    ).get_group_identifiers()
                    
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Собраны идентификаторы ЮР лиц группы:\ncountry: {country};\nidentifier: {identifier}\ngroup identifiers: {", ".join(group_identifiers)}."
                    )
                    
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Старт сборки информации о ЮР лицах группы:\ncountry: {country};\nidentifier: {identifier}\ngroup identifiers: {", ".join(group_identifiers)}."
                    )
                    data_to_insert: list[DataForInsertionModuleScheme] = []
                    # print(group_identifiers)
                    for group_identifier in group_identifiers:
                        try:
                            data: DataForInsertionModuleScheme = await FNSAdapterFinancialAndRegistrationData(
                                token=tokens["FNS"],
                                identifier=group_identifier,
                                request_uuid=request_uuid,
                            ).adapt_data()
                            data.companies_court_cases["company_1"] = []  # FIXME тут возможна ошибка (company_X x - должна быть гибче чем реализовано сейчас или же это ошибка)
                            
                            data.company_identifier_type_for_court_case = "tax_identifier"
                            adapted_court_data: List[Optional[CourtCase]] = await CheckoCourtCaseDataAdapter(
                                token=tokens["CHECKO"],
                                identifier=group_identifier,
                                request_uuid=request_uuid,
                            ).adapt_court_case_data()
                            
                            data.companies_court_cases["company_1"].extend(adapted_court_data)
                            # FIXME ПРОВЕРИТЬ сбор арбитражей для ГРУППЫ КОМПАНИЙ
                            data_to_insert.append(data)
                        except Exception as e:
                            await Log.add_log(
                                log_type="error",
                                request_uuid=request_uuid,
                                message=f"Ошибка при адаптации информации о компании группы:\nidentifier: {group_identifier}\n{e}."
                            )
                    
                    # dim_tasks: List[asyncio.Task] = []
                    for data in data_to_insert:
                        app = DIM(request_uuid=request_uuid, data=data)
                        await app.insert(with_court_cases=True)
                        # dim_tasks.append(asyncio.create_task(app.insert(with_court_cases=True)))
                        # companies_court_cases
                    # for chunk in split_list_into_chunks(list_=dim_tasks, chunk_size=5):
                    #     await asyncio.gather(*chunk)
                    
                    await Log.add_log(
                        log_type="info",
                        request_uuid=request_uuid,
                        message=f"Успешная сборка информации о ЮР лицах группы:\ncountry: {country};\nidentifier: {identifier}\ngroup identifiers: {", ".join(group_identifiers)}."
                    )
                    async with get_async_session() as session:
                        stmt = (
                            update(Company)
                            .filter(
                                and_(
                                    Company.country_id == country,
                                    Company.registration_identifier_value == identifier,
                                )
                            )
                            .values({"with_group": True})
                        )
                        await session.execute(stmt)
                        await session.commit()
                    if queue_name:
                        try:
                            await RPC.response(
                                queue_name=queue_name,
                                message=f"Данные по группе ЮР лица с судебными делами {request_uuid} - готовы.",
                                status=True,
                                request_uuid=request_uuid,
                                data={"group_identifiers": group_identifiers}
                            )
                        except Exception as e:
                            print(e)
                
                case 214, False, False, True:
                    data = await UzbekistanManualInputAdapterFinancialAndRegistrationData(
                        identifier=identifier,
                        request_uuid=request_uuid,
                        data_from_manual_input_service=data_from_manual_input_service,  # type: ignore
                    ).adapt_data()
                
                case 129, False, False, True:
                    data = await MongoliaManualInputAdapterFinancialAndRegistrationData(
                        identifier=identifier,
                        request_uuid=request_uuid,
                        data_from_manual_input_service=data_from_manual_input_service,  # type: ignore
                    ).adapt_data()
                
                case 81, False, False, True:
                    data = await KazakhstanManualInputAdapterFinancialAndRegistrationData(
                        identifier=identifier,
                        request_uuid=request_uuid,
                        data_from_manual_input_service=data_from_manual_input_service,  # type: ignore
                    ).adapt_data()
                
                # TODO тут добавляются различные источники
                case _:
                    await Log.add_log(
                        log_type="error",
                        request_uuid=request_uuid,
                        message="Не указана страна."
                    )
                    raise ValueError("Не указана страна.")
            
            await Log.add_log(
                log_type="info",
                request_uuid=request_uuid,
                message=f"Получены данные для запроса:\ncountry: {country};\nidentifier: {identifier}."
            )
            
            await Log.add_log(
                log_type="info",
                request_uuid=request_uuid,
                message=f"Старт обработки данных запроса:\ncountry: {country};\nidentifier: {identifier}."
            )
            app = DIM(request_uuid=request_uuid, data=data)
            if data.companies_court_cases:
                await app.insert(with_court_cases=True)
            else:
                await app.insert()
            if with_group:
                await app.update_group_identifiers(
                    country_id=country,
                    registration_identifier=identifier,
                )
            
            # companies_court_cases
            
            # persons_court_cases
            # TODO в будущем нужно предусмотреть обработку для persons_court_cases
            
            await Log.add_log(
                log_type="info",
                request_uuid=request_uuid,
                message="Успешная обработка запроса."
            )
        except Exception as e:
            error_message = str(e)
            formatted_traceback = traceback.format_exc()
            log_content = f"{error_message}\n{formatted_traceback}"
            print(log_content)
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
    async def consume(
        tokens: Dict[str, str]
    ):
        while True:
            try:
                print(f"DIM worker {os.getpid()} connecting to RabbitMQ...")
                async with AMQPConnector.get_async_amqp_connection() as connection:
                    channel = await connection.channel()  # Создаем канал
                    await channel.set_qos(prefetch_count=10)
                    
                    exchange = await channel.get_exchange("fineye_dim_exchange")
                    queue = await channel.declare_queue(
                        "fineye_dim",
                        durable=True,
                        arguments={
                            'x-message-ttl': 86400000,
                            'x-dead-letter-exchange': 'fineye_dim_dlx',
                            'x-dead-letter-routing-key': 'fineye_dim_dlq'
                        }
                    )
                    await queue.bind(exchange, routing_key="fineye_dim")
                    
                    print(f"DIM worker {os.getpid()} started and waiting for messages...")
                    async with queue.iterator() as queue_iter:
                        async for message in queue_iter:
                            try:
                                # Получаем сообщение из очереди
                                body = json.loads(message.body.decode())
                                print(f"Получено сообщение из очереди: {body}")
                                
                                country = body.get("country")
                                identifier = body.get("identifier")
                                uuid = body.get("uuid")
                                with_group = body.get("with_group")
                                with_court_cases = body.get("with_court_cases")
                                queue_name = body.get("queue_name")
                                manual_input = body.get("manual_input")
                                data_from_manual_input_service = body.get("data_from_manual_input_service")
                                
                                # print(f"{country=}")
                                # print(f"{identifier=}")
                                # print(f"{uuid=}")
                                # print(f"{with_group=}")
                                # print(f"{with_court_cases=}")
                                # print(f"{queue_name=}")
                                # print(f"{manual_input=}")
                                # print(f"{data_from_manual_input_service=}")
                                
                                await Log.add_log(
                                    log_type="info",
                                    request_uuid=uuid,
                                    message=f"Получен запрос:\ncountry: {country};\nidentifier: {identifier}.",
                                )
                                await RPC.on_request(
                                    request_uuid=uuid,
                                    country=country,
                                    identifier=identifier,
                                    with_group=with_group,
                                    with_court_cases=with_court_cases,
                                    tokens=tokens,
                                    queue_name=queue_name,
                                    manual_input=manual_input if manual_input else False,
                                    data_from_manual_input_service=data_from_manual_input_service,
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
    async def response(queue_name: str, message: str, status: bool, request_uuid: str, data: Optional[Dict]=None, ):
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
