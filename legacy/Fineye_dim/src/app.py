import datetime
import asyncio
from asyncio import Lock
from decimal import Decimal
from types import NoneType
from typing import Any, Dict, List, Tuple, Union

from service_logger.app import Log
from src.utils.common import split_list_into_chunks

from .models import (
    Company, CompanyBranch, Activity, Capital, Classifier, License,
    FinancialStatement, FinancialStatementRow, Person,
    Manager, Shareholder, Contact, Address, Event, Sanction
)
from .schemas import (
    CompanyBranchScheme, ActivityScheme, CapitalScheme,
    FinancialStatementRowScheme, ClassifierScheme, LicenseScheme,
    AddressScheme, ContactScheme, SanctionScheme,
    CompanyScheme, FinancialStatementScheme, PersonScheme,
    ManagerScheme, ShareholderScheme, EventScheme,
    DataForInsertionModuleScheme,
)
from .utils.data_insertion import DataInsertor
from .utils.constants.mapping import (
    COUNTRY_MAPPING, CURRENCY_MAPPING, FINANCIAL_STATEMENT_ROW_TYPE_MAPPING, 
    FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING, 
    STATUS_INFORMATION_MAPPING, CONTACT_TYPE_MAPPING,
)

class DIM:
    def __init__(
        self,
        request_uuid: str,
        data: Union[Dict[str, Union[List, Dict, NoneType]], DataForInsertionModuleScheme]
    ):
        self.request_uuid = request_uuid
        self.data: Union[Dict[str, Union[List, Dict, NoneType]], DataForInsertionModuleScheme] = data
        
    @staticmethod
    async def __data_processing(request_uuid: str, data: Union[Dict[str, Union[List, Dict, NoneType]], DataForInsertionModuleScheme]):
        if isinstance(data, DataForInsertionModuleScheme):
            data_dict: Dict[str, Union[List, Dict, NoneType]] = data.model_dump()
        elif isinstance(data, dict):
            data_dict: Dict[str, Union[List, Dict, NoneType]] = data
        
        subjects: Dict[str, Any] = {
            "companies": data_dict["companies"],
            "persons": data_dict["persons"],
        }
        subjects_properties: Dict[str, Any] = {
            "companies_financial_statements": data_dict["companies_financial_statements"]
        }
        properties: Dict[str, Any] = {
            "companies_branches": data_dict["companies_branches"],
            "companies_contacts": data_dict["companies_contacts"],
            "companies_addresses": data_dict["companies_addresses"],
            "companies_activities": data_dict["companies_activities"],
            "companies_capitals": data_dict["companies_capitals"],
            "companies_classifiers": data_dict["companies_classifiers"],
            "companies_licenses": data_dict["companies_licenses"],
            "companies_sanctions": data_dict["companies_sanctions"],
            "companies_events": data_dict["companies_events"],
            "companies_financial_statements_rows": data_dict["companies_financial_statements_rows"],
            
            "persons_contacts": data_dict["persons_contacts"],
            "persons_addresses": data_dict["persons_addresses"],
            "persons_sanctions": data_dict["persons_sanctions"],
            "persons_events": data_dict["persons_events"],
        }
        relations: Dict[str, Any] = {
            "managers": data_dict["managers"],
            "shareholders": data_dict["shareholders"],
        }
        
        court_cases: Dict[str, Any] = {
            "companies_court_cases": data_dict["companies_court_cases"],
            "persons_court_cases": data_dict["persons_court_cases"],
        }
        
        subject_keys_ids: Dict[str, int] = {}
        
        # SUBJECTS
        await Log.add_log(
            log_type="info",
            request_uuid=request_uuid,
            message="Попытка сохранить subjects."
        )
        if subjects:
            log_s_tasks: List[asyncio.Task] = []
            for idx, name_subjects in enumerate(subjects):
                subjects_dict: Dict[str, Any] = subjects[name_subjects]
                if name_subjects == "companies":
                    table = Company
                elif name_subjects == "persons":
                    table = Person
                
                for idx, subject_key in enumerate(subjects_dict):
                    subject = subjects_dict[subject_key]
                    try:
                        await DataInsertor.insert_subject_information(
                            table_subject=table,
                            data_subject=subject,
                            subject_keys_ids=subject_keys_ids,
                            key_subject=subject_key,
                        )
                    except Exception as e:
                        # TODO нужно помониторить баги выводя "e" (но, это будет жрать место в БД при записи большого лога)
                        log_s_task = asyncio.create_task(
                            Log.add_log(
                                log_type="error",
                                request_uuid=request_uuid,
                                message=f"Исключение при сохранении subject => {subject_key}_{idx}."
                            )
                        )
                        log_s_tasks.append(log_s_task)
            
            if log_s_tasks:
                await asyncio.gather(*log_s_tasks)
                
            await Log.add_log(
                log_type="info",
                request_uuid=request_uuid,
                message="Завершено сохранение subjects."
            )
        else:
            await Log.add_log(
                log_type="error",
                request_uuid=request_uuid,
                message="Отсутствуют subjects."
            )
            raise ValueError("Отсутствуют subjects.")
        
        # SUBJECT-PROPERTIES
        await Log.add_log(
            log_type="info",
            request_uuid=request_uuid,
            message="Попытка сохранить subject-properties."
        )
        
        if subjects_properties:
            log_s_p_tasks: List[asyncio.Task] = []
            for name_subjects_properties in subjects_properties:
                subjects_properties_dict: Dict[str, Any] = subjects_properties[name_subjects_properties]
                if name_subjects_properties == "companies_financial_statements":
                    table = FinancialStatement
                for subject_key in subjects_properties_dict:
                    for idx, subject_property_key in enumerate(subjects_properties_dict[subject_key]):
                        
                        subject_property = subjects_properties_dict[subject_key][subject_property_key]
                        parent_id = subject_keys_ids[subject_key] if subject_keys_ids.get(subject_key) else None
                        if parent_id:
                            try:
                                await DataInsertor.insert_subject_information(
                                    table_subject=table,
                                    data_subject=subject_property,
                                    subject_keys_ids=subject_keys_ids,
                                    key_subject=subject_property_key,
                                    subject_property_parent_id=parent_id,
                                )
                            except Exception as e:
                                # TODO нужно помониторить баги выводя "e" (но, это будет жрать место в БД при записи большого лога)
                                log_s_p_task = asyncio.create_task(
                                        Log.add_log(
                                            log_type="error",
                                            request_uuid=request_uuid,
                                            message=f"Исключение при сохранении subject-property => {subject_property_key}_{idx}."
                                        )
                                    )
                                log_s_p_tasks.append(log_s_p_task)
                
                if log_s_p_tasks:
                    await asyncio.gather(*log_s_p_tasks)
        
        else:
            await Log.add_log(
                log_type="warning",
                request_uuid=request_uuid,
                message="Отсутствуют subject-properties."
            )
        
        # PROPERTIES & RELATIONS
        await Log.add_log(
            log_type="info",
            request_uuid=request_uuid,
            message="Попытка сохранить properties and relations."
        )
        # PROPERTIES
        properties_and_relations_task_pull: List[asyncio.Task] = []
        for name_properties in properties:
            if name_properties == "companies_branches":
                property_table = CompanyBranch
            elif name_properties in ("companies_contacts", "persons_contacts"):
                property_table = Contact
            elif name_properties in ("companies_addresses", "persons_addresses"):
                property_table = Address
            elif name_properties == "companies_activities":
                property_table = Activity
            elif name_properties == "companies_capitals":
                property_table = Capital
            elif name_properties == "companies_classifiers":
                property_table = Classifier
            elif name_properties == "companies_licenses":
                property_table = License
            elif name_properties in ("companies_sanctions", "persons_sanctions"):
                property_table = Sanction
            elif name_properties in ("companies_events", "persons_events"):
                property_table = Event
            elif name_properties == "companies_financial_statements_rows":
                property_table = FinancialStatementRow
            
            properties_dict: Dict[str, Any] = properties[name_properties]
            for idx, subject_key in enumerate(properties_dict):
                property = properties_dict[subject_key]
                property_task = asyncio.create_task(
                    DataInsertor.insert_properties_information(
                        table_property=property_table,
                        data_property=property,
                        ids_subject=subject_keys_ids,
                        keys_subject=subject_key,
                    ),
                    name=f"{name_properties}_{subject_key}_{idx}",
                )
                properties_and_relations_task_pull.append(property_task)
        
        # RELATIONS
        for idx, name_relations in enumerate(relations):
            relation_list: List[Dict[str, Any]] = relations[name_relations]
            keys_subject: Tuple = tuple()
            if name_relations == "managers":
                relation_table = Manager
                keys_subject = (
                        "person_id",
                        "company_id",
                )
            elif name_relations == "shareholders":
                relation_table = Shareholder
                keys_subject = (
                    "company_shareholder_id",
                    "person_shareholder_id",
                    "company_share_id",
                )
            
            relation_task = asyncio.create_task(
                DataInsertor.insert_properties_information(
                    table_property=relation_table,
                    data_property=relation_list,
                    ids_subject=subject_keys_ids,
                    keys_subject=keys_subject, # type: ignore
                ),
                name=f"{name_relations}_{idx}",
            )
            properties_and_relations_task_pull.append(relation_task)
        
        if properties_and_relations_task_pull:
            for chunk in split_list_into_chunks(properties_and_relations_task_pull, chunk_size=10):
                results_p_and_r_gather = await asyncio.gather(*chunk, return_exceptions=True)
                properties_and_relations_task_names: List[str] = [property_and_relation_task.get_name() for property_and_relation_task in chunk]
                log_p_and_r_tasks: List[asyncio.Task] = []
                for idx, result_p_and_r_gather in enumerate(results_p_and_r_gather):
                    if issubclass(type(result_p_and_r_gather), Exception):
                        log_p_and_r_task = asyncio.create_task(
                            Log.add_log(
                                log_type="error",
                                request_uuid=request_uuid,
                                message=f"Исключение при сохранении property/relation => {properties_and_relations_task_names[idx]}."
                            )
                        )
                        log_p_and_r_tasks.append(log_p_and_r_task)
                await asyncio.gather(*log_p_and_r_tasks)
            
            await Log.add_log(
                log_type="info",
                request_uuid=request_uuid,
                message="Завершено сохранение properties and relations."
            )
        else:
            await Log.add_log(
                log_type="warning",
                request_uuid=request_uuid,
                message="Отсутствуют properties and relations."
            )
        
        # COURT CASES
        await Log.add_log(
            log_type="info",
            request_uuid=request_uuid,
            message="Попытка сохранить court cases."
        )
        
        court_case_keys_ids: Dict[Tuple[int, str], int] = {}
        court_cases_task_pull: List[asyncio.Task] = []
        
        # Сбор данных CourtCase
        court_case_data_list = []
        for court_case_type in ["companies_court_cases", "persons_court_cases"]:  # Проходим по субъектам судебных дел
            court_cases_dict = court_cases.get(court_case_type, {})
            for subject_key in court_cases_dict:
                cases = court_cases_dict[subject_key]
                if not cases:
                    continue
                for case in cases:
                    if not case:
                        continue
                    country_id = case.get("country_id")
                    if not country_id:
                        await Log.add_log(
                            log_type="error",
                            request_uuid=request_uuid,
                            message=f"Неизвестный country_id {case.get("country_id")} для дела {case.get("number")}."
                        )
                        continue
                    unique_key = (country_id, case.get("number"))
                    court_case_data = {
                        "source_info": case.get("source_info"),
                        "country_id": country_id,
                        "number": case.get("number"),
                        "court": case.get("court"),
                        "amount": Decimal(case["amount"]).quantize(Decimal("0.00")) if case.get("amount") is not None else None,
                        "currency_id": case.get("currency_id"),
                        "date": case.get("date"),
                    }
                    court_case_data_list.append((unique_key, court_case_data))
        
        # Вставка CourtCase
        if court_case_data_list:  # Если есть валидные судебные дела, то ...
            unique_court_cases = {}
            for unique_key, data in court_case_data_list:  # проходим по кортежу-ключу (сочетание страны + номер дела)
                if unique_key not in unique_court_cases:  # добавляем в словарь уникальных дел кортеж-ключ, если его там еще нет
                    unique_court_cases[unique_key] = data
            
            court_cases_task_pull = []
            for unique_key, data in unique_court_cases.items():
                task = asyncio.create_task(
                    DataInsertor.insert_court_case_information(
                        data=data,
                        is_participant_info=False,
                    ),
                    name=f"court_case_{unique_key[0]}_{unique_key[1]}"
                )
                court_cases_task_pull.append(task)  # Добавление задач в пулл
            
            # Выполнение пула задач по вставке судебных дел
            idx = 0
            for chunk in split_list_into_chunks(court_cases_task_pull, chunk_size=10):
                results_court_cases_task_pull = await asyncio.gather(*chunk, return_exceptions=True)
                log_tasks = []
                # Обработка результатов вставки CourtCase
                for result in results_court_cases_task_pull:
                    task = court_cases_task_pull[idx]
                    unique_key = list(unique_court_cases.keys())[idx]
                    idx += 1
                    if isinstance(result, Exception):  # если произошла ошибка, то сохранить лог...
                        # print(f"{result=}")
                        log_task = asyncio.create_task(
                            Log.add_log(
                                log_type="error",
                                request_uuid=request_uuid,
                                message=f"Ошибка сохранения Судебного дела {unique_key}: id={str(result)}"
                            )
                        )
                        log_tasks.append(log_task)
                    else:  # ... иначе, добавить вывод - id в словарь с кортежем-ключом и id значением
                        court_case_keys_ids[unique_key] = result
                await asyncio.gather(*log_tasks)
        
        # Вставка ParticipantInCase
        if court_case_keys_ids:
            participants_task_pull: List[asyncio.Task] = []
            for court_case_type in ["companies_court_cases", "persons_court_cases"]:
                court_cases_dict = court_cases.get(court_case_type, {})
                for subject_key in court_cases_dict:
                    cases = court_cases_dict[subject_key]
                    if not cases:
                        continue
                    for case in cases:
                        if not case:
                            continue
                        country_id = case.get("country_id")
                        if not country_id:
                            continue
                        unique_key = (country_id, case.get("number"))
                        court_case_id = court_case_keys_ids.get(unique_key)
                        if not court_case_id:
                            continue
                        for participant in case.get("participants"):
                            if not participant:
                                continue
                            participant_type_id = participant.get("participant_type")
                            if not participant_type_id:
                                await Log.add_log(
                                    log_type="error",
                                    request_uuid=request_uuid,
                                    message=f"Неизвестный participant_type {participant.get("participant_type")}."
                                )
                                continue
                            
                            # Формирование данных участника
                            participant_data = {
                                "source_info": participant.get("source_info"),
                                "court_case": court_case_id,
                                "is_legal_entity": participant.get("is_legal_entity"),
                                "participant_type": participant_type_id,
                                "subject_id": participant.get("subject_id"),
                                "name": participant.get("name"),
                                "identifier_type": participant.get("identifier_type"),
                                "identifier_value": participant.get("identifier_value"),
                                "address": participant.get("address"),
                            }
                            # Создание задачи для вставки
                            task = asyncio.create_task(
                                DataInsertor.insert_court_case_information(
                                    data=participant_data,
                                    is_participant_info=True,
                                ),
                                name=f"participant_{court_case_id}_{participant_type_id}"
                            )
                            participants_task_pull.append(task)
            
            # Обработка вставки участников
            idx = 0
            if participants_task_pull:
                for chunk in split_list_into_chunks(participants_task_pull, chunk_size=10):
                    results_participants_task_pull = await asyncio.gather(*chunk, return_exceptions=True)
                    log_tasks = []
                    for result in results_participants_task_pull:
                        task = participants_task_pull[idx]
                        idx += 1
                        if isinstance(result, Exception):
                            log_task = asyncio.create_task(
                                Log.add_log(
                                    log_type="error",
                                    request_uuid=request_uuid,
                                    message=f"Ошибка сохранения участника: id={str(result)}."
                                )
                            )
                            log_tasks.append(log_task)
                    await asyncio.gather(*log_tasks)
        
        await Log.add_log(
            log_type="info",
            request_uuid=request_uuid,
            message="Завершено сохранение court cases."
        )
    
    async def insert(self, with_court_cases: bool=False):
        await DIM.__data_processing(request_uuid=self.request_uuid, data=self.data)
        if with_court_cases:
            await self.update_relation_company_participant_in_case()
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message="Завершена обработка данных запроса."
        )
    
    async def update_relation_company_participant_in_case(self):
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message="Попытка актуализировать связи участников судебных дел и ЮЛ."
        )
        try:
            await DataInsertor.update_relation_company_participant_in_case(
                company_identifier_type=self.data.company_identifier_type_for_court_case,
                reg_info=self.data.companies["company_1"],
            )
        except Exception as e:
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка актуализации связей субъектов судебных дел и ЮЛ:\n{e}."
            )
    
    async def update_group_identifiers(self, country_id: int, registration_identifier: str):
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message="Попытка актуализировать групп связанных с ЮЛ."
        )
        try:
            await DataInsertor.update_group_identifiers(
                country_id=country_id,
                registration_identifier=registration_identifier,
            )
        except Exception as e:
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Ошибка актуализации групп связанных с ЮЛ:\n{e}."
            )




