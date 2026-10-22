import datetime
from decimal import Decimal
from types import NoneType
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

from sqlalchemy import case, func, update, and_, or_, select, Table
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from src.schemas import CompanyScheme
from src.models import Company, CompanyGroup, CourtCase, FinancialStatement, History, ParticipantInCase, Person
from src.database import get_async_session

from .constants.mapping import TRACKED_TABLE_MAPPING, DATA_TYPE_MAPPING, TABLE_UPDATING_KEYS, STATUS_INFORMATION_MAPPING


class DataInsertor:
    @staticmethod
    def __add_history_to_session(
        session: Union[Session, AsyncSession],
        tracked_table: Literal["str", "int", "float", "date", "datetime", "null"],
        row_id: int,
        column_name: str,
        data_before: Optional[Any],
        data_after: Optional[Any],
        valid_from: Optional[datetime.datetime],
        valid_to: Optional[datetime.datetime]=datetime.datetime.now(datetime.UTC)
    ) -> None:
        """
        Отправки в историю записи об изменении/неактуальности строки из таблиц БД
        """
        if isinstance(data_before, str):
            data_type_before = "str"
        elif isinstance(data_before, int):
            data_type_before = "int"
        elif isinstance(data_before, float):
            data_type_before = "float"
        elif isinstance(data_before, Decimal):
            data_type_before = "decimal"
        elif isinstance(data_before, list):
            data_type_before = "list"
        elif isinstance(data_before, datetime.date):
            data_type_before = "date"
        elif isinstance(data_before, datetime.datetime):
            data_type_before = "datetime"
        elif isinstance(data_before, NoneType):
            data_type_before = "null"
        
        if isinstance(data_after, str):
            data_type_after = "str"
        elif isinstance(data_after, int):
            data_type_after = "int"
        elif isinstance(data_after, float):
            data_type_after = "float"
        elif isinstance(data_after, Decimal):
            data_type_after = "decimal"
        elif isinstance(data_after, list):
            data_type_after = "list"
        elif isinstance(data_after, datetime.date):
            data_type_after = "date"
        elif isinstance(data_after, datetime.datetime):
            data_type_after = "datetime"
        elif isinstance(data_after, NoneType):
            data_type_after = "null"
        data_before = str(data_before)
        data_after = str(data_after)
        
        new_history_row = History(
            tracked_table_id=TRACKED_TABLE_MAPPING[tracked_table],
            row_id=row_id,
            column_name=column_name,
            data_before=data_before,
            data_after=data_after,
            data_type_before=DATA_TYPE_MAPPING[data_type_before],
            data_type_after=DATA_TYPE_MAPPING[data_type_after],
            valid_from=valid_from,
            valid_to=valid_to,
        )
        
        session.add(new_history_row)
    
    @staticmethod
    def __get_column_names_for_check(table: Any) -> List[str]:
        cols = table.__table__.columns # type: ignore
        # Собираем имена всех атрибутов, участвующих в отношениях
        relationship_keys = set(rel.key for rel in table.__mapper__.relationships) # type: ignore
        # Фильтруем столбцы, исключая те, которые принадлежат к отношениям
        display_cols = [col for col in cols if col.name not in relationship_keys]
        # Фильтрация и выбор столбцов на основе repr_cols и repr_cols_num
        selected_cols = [
            col.name for col in display_cols if col.name not in list(table.repr_cols_ignore) 
            + ["id", "actualized_at", "updated_at", "created_at"]
        ]
        return selected_cols
    
    @staticmethod
    def __analyze_data(
        existing_data: List[Dict[str, Any]],
        new_data: List[Dict[str, Any]],
        identification_keys: List[str]
    ) -> tuple[
            List[Dict[str, Any]],
            List[Dict[str, Any]],
            List[Dict[str, Any]],
        ]:
        # Преобразуем списки словарей в словари для быстрого доступа по ключам
        existing_dict = {
            tuple(item.get(key) for key in identification_keys): item for item in existing_data
        }
        new_dict = {
            tuple(Decimal(str(item.get(key))) if isinstance(item.get(key), float) else item.get(key) for key in identification_keys): item for item in new_data
        }
        
        # Находим совпадения и собираем данные с добавлением id из существующих данных
        matching_data = []
        for key_tuple, new_item in new_dict.items():
            if key_tuple in existing_dict:
                # Обновляем запись в new_data, добавляя id из существующих данных
                updated_item = {**new_item, 'id': existing_dict[key_tuple]['id']}
                matching_data.append(updated_item)
        
        # Неактуальные данные - присутствуют в существующем множестве, но отсутствуют в новом
        outdated_data = [
            item for key_tuple, item in existing_dict.items()
            if key_tuple not in new_dict
        ]
        
        # Новые данные - присутствуют в новом множестве, но отсутствуют в существующем
        new_only_data = [
            item for key_tuple, item in new_dict.items()
            if key_tuple not in existing_dict
        ]
        
        return matching_data, new_only_data, outdated_data
    
    @staticmethod
    async def __bulk_update_varied_fields(
        async_session: AsyncSession,
        table: Table,
        existing_data: List[Dict[str, Any]],
        matching_data: List[Dict[str, Any]],
    ) -> None:
        if not matching_data:
            return
        
        # Создаем словарь из existing_data для удобного доступа
        current_data = {item['id']: item for item in existing_data}
        
        # Собираем ID из переданных данных для условия запроса
        ids = [item['id'] for item in matching_data]
        
        # Формирование запроса обновления
        update_stmt = update(table).where(table.__table__.c.id.in_(ids)) # type: ignore
        update_dict = {'actualized_at': func.timezone('UTC', func.current_timestamp())}  # Обновляем actualized_at для всех
        
        # Проверка и формирование условий для каждого измененного поля
        for item in matching_data:
            current = current_data.get(item['id'])
            if not current:
                continue
            
            for key, new_value in item.items():
                if key in ['id', 'actualized_at', 'updated_at'] or new_value is None:
                    continue
                
                # Обновляем поля только если они изменились
                if current[key] != Decimal(str(new_value)) if isinstance(current[key], Decimal) else current[key] != new_value:
                    update_dict[key] = case( # type: ignore
                        *[
                            (table.__table__.c.id == item['id'], new_value)  # Устанавливаем новое значение только для текущего ID # type: ignore
                        ],
                        else_=getattr(table.__table__.c, key)  # Для всех остальных ID сохраняем текущее значение # type: ignore
                    )
                    # Добавляем обновление updated_at для измененных записей
                    update_dict['updated_at'] = case( # type: ignore
                        *[
                            (table.__table__.c.id == item['id'], func.timezone('UTC', func.current_timestamp()))  # Устанавливаем текущее время для текущего ID # type: ignore
                        ],
                        else_=getattr(table.__table__.c, 'updated_at')  # Для всех остальных ID сохраняем текущее значение # type: ignore
                    )
        
        # Применяем изменения
        update_stmt = update_stmt.values(**update_dict)
        await async_session.execute(update_stmt)
    
    @staticmethod
    async def __bulk_update_status(
        async_session: AsyncSession,
        table: Table,
        ids: List[int],
        status_info_id: int=STATUS_INFORMATION_MAPPING["Irrelevant"],
    ) -> None:
        if not ids:
            return
        stmt = update(table).where(table.__table__.c.id.in_(ids)).values( # type: ignore
            status_info_id=status_info_id,
            actualized_at=datetime.datetime.now(datetime.UTC),
            updated_at=datetime.datetime.now(datetime.UTC),
        )
        
        await async_session.execute(stmt)
    
    @staticmethod
    async def __bulk_insert_data(
        async_session: AsyncSession,
        table: Table,
        new_data: List[Dict[str, Any]],
    ) -> None:
        if not new_data:
            return
        stmt = insert(table)
        await async_session.execute(stmt, new_data)
    
    @staticmethod
    async def __actualize_and_update_property_data(
        async_session: AsyncSession,
        table_property: Table,
        existing_property_data: List[Dict[str, Any]],
        new_property_data: List[Dict[str, Any]],
    ) -> None:
        
        table_name: str = table_property.__tablename__ # type: ignore
        
        identification_keys: List[str] = TABLE_UPDATING_KEYS[table_name]["identification_keys"] # type: ignore
        needs_updating_data: bool = TABLE_UPDATING_KEYS[table_name]["needs_updating_data"] # type: ignore
        needs_updating_status: bool = TABLE_UPDATING_KEYS[table_name]["needs_updating_status"] # type: ignore
            
        matching_data, new_data, outdated_data = DataInsertor.__analyze_data(
            existing_data=existing_property_data,
            new_data=new_property_data,
            identification_keys=identification_keys,
        )
        
        if needs_updating_status and outdated_data:
            await DataInsertor.__bulk_update_status(
                async_session=async_session,
                table=table_property,
                ids=[item["id"] for item in outdated_data if item.get("id")],
            )
        if needs_updating_data and matching_data:
            await DataInsertor.__bulk_update_varied_fields(
                async_session=async_session,
                table=table_property,
                existing_data=existing_property_data,
                matching_data=matching_data,
            )
        if new_data:
            await DataInsertor.__bulk_insert_data(
                async_session=async_session,
                table=table_property,
                new_data=new_data,
            )
        await async_session.commit()
    
    @staticmethod
    def to_decimal_if_float(value):
        """Приводит float и Decimal к Decimal, остальные типы возвращает как есть."""
        if isinstance(value, float):
            return Decimal(str(value))  # избегаем ошибок двоичного представления float
        elif isinstance(value, Decimal):
            return value
        return value  # int, str, bool и др. не трогаем
    
    @classmethod
    async def __actualize_and_update_subject_data(
        cls,
        async_session: AsyncSession,
        table_subject: Any,
        existing_subject_data: Dict[str, Any],
        new_subject_data: Dict[str, Any],
    ) -> int:
        
        actualized_at: datetime.datetime = existing_subject_data.get("actualized_at") # type: ignore
        created_at: datetime.datetime = existing_subject_data.get("created_at") # type: ignore
        row_id: int = existing_subject_data.get("id") # type: ignore
        valid_from=(
            actualized_at
            if actualized_at
            else created_at
            if created_at
            else None
        )
        values_for_update: Dict[str, Any] = {
            "actualized_at": datetime.datetime.now(datetime.UTC)
        }
        for column_name in DataInsertor.__get_column_names_for_check(table=table_subject):
            old_value = existing_subject_data.get(column_name)
            new_value = new_subject_data.get(column_name)
            if new_value is None:
                continue
            
            is_changed = cls.to_decimal_if_float(old_value) != cls.to_decimal_if_float(new_value)
            
            if is_changed:
                try:
                    if table_subject != CourtCase and table_subject != ParticipantInCase:
                        DataInsertor.__add_history_to_session(
                            session=async_session,
                            tracked_table=table_subject.__tablename__, # type: ignore
                            row_id=row_id,
                            column_name=column_name,
                            data_before=old_value,
                            data_after=new_value,
                            valid_from=valid_from,
                        )
                except Exception as e:
                    import traceback
                    error_message = str(e)
                    formatted_traceback = traceback.format_exc()
                    log_content = f"{error_message}\n{formatted_traceback}"
                    # print(f"{log_content=}")
                
                values_for_update[column_name] = new_value
                values_for_update["updated_at"] = datetime.datetime.now(datetime.UTC)
        
        stmt = (
            update(table_subject)
            .where(
                table_subject.id == row_id # type: ignore
            )
            .values(**values_for_update)
        ).returning(table_subject.id) # type: ignore
        
        stmt_result = await async_session.execute(stmt)
        data_from_stmt_result = stmt_result.one_or_none()
        id: int = data_from_stmt_result[0] if data_from_stmt_result else None # type: ignore
        
        return id
    
    @classmethod
    async def insert_properties_information(
        cls,
        table_property: Any,
        data_property: List[Dict[str, Any]],
        ids_subject: Dict[str, int],
        keys_subject: Union[str, Tuple[str]],
    ) -> None:
        async with get_async_session() as async_session:
            if isinstance(keys_subject, str):
                subject_id = ids_subject[keys_subject]
                if keys_subject.startswith("company"):
                    fk_field_name = "company_id"
                elif keys_subject.startswith("person"):
                    fk_field_name = "person_id"
                elif keys_subject.startswith("financial_statement"):
                    fk_field_name = "financial_statement_id"
                
                data_with_parent_id: List[Dict[str, Any]] = [
                    {**property_object, fk_field_name: subject_id}
                    for property_object in data_property
                    ]
                query = (
                    select(table_property)
                    .filter(getattr(table_property, fk_field_name) == subject_id)
                ).with_for_update(read=True)
            elif isinstance(keys_subject, tuple):
                data_with_parent_id: List[Dict[str, Any]] = [
                    {**property_object, **{key_subject: ids_subject.get(property_object[key_subject]) for key_subject in keys_subject}}
                    for property_object in data_property
                ]
                conditions = [
                    and_(
                        *[getattr(table_property.__table__.c, key_subject) == item.get(key_subject) for key_subject in keys_subject]
                    ) for item in data_with_parent_id
                ]
                query = (
                    select(table_property)
                    .where(or_(*conditions))
                ).with_for_update(read=True)
            query_result = await async_session.execute(query)
            objects = [row[0].to_dict() for row in query_result.all()]
            if not objects:
                new_properties_stmt = (
                    insert(table_property)
                    .values(data_with_parent_id)
                )
                await async_session.execute(new_properties_stmt)
            else:
                await cls.__actualize_and_update_property_data(
                    async_session=async_session,
                    table_property=table_property,
                    existing_property_data=objects,
                    new_property_data=data_with_parent_id,
                )        
            await async_session.commit()
    
    @classmethod
    async def insert_subject_information(
        cls,
        table_subject: Any,
        data_subject: Dict[str, Any],
        subject_keys_ids: Dict[str, int],
        key_subject: str,
        subject_property_parent_id: Optional[int]=None,
    ) -> None:
        async with get_async_session() as async_session:
            if table_subject == Company:
                query = (
                    select(table_subject)
                    .where(
                        table_subject.registration_identifier_value == data_subject.get("registration_identifier_value"),
                    )
                ).with_for_update(read=True)
            elif table_subject == Person:
                query = (
                    select(table_subject)
                    .where(
                        table_subject.identifier_value == data_subject.get("identifier_value"),
                    )
                ).with_for_update(read=True)
            elif table_subject == FinancialStatement:
                query = (
                    select(table_subject)
                    .where(
                        and_(
                            table_subject.company_id == subject_property_parent_id,
                            table_subject.date == data_subject.get("date"),
                            table_subject.period_type_id == data_subject.get("period_type_id")
                        )
                    )
                ).with_for_update(read=True)
                data_subject.update({"company_id": subject_property_parent_id})
            
            query_result = await async_session.execute(query)
            data_from_query_result = query_result.one_or_none()
            
            object = data_from_query_result[0].to_dict() if data_from_query_result else None # type: ignore
            if not object:
                new_subject_stmt = (
                    insert(table_subject)
                    .values(data_subject)
                ).returning(table_subject.id)
                new_subject = await async_session.execute(new_subject_stmt)
                id = new_subject.scalar()
            else:
                id = await cls.__actualize_and_update_subject_data(
                    async_session=async_session,
                    table_subject=table_subject,
                    existing_subject_data=object,
                    new_subject_data=data_subject,
                )
            subject_keys_ids[key_subject] = id # type: ignore
            await async_session.commit()
    
    @classmethod
    async def insert_court_case_information(cls, data: Dict[str, Any], is_participant_info: bool) -> int:
        async with get_async_session() as async_session:
            if is_participant_info:
                table = ParticipantInCase
                query = (
                    select(table)
                    .where(
                        and_(
                            table.court_case == data.get("court_case"),
                            table.identifier_type == data.get("identifier_type"),
                            table.identifier_value == data.get("identifier_value"),
                        )
                    )
                ).with_for_update(read=True)
            else:
                table = CourtCase
                query = (
                    select(table)
                    .where(
                        and_(
                            table.country_id == data.get("country_id"),
                            table.number == data.get("number"),
                        )
                    )
                ).with_for_update(read=True)
            
            query_result = await async_session.execute(query)
            data_from_query_result = query_result.one_or_none()
            
            object = data_from_query_result[0].to_dict() if data_from_query_result else None # type: ignore
            
            if not object:
                new_subject_stmt = (
                    insert(table)
                    .values(data)
                ).returning(table.id)
                new_subject = await async_session.execute(new_subject_stmt)
                id = new_subject.scalar()
            else:
                id = await cls.__actualize_and_update_subject_data(
                    async_session=async_session,
                    table_subject=table,
                    existing_subject_data=object,
                    new_subject_data=data,
                )
            
            await async_session.commit()
            
            return id
    
    @classmethod
    async def update_relation_company_participant_in_case(
        cls,
        company_identifier_type: Literal["tax_identifier", "registration_identifier"],
        reg_info: CompanyScheme,
    ) -> None:
        async with get_async_session() as async_session:
            _filters = [Company.country_id == reg_info.country_id]
            if company_identifier_type == "tax_identifier":
                _filters.append(Company.tax_identifier_value == reg_info.tax_identifier_value)
            elif company_identifier_type == "registration_identifier":
                _filters.append(Company.registration_identifier_value == reg_info.registration_identifier_value)
            
            query = (
                select(Company.id)
                .where(
                    and_(
                        *_filters
                    )
                )
            )
            query_result = await async_session.execute(query)
            company_id: Optional[int] = query_result.scalar_one_or_none()
            
            if company_id:
                _filters_for_update = [
                    ParticipantInCase.is_legal_entity == True, # noqa: E712
                    ParticipantInCase.identifier_type == company_identifier_type,
                ]
                if company_identifier_type == "tax_identifier":
                    _filters_for_update.append(ParticipantInCase.identifier_value == reg_info.tax_identifier_value)
                elif company_identifier_type == "registration_identifier":
                    _filters_for_update.append(ParticipantInCase.identifier_value == reg_info.registration_identifier_value)
                
                stmt = (
                    update(ParticipantInCase)
                    .where(
                        and_(
                            *_filters_for_update
                        )
                    )
                    .values(
                        subject_id=company_id
                    )
                )
                
                stmt_change_flag = (
                    update(Company)
                    .where(Company.id == company_id)
                    .values(with_court_case=True)
                )
                
                await async_session.execute(stmt)
                await async_session.execute(stmt_change_flag)
                await async_session.commit()
            
            else:
                raise AssertionError("По указанному идентификатору в БД не найдена запись о ЮЛ (актуализация участников судебных дел)")
    
    @classmethod
    async def update_group_identifiers(
        cls,
        country_id: int,
        registration_identifier: str,
    ) -> None:
        async with get_async_session() as async_session:
            _filters = [
                Company.country_id == country_id,
                Company.registration_identifier_value == registration_identifier,
            ]
            query = (
                select(Company.id)
                .where(
                    and_(
                        *_filters
                    )
                )
            )
            query_result = await async_session.execute(query)
            company_id: Optional[int] = query_result.scalar_one_or_none()
            if company_id:
                c_g_query = (
                    select(CompanyGroup.relations)
                    .filter(CompanyGroup.company_id == company_id)
                )
                c_g_query_result = await async_session.execute(c_g_query)
                relations: Optional[List[str]] = c_g_query_result.scalar_one_or_none()
                if relations:
                    r_ids_query = (
                        select(Company.id, Company.country_id, Company.registration_identifier_value)
                        .filter(
                            and_(
                                Company.country_id == country_id,  # FIXME тут нужно будет сделать гибче со странами в будущем(!)
                                Company.registration_identifier_value.in_(relations)
                            )
                        )
                    )
                    r_ids_query_result = await async_session.execute(r_ids_query)
                    companies_objects = [(item[0], item[1], item[2]) for item in r_ids_query_result.all()]
                    if companies_objects:
                        for company_id, country_id_, registration_identifier_ in companies_objects:
                            await cls.company_group_identifiers_insert_or_update(
                                company_id=company_id,
                                country_id=country_id_,
                                company_identifier=registration_identifier_,
                                source_info=f'Актуализация группы (по rid "{registration_identifier}" | country {country_id} )',
                                new_group=relations,
                            )
            
            else:
                raise AssertionError("По указанному идентификатору в БД не найдена запись о ЮЛ (актуализация группы)")
    
    @staticmethod
    async def company_group_identifiers_insert_or_update(
        company_id: int,
        country_id: Optional[int],
        company_identifier: Optional[str],
        source_info: str,
        new_group: Tuple[Optional[str]],
    ) -> None:
        async with get_async_session() as async_session:
            query = (
                select(CompanyGroup)
                .where(CompanyGroup.company_id == company_id)
                .with_for_update()
            )
            
            company_group_response = await async_session.execute(query)
            company_group_object = company_group_response.one_or_none()
            if new_group:
                data = {
                    "company_id": company_id,
                    "relations": list(new_group),
                    "source_info": source_info,
                }
                if company_identifier:
                    data.update(
                        {
                            "company_identifier_value": company_identifier,
                        }
                    )
                if country_id:
                    data.update(
                        {
                            "country_id": country_id,
                        }
                    )
                
                if company_group_object:  # Если в БД есть запись, то обновляем...
                    company_group_object_data = company_group_object[0]
                    data.update(
                        {
                            "relations": list(set(company_group_object_data.relations + list(new_group))) if company_group_object_data.relations else list(new_group),
                            "updated_at": datetime.datetime.now(tz=datetime.timezone.utc),
                        }
                    )
                    stmt = (
                        update(CompanyGroup)
                        .where(CompanyGroup.company_id == company_id)
                        .values(data)
                    )
                else:  # Иначе создаем запись
                    stmt = (
                        insert(CompanyGroup)
                        .values(data)
                    )
                
                await async_session.execute(stmt)
                await async_session.commit()
