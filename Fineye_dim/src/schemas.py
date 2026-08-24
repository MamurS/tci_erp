import datetime
from types import NoneType
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel

from .utils.constants.mapping import (
    COUNTRY_FOR_KEYS, CURRENCY_FOR_KEYS,
    FINANCIAL_STATEMENT_ROW_TYPE_FOR_KEYS,
    FINANCIAL_STATEMENT_PERIOD_TYPE_FOR_KEYS,
    STATUS_INFORMATION_FOR_KEYS, TRACKED_TABLE_FOR_KEYS,
    CONTACT_TYPE_FOR_KEYS, DATA_TYPE_FOR_KEYS,
    PARTICIPANT_TYPE_FOR_KEYS,
)


# Literals
# ______________________________________________________________________
CompanyKey: type = Literal[*[f"company_{num}" for num in range(1, 1000)]] # type: ignore
CompanyKeyOptional: type = Optional[CompanyKey] # type: ignore
PersonKey: type = Literal[*[f"person_{num}" for num in range(1, 1000)]] # type: ignore
PersonKeyOptional: type = Optional[PersonKey] # type: ignore
FinancialStatementKey: type = Literal[*[f"financial_statement_{num}" for num in range(1, 10000)]] # type: ignore

CountryKey: type = Literal[*COUNTRY_FOR_KEYS] # type: ignore
CountryKeyOptional: type = Optional[CountryKey] # type: ignore
CurrencyKey: type = Optional[Literal[*CURRENCY_FOR_KEYS]] # type: ignore
FinancialStatementRowTypeKey: type = Optional[Literal[*FINANCIAL_STATEMENT_ROW_TYPE_FOR_KEYS]] # type: ignore
FinancialStatementPeriodTypeKey: type = Literal[*FINANCIAL_STATEMENT_PERIOD_TYPE_FOR_KEYS] # type: ignore
StatusInformationKey: type = Optional[Literal[*STATUS_INFORMATION_FOR_KEYS]]  # type: ignore
TrackedTableKey: type = Literal[*TRACKED_TABLE_FOR_KEYS] # type: ignore
ContactTypeKey: type = Literal[*CONTACT_TYPE_FOR_KEYS] # type: ignore
DataTypeKey: type = Literal[*DATA_TYPE_FOR_KEYS] # type: ignore
ParticipantTypeKey: type = Literal[*PARTICIPANT_TYPE_FOR_KEYS] # type: ignore
# ______________________________________________________________________

# Properties & Attributes:
# ______________________________________________________________________
class CompanyBranchScheme(BaseModel):
    main_identifier: Optional[str]
    sub_identifier: Optional[str]
    type: Optional[str]
    founding_date: Optional[datetime.date]
    status_info_id: StatusInformationKey # type: ignore

class ActivityScheme(BaseModel):
    is_main: Optional[bool]
    code: Optional[str]
    description: Optional[str]
    date: Optional[datetime.date]
    status_info_id: StatusInformationKey # type: ignore

class CapitalScheme(BaseModel):
    value: Optional[float]
    currency_id: CurrencyKey # type: ignore
    type: Optional[str]
    date: Optional[datetime.date]
    status_info_id: StatusInformationKey # type: ignore

class FinancialStatementRowScheme(BaseModel):
    type_id: FinancialStatementRowTypeKey # type: ignore
    name: str
    value: float
    status_info_id: StatusInformationKey # type: ignore

class ClassifierScheme(BaseModel):
    name: Optional[str]
    value: Optional[str]
    description: Optional[str]
    status_info_id: StatusInformationKey # type: ignore

class LicenseScheme(BaseModel):
    license_identifier: Optional[str]
    license_body: Optional[str]
    licensee: Optional[str]
    valid_from: Optional[datetime.date]
    valid_to: Optional[datetime.date]
    status_info_id: StatusInformationKey # type: ignore

class AddressScheme(BaseModel):
    country_id: CountryKeyOptional # type: ignore
    address_type: Optional[str]
    region_code: Optional[str]
    zip: Optional[str]
    full_address: Optional[str]
    region: Optional[str]
    area: Optional[str]
    locality: Optional[str]
    street: Optional[str]
    house: Optional[str]
    frame: Optional[str]
    room: Optional[str]
    date_from: Optional[datetime.date]
    status_info_id: StatusInformationKey # type: ignore

class ContactScheme(BaseModel):
    contact_type_id: ContactTypeKey # type: ignore
    value: str
    status_info_id: StatusInformationKey # type: ignore

class SanctionScheme(BaseModel):
    country_id: CountryKeyOptional # type: ignore
    description: Optional[str]
    status_info_id: StatusInformationKey # type: ignore
# ______________________________________________________________________

# Information atoms:
# ______________________________________________________________________
class CompanyScheme(BaseModel):
    source_info: Optional[str]
    important_information: Optional[str]
    country_id: CountryKey # type: ignore
    registration_identifier_name: Optional[str]
    registration_identifier_value: Optional[str]
    tax_identifier_name: Optional[str]
    tax_identifier_value: Optional[str]
    status: Optional[str]
    short_name: Optional[str]
    full_name: Optional[str]
    short_name_en: Optional[str]
    full_name_en: Optional[str]
    founding_date: Optional[datetime.date]
    termination_date: Optional[datetime.date]
    is_financial_company: Optional[bool]
    foreigners_founders: Optional[List[List]] = None
# ______________________________________________________________________

# ______________________________________________________________________
class FinancialStatementScheme(BaseModel):
    source_info: Optional[str]
    period_type_id: FinancialStatementPeriodTypeKey # type: ignore
    date: datetime.date
    currency_id: CurrencyKey # type: ignore
