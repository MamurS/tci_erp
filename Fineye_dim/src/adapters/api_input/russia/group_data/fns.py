import os
import sys
import asyncio
from asyncio import Lock
from typing import Dict, List, Set

from sqlalchemy import and_, select


from src.utils.common import split_list_into_chunks
from src.utils.data_insertion import DataInsertor

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../../')))
from src.utils.constants.mapping import COUNTRY_MAPPING
from service_logger.app import Log
from src.adapters.base_adapters import BaseGroupDataAdapter
from src.database import get_async_session
from src.models import Company
from src.utils.http_client import sync_client, async_client


class FNSGroupDataAdapter(BaseGroupDataAdapter):
    def __init__(self, token: str, identifier: str, request_uuid: str):
        super().__init__(
            token=token,
            identifier=identifier,
            request_uuid=request_uuid,
        )
    
    @staticmethod
    async def get_search_fns_method(params: Dict[str, str]) -> Dict:
        data = await async_client.get_json("https://api-fns.ru/api/search", params=params)
        return data
    
    @staticmethod
    def get_search_fns_method_sync(params: Dict[str, str]) -> Dict:
        data = sync_client.get_json(url="https://api-fns.ru/api/search", params=params,)
        return data
    
    async def get_group_identifiers(self) -> List[str]:
        identifiers: Set[str] = set()
        
        async with get_async_session() as session:
            query_target_company = (
                select(Company)
                .filter(
                    and_(
                        Company.registration_identifier_value == self.identifier,
                        Company.country_id == COUNTRY_MAPPING["Russia"],
                    )
                )
            )
            result_query_target_company = await session.execute(query_target_company)
            data_query_target_company = result_query_target_company.one_or_none()
            id_target_company: int = data_query_target_company[0].id if data_query_target_company else None # type: ignore
            
            assert id_target_company, "Не найден id целевой компании."
            
            query_tasks: List[asyncio.Task] = []
            participations_task = asyncio.create_task(self.fetch_participations(id_target_company=id_target_company))
            companies_shareholders_task = asyncio.create_task(self.fetch_companies_shareholders(id_target_company=id_target_company))
            persons_shareholders_task = asyncio.create_task(self.fetch_persons_shareholders(id_target_company=id_target_company))
            persons_managers_task = asyncio.create_task(self.get_person_manager_ids(id_target_company=id_target_company))
            query_tasks.extend(
                [participations_task, companies_shareholders_task, persons_shareholders_task, persons_managers_task,]
            )
            for chunk in split_list_into_chunks(list_=query_tasks, chunk_size=10):
                await asyncio.gather(*chunk)
            
            participation_ids: List[int] = participations_task.result()
            company_shareholder_ids: List[int] = companies_shareholders_task.result()
            person_shareholder_ids: List[int] = persons_shareholders_task.result()
            manager_ids: List[int] = persons_managers_task.result()
            
            group_ids: List[int] = list(set(participation_ids + company_shareholder_ids))
            persons_shareholders_and_managers_ids: List[int] = list(set(person_shareholder_ids + manager_ids))
            
            group_registration_identifiers: List[str] = await self.get_company_registration_identifiers_by_ids(company_ids=group_ids)
            identifiers.update(group_registration_identifiers)
            
            persons_identifiers: List[str] = list(set(await self.get_person_identifiers_by_ids(person_ids=persons_shareholders_and_managers_ids)))
            
            fns_search_tasks: List[asyncio.Task] = []
            for person_identifier in persons_identifiers:
                params = {
                    'q': person_identifier,
                    'key': self.token,
                }
                fns_search_task = asyncio.create_task(self.get_search_fns_method(params=params))
                
                fns_search_tasks.append(fns_search_task)
            
            responses: List[asyncio.Future] = []
            for chunk in split_list_into_chunks(list_=fns_search_tasks, chunk_size=10):
                responses.extend(await asyncio.gather(*chunk))
            
            # Первый уровень (исходный код)
            first_level_ogrn = set()
            for response_future in responses:
                response: Dict = response_future
                if response and response.get("items", None):
                    for item in response["items"]:
                        if list(item)[0] == "ЮЛ":
                            if item["ЮЛ"].get("ОГРН", None) and item["ЮЛ"].get("ГдеНайдено") and not item["ЮЛ"]["ГдеНайдено"].startswith("ИНН бывшего"):
                                ogrn = item["ЮЛ"]["ОГРН"]
                                first_level_ogrn.add(ogrn)
            
            # Второй уровень (ищем компании, связанные с найденными компаниями)
            second_level_ogrn = set()
            if first_level_ogrn:
                second_level_responses = []
                for ogrn in first_level_ogrn:
                    params = {'q': ogrn, 'key': self.token}
                    second_level_responses.append(await self.get_search_fns_method(params=params))
                
                for response in second_level_responses:
                    if response and response.get("items", None):
                        for item in response["items"]:
                            if list(item)[0] == "ЮЛ":
                                if item["ЮЛ"].get("ОГРН", None) and item["ЮЛ"].get("ГдеНайдено") and not item["ЮЛ"]["ГдеНайдено"].startswith("ИНН бывшего"):
                                    ogrn = item["ЮЛ"]["ОГРН"]
                                    second_level_ogrn.add(ogrn)
            
            # Третий уровень (ищем компании, связанные с компаниями второго уровня)
            if second_level_ogrn:
                third_level_responses = []
                for ogrn in second_level_ogrn:
                    params = {'q': ogrn, 'key': self.token}
                    third_level_responses.append(await self.get_search_fns_method(params=params))
                
                for response in third_level_responses:
                    if response and response.get("items", None):
                        for item in response["items"]:
                            if list(item)[0] == "ЮЛ":
                                if item["ЮЛ"].get("ОГРН", None) and item["ЮЛ"].get("ГдеНайдено") and not item["ЮЛ"]["ГдеНайдено"].startswith("ИНН бывшего"):
                                    ogrn = item["ЮЛ"]["ОГРН"]
                                    identifiers.add(ogrn)
            
            # Добавляем все найденные идентификаторы (со всех уровней)
            identifiers.update(first_level_ogrn)
            identifiers.update(second_level_ogrn)
        
        await DataInsertor.company_group_identifiers_insert_or_update(
            company_id=id_target_company,
            country_id=COUNTRY_MAPPING["Russia"],
            company_identifier=self.identifier,
            source_info="ФНС России",
            new_group=tuple(identifiers)
        )
        
        return tuple(identifiers)



if __name__ == "__main__":
    async def main():
        identifiers = await FNSGroupDataAdapter(token="070bbb6a6fa0e2ed3f5e9ce18de83856b656513c", request_uuid="test", identifier="1123327005603").get_group_identifiers()
        print(identifiers)
    
    asyncio.run(main())
