from typing import Any, Literal, Optional
from pydantic import BaseModel

from src.utils.constants.data_insertion_module.mapping import COUNTRY_FOR_KEYS

CountryKey: type = Literal[*COUNTRY_FOR_KEYS] # type: ignore

RequestedLimitCurrencyMap: type = Literal["USD", "EUR", "RUB", "MNT", "UZT", "KZT", "AED",]

ReportCurrencyMap: type = Literal["ORIGINAL", "USD", "EUR"]

LanguageMap: type = Literal["English", "Russian", "Uzbek", "Mongolian", "Kazakh",]

class AMQPConnectionScheme(BaseModel):
    username: str
    password: str
    queuename: str

class PrepareInformationScheme(BaseModel):
    country: CountryKey # type: ignore
    identifier: str
    with_group: bool = False
    with_court_cases: bool = False

class GetInformationScheme(BaseModel):
    type: Literal["company_full", "company_full_with_group"]
    country: CountryKey # type: ignore
    identifier: str


class ResponseScheme(BaseModel):
    status: bool
    msg: str
    data: Optional[Any]
    request_uuid: Optional[str]
