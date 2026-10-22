import asyncio
import io
import json
import traceback
from typing import Any, Dict, List, Optional, Set
from uuid import uuid4
from urllib.parse import quote
# import zlib

import aio_pika

from fastapi import Depends, Query
from fastapi.routing import APIRouter
from fastapi.responses import StreamingResponse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.utils.converter_types_for_serialization import convert_dates_to_strings, convert_decimal_to_float

from connection_manager import AsyncSFTPStorage, get_async_session

from src.schema import (
    LanguageMap, ReportCurrencyMap, ResponseScheme,
    AMQPConnectionScheme, PrepareInformationScheme,
    GetInformationScheme
)

from src.fineye.models import FileStore


from src.utils.constants.users.schemas import TokenScheme
from src.utils.constants.fineye.schemas import CustomGroupIdentifiers
from src.utils.constants.logger.schemas import LogScheme
from src.utils.constants.logger.mapping import LOG_TYPE_MAPPING
from src.utils.queries_and_statements import Query as Q
from src.utils.amqp_connection_controller import AMQPConnector
from src.utils.redis_connection_controller import RedisConnector
from src.utils.group_handler import GroupHandler
from src.logger.logger import create_log, update_log
from src.utils.constants.data_insertion_module.mapping import COUNTRY_MAPPING



router = APIRouter(
    tags=["Fineye"],
)


@router.post("/get_information")
async def get_information(
    request: GetInformationScheme,
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="get_information", uuid=request_uuid)
    try:
        group_handler = GroupHandler()
        data = {}
        msg = ""
        log_msg = ""
        if request.type == "company_full":
            company_object = await Q.get_company_information(
                country_id=request.country,
                registration_identifier=request.identifier
            )
            if company_object:
                company_id = company_object.pop("id")
                # print(f"{company_object=}")
                tasks = [
                    financial_statement_info_task := asyncio.create_task(Q.get_financial_statement_information(company_id=company_id)),
                    company_managers_info_task := asyncio.create_task(Q.get_company_manager_information(company_id=company_id)),
                    company_shareholder_info_task := asyncio.create_task(Q.get_company_shareholder_information(company_share_id=company_id)),
                    person_shareholder_info_task := asyncio.create_task(Q.get_person_shareholder_information(company_share_id=company_id)),
                    company_participation_info_task := asyncio.create_task(Q.get_company_shareholder_information(company_shareholder_id=company_id)),
                    company_address_objects_task := asyncio.create_task(Q.get_address_information(company_id=company_id)),
                    company_contact_objects_task := asyncio.create_task(Q.get_contact_information(company_id=company_id)),
                    company_event_objects_task := asyncio.create_task(Q.get_event_information(company_id=company_id)),
                    company_license_objects_task := asyncio.create_task(Q.get_company_license_information(company_id=company_id)),
                    company_capital_objects_task := asyncio.create_task(Q.get_company_capital_information(company_id=company_id)),
                    company_activity_objects_task := asyncio.create_task(Q.get_company_activity_information(company_id=company_id)),
                    company_classifier_objects_task := asyncio.create_task(Q.get_company_classifier_information(company_id=company_id)),
                    company_court_case_info_task := asyncio.create_task(Q.get_company_court_case_information(company_id=company_id))
                ]
                
                await asyncio.gather(*tasks)
                data[company_object["registration_identifier_value"]] = {
                    "company": company_object,
                    "financial_statement": financial_statement_info_task.result(),
                    "managers": company_managers_info_task.result(),
                    "company_shareholder": company_shareholder_info_task.result(),
                    "person_shareholder": person_shareholder_info_task.result(),
                    "company_participation": company_participation_info_task.result(),
                    "company_address": company_address_objects_task.result(),
                    "company_contact": company_contact_objects_task.result(),
                    "company_event": company_event_objects_task.result(),
                    "company_license": company_license_objects_task.result(),
                    "company_capital": company_capital_objects_task.result(),
                    "company_activity": company_activity_objects_task.result(),
                    "company_classifier": company_classifier_objects_task.result(),
                    "company_court_case": company_court_case_info_task.result(),
                }
                
                msg += "success"
            else:
                msg += "success: Информация о компании не найдена."
        
        elif request.type == "company_full_with_group":
            target_company_object = await Q.get_company_information(
                country_id=request.country,
                registration_identifier=request.identifier
            )
            
            if target_company_object:
                company_id = target_company_object.pop("id")
                group_company_ids: Set[int] = set()
                
                group_company_ids.update([company_id])
                
                all_company_ids: Set[str] = await group_handler.get_company_group(company_id=company_id)
                
                main_level_company_ids: Set[str] = await group_handler.gather_group(group_company_ids=group_company_ids,company_id=company_id)
                
                group_company_ids.update(main_level_company_ids)
                group_company_ids.update(all_company_ids)  # TODO тут можно разделить на основной и второстепенный уровни отношений
                
                for company_id in tuple(group_company_ids):
                    try:
                        company_object = await Q.get_company_information(company_id=company_id)
                        del company_object["id"]
                        
                        tasks = [
                            financial_statement_info_task := asyncio.create_task(Q.get_financial_statement_information(company_id=company_id)),
                            company_managers_info_task := asyncio.create_task(Q.get_company_manager_information(company_id=company_id)),
                            company_shareholder_info_task := asyncio.create_task(Q.get_company_shareholder_information(company_share_id=company_id)),
                            person_shareholder_info_task := asyncio.create_task(Q.get_person_shareholder_information(company_share_id=company_id)),
                            company_participation_info_task := asyncio.create_task(Q.get_company_shareholder_information(company_shareholder_id=company_id)),
                            company_address_objects_task := asyncio.create_task(Q.get_address_information(company_id=company_id)),
                            company_contact_objects_task := asyncio.create_task(Q.get_contact_information(company_id=company_id)),
                            company_event_objects_task := asyncio.create_task(Q.get_event_information(company_id=company_id)),
                            company_license_objects_task := asyncio.create_task(Q.get_company_license_information(company_id=company_id)),
                            company_capital_objects_task := asyncio.create_task(Q.get_company_capital_information(company_id=company_id)),
                            company_activity_objects_task := asyncio.create_task(Q.get_company_activity_information(company_id=company_id)),
                            company_classifier_objects_task := asyncio.create_task(Q.get_company_classifier_information(company_id=company_id)),
                            company_court_case_info_task := asyncio.create_task(Q.get_company_court_case_information(company_id=company_id))
                        ]
                        
                        await asyncio.gather(*tasks)
                        
                        data[company_object["registration_identifier_value"]] = {
                            "company": company_object,
                            "financial_statement": financial_statement_info_task.result(),
                            "managers": company_managers_info_task.result(),
                            "company_shareholder": company_shareholder_info_task.result(),
                            "person_shareholder": person_shareholder_info_task.result(),
                            "company_participation": company_participation_info_task.result(),
                            "company_address": company_address_objects_task.result(),
                            "company_contact": company_contact_objects_task.result(),
                            "company_event": company_event_objects_task.result(),
                            "company_license": company_license_objects_task.result(),
                            "company_capital": company_capital_objects_task.result(),
                            "company_activity": company_activity_objects_task.result(),
                            "company_classifier": company_classifier_objects_task.result(),
                            "company_court_case": company_court_case_info_task.result(),
                        }
                        msg_data = f"{company_object["registration_identifier_value"]}=>success;\n"
                        msg += msg_data
                        log_msg += msg_data
                    except Exception as e:
                        error_message = str(e)
                        formatted_traceback = traceback.format_exc()
                        log_content = f"{error_message}\n{formatted_traceback}"
                        msg += f"{company_object["registration_identifier_value"]}=>error;\n"
                        log_msg += f"{company_object["registration_identifier_value"]}=>error: {log_content};\n"
        
        # TODO тут можно дробить endpoint на типы запрашиваемых данных
        response = ResponseScheme(
            status=True,
            msg=msg,
            data=data,
            request_uuid=request_uuid,
        )
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["info"],
                message=log_msg,
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