# if __name__ == "__main__":
#     test_data = DataForInsertionModuleScheme(
#         companies={
#             "company_1": CompanyScheme(
#                 source_info="Test",
#                 important_information="Some important information about the company",
#                 country_id=COUNTRY_MAPPING["Russia"],
#                 registration_identifier_name="ОГРН",
#                 registration_identifier_value="12345678910",
#                 tax_identifier_name="ИНН",
#                 tax_identifier_value="123456789",
#                 status="Terminated",
#                 short_name="OOO Romashka",
#                 full_name="OOO Romashka",
#                 short_name_en="OOO Romashka",
#                 full_name_en="OOO Romashka",
#                 founding_date=datetime.datetime.now().date(),
#                 termination_date=None,
#                 is_financial_company=False
#             ),
#             "company_2": CompanyScheme(
#                 source_info="Test",
#                 important_information="Some important information about the company",
#                 country_id=COUNTRY_MAPPING["Russia"],
#                 registration_identifier_name="ОГРН",
#                 registration_identifier_value="0987654321",
#                 tax_identifier_name="ИНН",
#                 tax_identifier_value="987654321",
#                 status="Terminated",
#                 short_name="OOO Oduvanchik",
#                 full_name="OOO Oduvanchik",
#                 short_name_en="OOO Oduvanchik",
#                 full_name_en="OOO Oduvanchik",
#                 founding_date=datetime.datetime.now().date(),
#                 termination_date=None,
#                 is_financial_company=False,
#             ),
#         },
#         companies_branches={
#             "company_1": [
#                 CompanyBranchScheme(
#                     main_identifier="12345678910",
#                     sub_identifier="Some identifier 1",
#                     type="AAA",
#                     founding_date=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"], 
#                 ),
#                 CompanyBranchScheme(
#                     main_identifier="12345678910",
#                     sub_identifier="Some identifier 2",
#                     type="BBB",
#                     founding_date=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#                 CompanyBranchScheme(
#                     main_identifier="12345678910",
#                     sub_identifier="Some identifier 3",
#                     type="CCC",
#                     founding_date=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"], 
#                 ),
#             ],
#         },
#         companies_contacts={
#             "company_1": [
#                 ContactScheme(
#                     contact_type_id=CONTACT_TYPE_MAPPING["Phone"],
#                     value="88005553535",
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_addresses={
#             "company_1": [
#                 AddressScheme(
#                     country_id=COUNTRY_MAPPING["Russia"],
#                     address_type="Legal address",
#                     region_code=None,
#                     zip="662978",
#                     full_address="Russia, Krasnoyarsk Territory, Zheleznogorsk, Leningradsky Avenue, building 24, apt. 76",
#                     region="Krasnoyarsk Territory",
#                     area=None,
#                     locality="Zheleznogorsk",
#                     street="Leningradsky Avenue",
#                     house="24",
#                     frame=None,
#                     room="76",
#                     date_from=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_activities={
#             "company_1": [
#                 ActivityScheme(
#                     is_main=True,
#                     code="62",
#                     description="Computer software development, consulting services in the field and other related services",
#                     date=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_capitals={
#             "company_1": [
#                 CapitalScheme(
#                     value=9999999.99,
#                     currency_id=CURRENCY_MAPPING["RUB"],
#                     type="Main capital",
#                     date=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_classifiers={
#             "company_1": [
#                 ClassifierScheme(
#                     name="ОКПО",
#                     value="12345678",
#                     description="Общероссийский классификатор предприятий и организаций",
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_licenses={
#             "company_1": [
#                 LicenseScheme(
#                     license_identifier="111-11111-111111",
#                     license_body="Implementation of the development of general artificial intelligence",
#                     licensee="FEDERAL SERVICE FOR TECHNICAL AND EXPORT CONTROL",
#                     valid_from=datetime.datetime.now().date(),
#                     valid_to=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_sanctions={
#             "company_1": [
#                 SanctionScheme(
#                     country_id=COUNTRY_MAPPING["United_States"],
#                     description='Introduced due to the development of "Skynet"',
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_financial_statements={
#             "company_1": {
#                 "financial_statement_1": FinancialStatementScheme(
#                     source_info="Test",
#                     period_type_id=FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Annual"],
#                     date=datetime.datetime.strptime("31.12.2022", "%d.%m.%Y").date(),
#                     currency_id=CURRENCY_MAPPING["RUB"],
#                 ),
#                 "financial_statement_2": FinancialStatementScheme(
#                     source_info="Test",
#                     period_type_id=FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Annual"],
#                     date=datetime.datetime.strptime("31.12.2023", "%d.%m.%Y").date(),
#                     currency_id=CURRENCY_MAPPING["RUB"],
#                 ),
#             },
#         },
#         companies_financial_statements_rows={
#             "financial_statement_1": [
#                 FinancialStatementRowScheme(
#                     type_id=FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Balance sheet"],
#                     name="1150",
#                     value=99999.99,
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#                 FinancialStatementRowScheme(
#                     type_id=FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Profit and loss"],
#                     name="2110",
#                     value=9999.99,
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#                 FinancialStatementRowScheme(
#                     type_id=FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Cash flow statement"],
#                     name="4100",
#                     value=9999.99,
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#             "financial_statement_2": [
#                 FinancialStatementRowScheme(
#                     type_id=FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Balance sheet"],
#                     name="1150",
#                     value=88888.88,
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#                 FinancialStatementRowScheme(
#                     type_id=FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Profit and loss"],
#                     name="2110",
#                     value=8888.88,
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#                 FinancialStatementRowScheme(
#                     type_id=FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Cash flow statement"],
#                     name="4100",
#                     value=8888.88,
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         companies_events={
#             "company_1": [
#                 EventScheme(
#                     source_info="Test",
#                     date=datetime.datetime.now().date(),
#                     description="Some company event",
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"]
#                 ),
#             ],
#         },
        
#         persons={
#             "person_1": PersonScheme(
#                 source_info="Test",
#                 important_information="Some important information about me",
#                 surname="Gogulaev",
#                 first_name="Egor",
#                 patronymic="Viktorovich",
#                 date_birth=datetime.datetime.strptime("16.03.1997", "%d.%m.%Y").date(),
#                 gender="Man",
#                 citizenship=COUNTRY_MAPPING["Russia"],
#                 identifier_name="ИНН",
#                 identifier_value="123456789012",
#                 identifier_sub_name=None,
#                 identifier_sub_value=None,
#             ),
#             "person_2": PersonScheme(
#                 source_info="Test",
#                 important_information="Some important information about me",
#                 surname="Gogulaev",
#                 first_name="Daniil",
#                 patronymic="Viktorovich",
#                 date_birth=datetime.datetime.strptime("16.08.1995", "%d.%m.%Y").date(),
#                 gender="Man",
#                 citizenship=COUNTRY_MAPPING["Russia"],
#                 identifier_name="ИНН",
#                 identifier_value="210987654321",
#                 identifier_sub_name=None,
#                 identifier_sub_value=None,
#             ),
#         },
#         persons_contacts={
#             "person_1": [
#                 ContactScheme(
#                     contact_type_id=CONTACT_TYPE_MAPPING["Phone"],
#                     value="88005553535",
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#             "person_2": [
#                 ContactScheme(
#                     contact_type_id=CONTACT_TYPE_MAPPING["Phone"],
#                     value="53535550088",
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         persons_addresses={
#             "person_1": [
#                 AddressScheme(
#                     country_id=COUNTRY_MAPPING["Russia"],
#                     address_type="Legal address",
#                     region_code=None,
#                     zip="662978",
#                     full_address="Russia, Krasnoyarsk Territory, Zheleznogorsk, Leningradsky Avenue, building 24, apt. 76",
#                     region="Krasnoyarsk Territory",
#                     area=None,
#                     locality="Zheleznogorsk",
#                     street="Leningradsky Avenue",
#                     house="24",
#                     frame=None,
#                     room="76",
#                     date_from=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#             "person_2": [
#                 AddressScheme(
#                     country_id=COUNTRY_MAPPING["Russia"],
#                     address_type="Legal address",
#                     region_code=None,
#                     zip="662978",
#                     full_address="Russia, Krasnoyarsk Territory, Zheleznogorsk, Leningradsky Avenue, building 24, apt. 76",
#                     region="Krasnoyarsk Territory",
#                     area=None,
#                     locality="Zheleznogorsk",
#                     street="Leningradsky Avenue",
#                     house="24",
#                     frame=None,
#                     room="76",
#                     date_from=datetime.datetime.now().date(),
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         persons_sanctions={
#             "person_1": [
#                 SanctionScheme(
#                     country_id=COUNTRY_MAPPING["United_States"],
#                     description='Introduced due to the development of "Skynet"',
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#                 ),
#             ],
#         },
#         persons_events={
#             "person_1": [
#                 EventScheme(
#                     source_info="Test",
#                     date=datetime.datetime.now().date(),
#                     description="Some person event",
#                     status_info_id=STATUS_INFORMATION_MAPPING["Actual"]
#                 ),
#             ],
#         },
        
#         managers=[
#             ManagerScheme(
#                 source_info="Test",
#                 person_id="person_1",
#                 company_id="company_1",
#                 job_title="Supervisor",
#                 supervisor=True,
#                 appointment_date=datetime.datetime.now().date(),
#                 important_information="Some important information about the manager",
#                 status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#             ),
#         ],
#         shareholders=[
#             ShareholderScheme(
#                 source_info="Test",
#                 company_shareholder_id=None,
#                 person_shareholder_id="person_1",
#                 company_share_id="company_1",
#                 currency_id=CURRENCY_MAPPING["RUB"],
#                 share_percent=100.00,
#                 share_value=9999999.99,
#                 purchase_date=datetime.datetime.strptime("16.03.1997", "%d.%m.%Y").date(),
#                 status_info_id=STATUS_INFORMATION_MAPPING["Actual"],
#             ),
#         ],
#     )