# ______________________________________________________________________

# ______________________________________________________________________
class PersonScheme(BaseModel):
    source_info: Optional[str]
    important_information: Optional[str]
    surname: Optional[str]
    first_name: Optional[str]
    patronymic: Optional[str]
    date_birth: Optional[datetime.date]
    gender: Optional[str]
    citizenship: CountryKeyOptional # type: ignore
    identifier_name: Optional[str]
    identifier_value: Optional[str]
    identifier_sub_name: Optional[str]
    identifier_sub_value: Optional[str]
# ______________________________________________________________________    

# ______________________________________________________________________
class ManagerScheme(BaseModel):
    source_info: Optional[str]
    person_id: PersonKey # type: ignore
    company_id: CompanyKey # type: ignore
    job_title: Optional[str]
    supervisor: Optional[bool]
    appointment_date: Optional[datetime.date]
    important_information: Optional[str]
    status_info_id: StatusInformationKey # type: ignore
# ______________________________________________________________________

# ______________________________________________________________________
class ShareholderScheme(BaseModel):
    source_info: Optional[str]
    company_shareholder_id: CompanyKeyOptional # type: ignore
    person_shareholder_id: PersonKeyOptional # type: ignore
    company_share_id: CompanyKey # type: ignore
    currency_id: CurrencyKey # type: ignore
    share_percent: Union[float, int, NoneType]
    share_value: Union[float, int, NoneType]
    purchase_date: Optional[datetime.date]
    status_info_id: StatusInformationKey # type: ignore
# ______________________________________________________________________

# ______________________________________________________________________
class EventScheme(BaseModel):
    source_info: Optional[str]
    date: Optional[datetime.date]
    description: Optional[str]
    status_info_id: StatusInformationKey # type: ignore
# ______________________________________________________________________


# ______________________________________________________________________
class ParticipantInCase(BaseModel):
    source_info: Optional[str]
    is_legal_entity: bool
    participant_type: ParticipantTypeKey # type: ignore
    subject_id: Optional[int]
    name: Optional[str]
    identifier_type: Optional[Literal["tax_identifier", "registration_identifier"]]
    identifier_value: Optional[str]
    address: Optional[str]

class CourtCase(BaseModel):
    source_info: Optional[str]
    country_id: CountryKey # type: ignore
    number: str
    court: Optional[str]
    amount: Union[float, int, NoneType]
    currency_id: int
    date: Optional[datetime.date]
    participants: List[Optional[ParticipantInCase]]
# ______________________________________________________________________

# ______________________________________________________________________
class DataForInsertionModuleScheme(BaseModel):
    # Subjects
    companies: Optional[Dict[CompanyKey, CompanyScheme]] # type: ignore
    persons: Optional[Dict[PersonKey, PersonScheme]] # type: ignore
    
    # Subjects properties
    # companies
    companies_financial_statements: Optional[Dict[CompanyKey, Dict[FinancialStatementKey, Optional[FinancialStatementScheme]]]] # type: ignore
    # persons
    # ...
    
    # Properties
    # companies
    companies_branches: Optional[Dict[CompanyKey, List[Optional[CompanyBranchScheme]]]] # type: ignore
    companies_contacts: Optional[Dict[CompanyKey, List[Optional[ContactScheme]]]] # type: ignore
    companies_addresses: Optional[Dict[CompanyKey, List[Optional[AddressScheme]]]] # type: ignore
    companies_activities: Optional[Dict[CompanyKey, List[Optional[ActivityScheme]]]] # type: ignore
    companies_capitals: Optional[Dict[CompanyKey, List[Optional[CapitalScheme]]]] # type: ignore
    companies_classifiers: Optional[Dict[CompanyKey, List[Optional[ClassifierScheme]]]] # type: ignore
    companies_licenses: Optional[Dict[CompanyKey, List[Optional[LicenseScheme]]]] # type: ignore
    companies_sanctions: Optional[Dict[CompanyKey, List[Optional[SanctionScheme]]]] # type: ignore
    companies_events: Optional[Dict[CompanyKey, List[Optional[EventScheme]]]] # type: ignore
    
    # financial statements
    companies_financial_statements_rows: Optional[Dict[FinancialStatementKey, List[Optional[FinancialStatementRowScheme]]]] # type: ignore
    
    # persons
    persons_contacts: Optional[Dict[PersonKey, List[Optional[ContactScheme]]]] # type: ignore
    persons_addresses: Optional[Dict[PersonKey, List[Optional[AddressScheme]]]] # type: ignore
    persons_sanctions: Optional[Dict[PersonKey, List[Optional[SanctionScheme]]]] # type: ignore
    persons_events: Optional[Dict[PersonKey, List[Optional[EventScheme]]]] # type: ignore
    
    # Relations
    managers: Optional[List[Optional[ManagerScheme]]]
    shareholders: Optional[List[Optional[ShareholderScheme]]]
    
    # Court cases
    company_identifier_type_for_court_case: Optional[Literal["tax_identifier", "registration_identifier"]] = None
    companies_court_cases: Optional[Dict[CompanyKey, List[Optional[CourtCase]]]] = {} # type: ignore
    
    # TODO возможно нужна будет такая же логика как и для компании с выбором типа идентификатора(person_identifier_type_for_court_case), для проставления ссылок(внешних ключей) в участников дела -> ФЛ(Person)  | смотри реализацию DIM.update_relation_company_participant_in_case
    persons_court_cases: Optional[Dict[PersonKey, List[Optional[CourtCase]]]] = {} # type: ignore
# ______________________________________________________________________