@router.post("/prepare_report")
async def prepare_report(
    amqp_connect: AMQPConnectionScheme,
    request: PrepareInformationScheme,
    request_uuid: Optional[str] = None,  # для сквозного логирования цепочки запросов
    custom_group_identifiers: Optional[CustomGroupIdentifiers] = None,
    language: LanguageMap = "English", # type: ignore
    currency: ReportCurrencyMap = "ORIGINAL", # type: ignore
    token: TokenScheme = Depends(Q.get_current_token),
) -> ResponseScheme:
    if request_uuid is None:
        request_uuid = str(uuid4())
    file_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="prepare_report", uuid=request_uuid)
    request_dict: Dict[str, Any] = request.model_dump()
    try:
        if custom_group_identifiers:
            # TODO тут в будущем будут различные страны, нужно будет выставлять проверки на все страны
            assert len(custom_group_identifiers.Russia) <= 50, "Нельзя сделать отчет с кастомной группой более 50 ЮЛ!"
        await RedisConnector.check_connection(token=token, amqp_connect=amqp_connect)
        target_company = await Q.get_company_information(registration_identifier=request.identifier, country_id=request.country)
        
        assert target_company, f"Требуется подготовить информацию по компании {request.identifier}"
        assert target_company["status"] not in ["Прекратило деятельность", "Ликвидировано"], f'Компания {target_company["registration_identifier_value"]} имеет статус "{target_company['status']}"'
        
        is_financial_company: bool = target_company["is_financial_company"]
        with_group: bool = target_company["with_group"]
        assert not is_financial_company, f"Компания {target_company["registration_identifier_value"]} является финансовой, не получится составить отчет."
        if not with_group and request.with_group:
            raise AssertionError(f"Требуется подготовить информацию по группе компании {request.identifier}")
        
        endpoint_response: ResponseScheme = await get_information(
            request=GetInformationScheme(
                type="company_full_with_group" if request.with_group else "company_full",
                country=request.country,
                identifier=request.identifier,
            ),
            token=token
        )
        unprepared_data = endpoint_response.data
        
        errors = []
        task_pull = []
        if custom_group_identifiers:
            custom_group_identifiers_dict: Dict[str, List] = custom_group_identifiers.model_dump()
            
            for country_key in custom_group_identifiers_dict:
                list_identifiers: List[Optional[str]] = custom_group_identifiers_dict[country_key]
                for identifier in list_identifiers:
                    endpoint_task: ResponseScheme = asyncio.create_task(
                        get_information(
                            request=GetInformationScheme(
                                type="company_full",
                                country=COUNTRY_MAPPING[country_key],
                                identifier=identifier,
                            ),
                            token=token
                        )
                    )
                    task_pull.append(endpoint_task)
        if task_pull:
            results_gather = await asyncio.gather(*task_pull, return_exceptions=True)
            errors = ["".join(data.msg.split(" - ")[1:]) for data in results_gather if data.status is False]
            custom_group_data_list = [data.data for data in results_gather if data.status is True]
            for data in custom_group_data_list:
                unprepared_data.update(data)
        
        primary_processed_data = convert_dates_to_strings(unprepared_data)
        
        data = convert_decimal_to_float(primary_processed_data)
        assert data[target_company["registration_identifier_value"]]["financial_statement"], f"У компании {target_company["registration_identifier_value"]} отсутствует финансовая отчетность. Но вы можете попробовать запросить информацию о компаниях из группы: {", ".join([identifier for identifier in data if identifier != target_company["registration_identifier_value"]])}" if len(list(data)) > 1 else f"У компании {target_company["registration_identifier_value"]} отсутствует финансовая отчетность."
        assert data, f"Не удалось получить данные от endpoint по запросу: {request.model_dump()}. Возможно требуется их подготовка."
        
        not_active = []
        without_financial_statements = []
        without_court_cases = []
        for ogrn, company_data in data.items():
            if request_dict.get("with_court_cases"):
                if not company_data.get('company', {}).get("with_court_case"):
                    without_court_cases.append(ogrn)
            
            
            if company_data.get('company', {}).get('status') == 'Действующее':
                # Проверяем наличие финансовой отчетности
                if 'financial_statement' in company_data and company_data['financial_statement']:
                    continue
                else:
                    without_financial_statements.append(ogrn)
            else:
                not_active.append(ogrn)
        async with AMQPConnector.get_async_amqp_connection() as connection:
            channel = await connection.channel()
            exchange = await channel.get_exchange("fineye_exchange")
            message_content = {
                **request_dict,
                "data": data,
                "uuid": request_uuid,
                "file_uuid": file_uuid,
                "queue_name": amqp_connect.queuename,
                "currency": currency,
                "language": language,
            }
            if request_dict.get("with_group"):
                message_content.update(
                    {
                        "not_active": not_active,
                        "count_not_active": len(not_active),
                    }
                )
            message = aio_pika.Message(
                body=json.dumps(message_content).encode(),
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,  # Сообщение сохраняется на диск
                expiration=86400000  # TTL сообщения 24 часа
            )
            
            await exchange.publish(
                message,
                routing_key="fineye_pro"
            )
        
        response = ResponseScheme(
            status=True,
            msg="success: запрос поступил в обработку." if not errors else f"success: запрос поступил в обработку. Но по следующим идентификаторам не были найдены данные в БД и они не будут включены в отчет: {", ".join(errors)}.",
            data={
                "file_uuid": file_uuid,
                "company_name": target_company["short_name"] if target_company.get("short_name") else target_company.get("full_name"),
                "not_active": not_active,
                "without_financial_statements": without_financial_statements,
                "without_court_cases": without_court_cases,
            },
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
            msg=f"{e}",
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


@router.post("/get_file", dependencies=[Depends(Q.get_current_token),])
async def get_file(
    token: TokenScheme = Depends(Q.get_current_token),
    file_uuid: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_async_session),
) -> ResponseScheme | bytes:
    request_uuid = str(uuid4())
    log_id: int = await create_log(token=token.value, endpoint="get_file", uuid=request_uuid)
    try:
        assert file_uuid, "Требуется указать uuid файла."
        
        query_file = select(FileStore).filter(FileStore.uuid == file_uuid)
        query_file_result = await session.execute(query_file)
        result = query_file_result.first()
        assert result, f"Файл с uuid - {file_uuid} не был найден."
        async with AsyncSFTPStorage() as storage:
            file_sftp_path = result[0].file_path
            file_name = result[0].file_name.split(".")[0]
            extension = result[0].file_name.split(".")[-1]
            file = await storage.download_file(sftp_path=file_sftp_path)
        file_stream = io.BytesIO(file)
        # decompressed_data = io.BytesIO(zlib.decompress(file_stream.getvalue()))
        response = StreamingResponse(file_stream, media_type="application/octet-stream")
        response.headers["Content-Disposition"] = f"attachment; filename={quote(file_name)}.{extension}"
        await update_log(
            id=log_id,
            log=LogScheme(
                log_type=LOG_TYPE_MAPPING["info"],
                message="success: отчет получен.",
                status=True,
                data=None,
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
