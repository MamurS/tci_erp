from abc import ABC, abstractmethod
import asyncio
from functools import wraps
import time
from types import NoneType
from typing import Any, Callable, Dict, List, Union

from cachetools import TTLCache
from sqlalchemy import select

from src.schemas import DataForInsertionModuleScheme
from src.models import Company, Manager, Person, Shareholder
from src.database import get_async_session


class BaseAPIFinancialAndRegistrationDataAdapter(ABC):
    def __init__(self, token: str, identifier: str, request_uuid: str):
        self.token = token
        self.identifier = identifier 
        self.request_uuid = request_uuid
        self.data = {
            "companies": {},
            "persons": {},
            "companies_financial_statements": {},
            "companies_branches": {},
            "companies_contacts": {},
            "companies_addresses": {},
            "companies_activities": {},
            "companies_capitals": {},
            "companies_classifiers": {},
            "companies_licenses": {},
            "companies_sanctions": {},
            "companies_events": {},
            "companies_financial_statements_rows": {},
            "persons_contacts": {},
            "persons_addresses": {},
            "persons_sanctions": {},
            "persons_events": {},
            "managers": [],
            "shareholders": [],
        }
    
    @staticmethod
    def cache_responses(source: str, ttl: int = 86400, maxsize: int = 2500) -> Callable:
        """Декоратор с фиксированным TTL, использующий cachetools"""
        cache = TTLCache(maxsize=maxsize, ttl=ttl)
        lock = asyncio.Lock()
        stats = {'hits': 0, 'misses': 0}
        
        def decorator(func: Callable) -> Callable:
            @wraps(func)
            async def wrapper(self, *args, **kwargs) -> Union[List[Dict], Dict]:
                cache_key = f"{source}_{self.identifier}"
                now = time.time()
                
                # Выводим текущее состояние кэша
                # print("\nТекущее состояние кэша:")
                # for key, value in cache.items():
                #     print(f"• {key}: expires at {value['expires']:.1f}")
                
                async with lock:
                    entry = cache.get(cache_key)
                    if entry and now < entry['expires']:
                        stats['hits'] += 1
                        # print(f"Кэш-попадание для ключа {cache_key}")
                        return entry['data']
                    stats['misses'] += 1
                    # print(f"Кэш-промах для ключа {cache_key}")
                
                # Выполняем запрос, если нет в кэше или просрочено
                result = await func(self, *args, **kwargs)
                
                if result is not None and not isinstance(result, TypeError):
                    async with lock:
                        cache[cache_key] = {
                            'data': result,
                            'expires': now + ttl  # Фиксированное время истечения
                        }
                    # print(f"Добавлено в кэш: {cache_key} (до {now + ttl:.1f})")
                
                return result
            
            # Методы управления кэшем
            wrapper.cache_clear = cache.clear # type: ignore
            wrapper.cache_info = lambda: { # type: ignore
                'hits': stats['hits'],
                'misses': stats['misses'],
                'maxsize': maxsize,
                'currsize': len(cache),
                'ttl': ttl
            }
            
            return wrapper
        
        return decorator
    
    @abstractmethod
    async def request(self) -> Union[Dict, List, NoneType]:
        ...
    
    @abstractmethod
    async def adapt_data(self) -> DataForInsertionModuleScheme:
        ...

class BaseManualInputFinancialAndRegistrationDataAdapter(ABC):
    def __init__(self, identifier: str, request_uuid: str, data_from_manual_input_service: Dict[str, Any]):
        self.identifier = identifier 
        self.request_uuid = request_uuid
        self.data_from_manual_input_service = data_from_manual_input_service
        self.data = {
            "companies": {},
            "persons": {},
            "companies_financial_statements": {},
            "companies_branches": {},
            "companies_contacts": {},
            "companies_addresses": {},
            "companies_activities": {},
            "companies_capitals": {},
            "companies_classifiers": {},
            "companies_licenses": {},
            "companies_sanctions": {},
            "companies_events": {},
            "companies_financial_statements_rows": {},
            "persons_contacts": {},
            "persons_addresses": {},
            "persons_sanctions": {},
            "persons_events": {},
            "managers": [],
            "shareholders": [],
        }
    
    @abstractmethod
    async def adapt_data(self) -> DataForInsertionModuleScheme:
        ...


class BaseGroupDataAdapter(ABC):
    def __init__(self, token: str, identifier: str, request_uuid: str):
        self.token = token
        self.identifier = identifier 
        self.request_uuid = request_uuid
    
    async def fetch_participations(self, id_target_company: int) -> List[int]:
        async with get_async_session() as session:
            result = await session.execute(
                select(Shareholder)
                .filter(
                    Shareholder.company_shareholder_id == id_target_company
                )
            )
            participations_ids: List[int] = [participation[0].company_share_id for participation in result.all() if participation[0].company_share_id]
            return participations_ids
        
    async def fetch_companies_shareholders(self, id_target_company: int) -> List[int]:
        async with get_async_session() as session:
            result = await session.execute(
                select(Shareholder)
                .filter(
                    Shareholder.company_share_id == id_target_company
                )
            )
            
            companies_shareholders_ids: List[int] = [company_shareholder[0].company_shareholder_id for company_shareholder in result.all() if company_shareholder[0].company_shareholder_id]
            return companies_shareholders_ids
    
    async def get_company_registration_identifiers_by_ids(self, company_ids: List[int]) -> List[str]:
        async with get_async_session() as session:
            result = await session.execute(
                select(Company)
                .filter(
                    Company.id.in_(company_ids)
                )
            )
            company_registration_identifiers: List[str] = [company[0].registration_identifier_value for company in result.all() if company[0].registration_identifier_value]
            return company_registration_identifiers
    
    async def fetch_persons_shareholders(self, id_target_company: int) -> List[int]:
        async with get_async_session() as session:
            result = await session.execute(
                select(Shareholder)
                .filter(
                    Shareholder.company_share_id == id_target_company
                )
            )
            persons_shareholders_ids: List[int] = [person_shareholder[0].person_shareholder_id for person_shareholder in result.all() if person_shareholder[0].person_shareholder_id]
            return persons_shareholders_ids
    
    async def get_person_manager_ids(self, id_target_company: int) -> List[int]:
        async with get_async_session() as session:
            result = await session.execute(
                select(Manager)
                .filter(
                    Manager.company_id == id_target_company
                )
            )
            manager_ids = [manager[0].person_id for manager in result.all() if manager[0].person_id]
            return manager_ids
    
    async def get_person_identifiers_by_ids(self, person_ids: List[int]) -> List[str]:
        async with get_async_session() as session:
            result = await session.execute(
                select(Person)
                .filter(
                    Person.id.in_(person_ids)
                )
            )
            person_identifiers: list[str] = [person[0].identifier_value for person in result.all() if person[0].identifier_value]
            return person_identifiers
    
    @abstractmethod
    async def get_group_identifiers(self) -> List[str]:
        ...

class BaseCourtCaseDataAdapter(ABC):
    def __init__(self, token: str, identifier: str, request_uuid: str):
        self.token = token
        self.identifier = identifier 
        self.request_uuid = request_uuid
        self.data = None
    
    @abstractmethod
    async def _fetch_court_case(self):
        ...
    
    @abstractmethod
    async def adapt_court_case_data(self):
        ...
