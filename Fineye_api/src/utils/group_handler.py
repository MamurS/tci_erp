
import asyncio
from typing import List, Set, Tuple

from sqlalchemy import select

from src.data_insertion_module.models import Company, CompanyGroup, Manager, Person, Shareholder
from connection_manager import async_session_maker


class GroupHandler:
    async def fetch_participations(self, id_target_company: int) -> List[int]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Shareholder)
                .filter(
                    Shareholder.company_shareholder_id == id_target_company
                )
            )
            participations_ids: List[int] = [participation[0].company_share_id for participation in result.all() if participation[0].company_share_id]
            return participations_ids
        
    async def fetch_companies_shareholders(self, id_target_company: int) -> List[int]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Shareholder)
                .filter(
                    Shareholder.company_share_id == id_target_company
                )
            )
            
            companies_shareholders_ids: List[int] = [company_shareholder[0].company_shareholder_id for company_shareholder in result.all() if company_shareholder[0].company_shareholder_id]
            return companies_shareholders_ids
    
    async def get_company_registration_identifiers_by_ids(self, company_ids: List[int]) -> List[str]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Company)
                .filter(
                    Company.id.in_(company_ids)
                )
            )
            company_registration_identifiers: List[str] = [company[0].registration_identifier_value for company in result.all() if company[0].registration_identifier_value]
            return company_registration_identifiers
    
    async def fetch_persons_shareholders(self, id_target_company: int) -> List[int]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Shareholder)
                .filter(
                    Shareholder.company_share_id == id_target_company
                )
            )
            persons_shareholders_ids: List[int] = [person_shareholder[0].person_shareholder_id for person_shareholder in result.all() if person_shareholder[0].person_shareholder_id]
            return persons_shareholders_ids
    
    async def get_person_manager_ids(self, id_target_company: int) -> List[int]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Manager)
                .filter(
                    Manager.company_id == id_target_company
                )
            )
            manager_ids = [manager[0].person_id for manager in result.all() if manager[0].person_id]
            return manager_ids
    
    async def get_person_identifiers_by_ids(self, person_ids: List[int]) -> List[str]:
        async with async_session_maker() as session:
            result = await session.execute(
                select(Person)
                .filter(
                    Person.id.in_(person_ids)
                )
            )
            person_identifiers: List[str] = [person[0].identifier_value for person in result.all() if person[0].identifier_value]
            return person_identifiers
    
    async def search_group_company_ids_by_person_ids(self, person_ids: List[int]) -> Tuple[str]:
        async with async_session_maker() as session:
            result_shareholder = await session.execute(
                select(Shareholder)
                .filter(Shareholder.person_shareholder_id.in_(person_ids))
            )
            
            result_manager = await session.execute(
                select(Manager)
                .filter(Manager.person_id.in_(person_ids))
            )
            
            company_ids: List[int] = tuple(set([
                shareholder_object[0].company_share_id for shareholder_object in result_shareholder.all() if shareholder_object[0].company_share_id
            ] + [
                manager_object[0].company_id for manager_object in result_manager.all() if manager_object[0].company_id
            ]))
            return company_ids
    
    async def find_relationships(
        self,
        company_id: int,
    ) -> Set[int]:
        query_tasks: List[asyncio.Task] = []
        participations_task = asyncio.create_task(self.fetch_participations(id_target_company=company_id))
        companies_shareholders_task = asyncio.create_task(self.fetch_companies_shareholders(id_target_company=company_id))
        persons_shareholders_task = asyncio.create_task(self.fetch_persons_shareholders(id_target_company=company_id))
        persons_managers_task = asyncio.create_task(self.get_person_manager_ids(id_target_company=company_id))
        
        query_tasks.extend(
            [participations_task, companies_shareholders_task, persons_shareholders_task, persons_managers_task,]
        )
        await asyncio.gather(*query_tasks)
        
        participation_ids: List[int] = participations_task.result()
        company_shareholder_ids: List[int] = companies_shareholders_task.result()
        person_shareholder_ids: List[int] = persons_shareholders_task.result()
        manager_ids: List[int] = persons_managers_task.result()
        
        group_company_ids_by_participation: List[int] = list(set(participation_ids + company_shareholder_ids))
        persons_shareholders_and_managers_ids: List[int] = list(set(person_shareholder_ids + manager_ids))
        
        group_company_ids_by_persons: List[int] = list(await self.search_group_company_ids_by_person_ids(person_ids=persons_shareholders_and_managers_ids))
        group_company_ids = set(group_company_ids_by_persons + [company_id] + group_company_ids_by_participation)
        
        return group_company_ids
    
    async def get_company_group(
        self,
        company_id: int,
    ) -> Set[int]:
        async with async_session_maker() as session:
            result_company_group = await session.execute(
                select(CompanyGroup)
                .where(CompanyGroup.company_id == company_id)
            )
            company_group_object = result_company_group.one_or_none()
            if company_group_object:
                company_group_object = company_group_object[0]
                query = (
                    select(Company.id)
                    .where(
                        Company.registration_identifier_value.in_(company_group_object.relations)
                    )
                )
                response = await session.execute(query)
                result = set(response.scalars().all())
                
                return set(result)
            else:
                print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
                return set()
    
    async def gather_group(
        self,
        company_id: int,
        group_company_ids: Set[int],
    ) -> Set[int]:
        processed_group_company_ids: List[int] = [company_id]
        
        result_group = set(group_company_ids) if group_company_ids else set()
        result_group.update(await self.find_relationships(company_id=company_id,))
        
        new_group_company_ids: Set[int] = set()
        
        for company_identifier in result_group:
            if company_identifier not in processed_group_company_ids:
                new_group_company_ids.update(await self.find_relationships(company_id=company_identifier,))
                processed_group_company_ids.append(company_identifier)
        
        result_group.update(new_group_company_ids)
        
        for company_identifier in result_group:
            if company_identifier not in processed_group_company_ids:
                new_group_company_ids.update(await self.find_relationships(company_id=company_identifier,))
                processed_group_company_ids.append(company_identifier)
        
        result_group.update(new_group_company_ids)
        
        return result_group
