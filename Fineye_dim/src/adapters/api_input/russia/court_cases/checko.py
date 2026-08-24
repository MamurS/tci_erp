import os
import sys
import datetime
from typing import Any, Dict, List, Optional
import aiohttp

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../../')))
from service_logger.app import Log
from src.schemas import CourtCase, ParticipantInCase
from src.adapters.base_adapters import BaseCourtCaseDataAdapter
from src.utils.constants.mapping import CURRENCY_MAPPING, PARTICIPANT_TYPE_MAPPING, COUNTRY_MAPPING
from src.utils.http_client import async_client


class CheckoCourtCaseDataAdapter(BaseCourtCaseDataAdapter):
    def __init__(self, token: str, identifier: str, request_uuid: str):
        super().__init__(
            token=token,
            identifier=identifier,
            request_uuid=request_uuid,
        )
    
    async def _fetch_court_case(self) -> Dict[str, Any]:
        url = "https://api.checko.ru/v2/legal-cases"
        
        params = {
            "key": self.token,
            "ogrn": self.identifier,
        }
        
        
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message=f"Попытка получить ответ от сервиса checko (КАД АРБИТР):\nidentifier: {self.identifier}."
        )
        
        # key={API-ключ}&ogrn=1137847024149
        try:
            data = await async_client.get_json(url=url, params=params)
            # FIXME
            # import json
            # with open("example_court_case.json", "w", encoding="utf-8") as file:
            #     json.dump(data, file, ensure_ascii=False)
            # FIXME
        except Exception as e:
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Не удалось получить ответ от сервиса checko (КАД АРБИТР):\nidentifier: {self.identifier}."
            )
            raise ValueError("Не удалось получить ответ от сервиса checko (КАД АРБИТР).")
        
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message=f"Получен ответ от сервиса checko (КАД АРБИТР):\nidentifier: {self.identifier}."
        )
        
        return data
    
    async def adapt_court_case_data(self) -> List[Optional[CourtCase]]:
        data_from_checko: Dict[str, Any] = await self._fetch_court_case()
        court_cases = []
        
        entries = data_from_checko.get("data", {}).get("Записи", [])
        
        for entry in entries:
            try:
                # Парсинг основных данных дела
                case_date = None
                if entry.get("Дата"):
                    case_date = datetime.datetime.strptime(entry["Дата"], "%Y-%m-%d").date()
                
                participants = []
                
                # Обработка истцов
                for plaintiff in entry.get("Ист", []):
                    inn = plaintiff.get("ИНН")
                    if inn:
                        participants.append(
                            ParticipantInCase(
                                source_info="checko",
                                is_legal_entity=True if len(str(inn)) == 10 else False,
                                participant_type=PARTICIPANT_TYPE_MAPPING["Plaintiff"],
                                subject_id=None,
                                name=plaintiff.get("Наим"),
                                identifier_type="tax_identifier" if inn else None,
                                identifier_value=inn,
                                address=plaintiff.get("Адрес")
                            )
                        )
                
                # Обработка ответчиков
                for defendant in entry.get("Ответ", []):
                    inn = defendant.get("ИНН")
                    if inn:
                        participants.append(
                            ParticipantInCase(
                                source_info="checko",
                                is_legal_entity=True if len(str(inn)) == 10 else False,
                                participant_type=PARTICIPANT_TYPE_MAPPING["Defendant"],
                                subject_id=None,
                                name=defendant.get("Наим"),
                                identifier_type="tax_identifier" if inn else None,
                                identifier_value=inn,
                                address=defendant.get("Адрес"),
                            )
                        )
                
                # Формирование объекта дела
                court_case = CourtCase(
                    source_info="checko",
                    country_id=COUNTRY_MAPPING["Russia"],
                    number=entry["Номер"],
                    court=entry.get("Суд"),
                    amount=entry.get("СуммИск"),
                    currency_id=CURRENCY_MAPPING["RUB"],
                    date=case_date,
                    participants=participants,
                )
                
                court_cases.append(court_case)
            
            except Exception as e:
                print(f"Ошибка обработки дела {entry.get('Номер')}: {e}")
        
        return court_cases
