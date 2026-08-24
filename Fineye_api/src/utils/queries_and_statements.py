import datetime
from typing import Any, Dict, List, Optional
from sqlalchemy import or_, select, and_

from connection_manager import async_session_maker

from src.logger.models import EndpointLog, ServiceLog
from src.data_insertion_module.models import (
    Company, CompanyBranch, Activity,
    Capital, Classifier, License,
    FinancialStatement, FinancialStatementRow,
    Person, Manager, Shareholder, Contact,
    Address, Event, Sanction,
    CourtCase, ParticipantInCase,
)
from .constants.data_insertion_module.mapping import (
    COUNTRY_MAPPING,
    STATUS_INFORMATION_MAPPING, CURRENCY_MAPPING,
    FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING,
    FINANCIAL_STATEMENT_ROW_TYPE_MAPPING,
    CONTACT_TYPE_MAPPING,
    PARTICIPANT_TYPE_MAPPING,
)
from src.users.models import Token
from .constants.users.schemas import TokenScheme


class Query:
    @staticmethod
    async def get_current_token(token: TokenScheme) -> TokenScheme:
        async with async_session_maker() as session:
            query = select(Token).where(Token.value == token.value)  # noqa: F405
            response = await session.execute(query)
            result = response.one_or_none()
            assert result, f"Несуществующий токен - {token.value}."
            assert result[0].is_active, f"Не действующий токен - {token.value}"
            return token
    
    @staticmethod
    async def get_company_information(
        country_id: Optional[int]=None,
        registration_identifier: Optional[str]=None,
        company_id: Optional[int]=None
    ) -> Optional[Dict]:
        async with async_session_maker() as session:
            filter_block = []
            if company_id:
                filter_block.append(Company.id == company_id)
            elif registration_identifier and country_id:
                filter_block.extend([
                    Company.registration_identifier_value == registration_identifier,
                    Company.country_id == country_id,
                ])
            query = (
                select(Company)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.first()
            assert result, f"Не найдена информация о компании - {registration_identifier}"
            result_object = result[0] if result else None
            result_dict = {}
            if result_object:
                result_dict.update({
                    "id": result_object.id,
                    "country": list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(result_object.country_id)] if result_object.country_id in list(COUNTRY_MAPPING.values()) else None,
                    "registration_identifier_name": result_object.registration_identifier_name,
                    "registration_identifier_value": result_object.registration_identifier_value,
                    "tax_identifier_name": result_object.tax_identifier_name,
                    "tax_identifier_value": result_object.tax_identifier_value,
                    "status": result_object.status,
                    "short_name": result_object.short_name,
                    "full_name": result_object.full_name,
                    "short_name_en": result_object.short_name_en,
                    "full_name_en": result_object.full_name_en,
                    "founding_date": result_object.founding_date,
                    "termination_date": result_object.termination_date,
                    "important_information": result_object.important_information,
                    "is_financial_company":result_object.is_financial_company,
                    "with_group": result_object.with_group,
                    "with_court_case": result_object.with_court_case,
                    "source_info": result_object.source_info,
                    "foreigners_founders": result_object.foreigners_founders,
                    "actualized_at": result_object.actualized_at,
                    "updated_at": result_object.updated_at,
                })
            return result_dict
    
    @staticmethod
    async def get_person_information(
        citizenship_country_id: Optional[int]=None,
        person_id: Optional[int]=None,
        identifier_value: Optional[str]=None
    ) -> Optional[Any]:
        async with async_session_maker() as session:
            filter_block = []
            if person_id:
                filter_block.append(Person.id == person_id)
            elif identifier_value:
                if citizenship_country_id:
                    filter_block.extend([
                        Person.citizenship == citizenship_country_id,
                        Person.identifier_value == identifier_value,
                    ])
                else:
                    filter_block = and_(Person.identifier_value == identifier_value)
            query = (
                select(Person)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.first()
            result_object = result[0] if result else None
            result_dict = {}
            if result_object:
                result_dict.update({
                    "surname": result_object.surname,
                    "first_name": result_object.first_name,
                    "patronymic": result_object.patronymic,
                    "date_birth": result_object.date_birth,
                    "gender": result_object.gender,
                    "citizenship": list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(result_object.citizenship)] if result_object.citizenship in list(COUNTRY_MAPPING.values()) else None,
                    "identifier_name": result_object.identifier_name,
                    "identifier_value": result_object.identifier_value,
                    "identifier_sub_name": result_object.identifier_sub_name,
                    "identifier_sub_value": result_object.identifier_sub_value,
                    "important_information": result_object.important_information,
                    "source_info": result_object.source_info,
                    "actualized_at": result_object.actualized_at,
                    "updated_at": result_object.updated_at,
                })
            return result_dict
    
    @staticmethod
    async def get_financial_statement_information(
        company_id: int,
        date: Optional[datetime.date]=None,
    ) -> Optional[Any]:
        async with async_session_maker() as session:
            filter_block = [
                FinancialStatement.company_id == company_id,
                FinancialStatementRow.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],
            ]
            if date:
                filter_block.append(FinancialStatement.date == date)
            else:
                current_date = datetime.datetime.now(datetime.UTC).date()
                target_year = current_date.year if current_date.month >= 6 else current_date.year - 1
                current_period = datetime.datetime.strptime(f"31.12.{target_year}", "%d.%m.%Y").date()
                filter_block.append(FinancialStatement.date <= current_period)
            query = (
                select(FinancialStatement, FinancialStatementRow)
                .join(FinancialStatementRow, FinancialStatementRow.financial_statement_id == FinancialStatement.id)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            # print(f"{result=}")
            result_dict = {}
            for f_s, row in result:
                f_s_date = datetime.datetime.strftime(f_s.date, "%d.%m.%Y")
                if not result_dict.get(f_s_date):
                    result_dict[f_s_date] = {
                        "source_info": f_s.source_info,
                        "currency": list(CURRENCY_MAPPING)[list(CURRENCY_MAPPING.values()).index(f_s.currency_id)] if f_s.currency_id in list(CURRENCY_MAPPING.values()) else None,
                        "period_type": list(FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING)[list(FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING.values()).index(f_s.period_type_id)] if f_s.period_type_id in list(FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING.values()) else None,
                        "rows": [],
                    }
                result_dict[f_s_date]["rows"].append({
                    row.name: {
                        "type": list(FINANCIAL_STATEMENT_ROW_TYPE_MAPPING)[list(FINANCIAL_STATEMENT_ROW_TYPE_MAPPING.values()).index(row.type_id)] if row.type_id in list(FINANCIAL_STATEMENT_ROW_TYPE_MAPPING.values()) else None,
                        row.name: row.value,
                    }
                })                
            # print(f"{result_dict=}")
            return result_dict
    
    @staticmethod
    async def get_company_shareholder_information(
        company_shareholder_id: Optional[int]=None,
        company_share_id: Optional[int]=None,
    ) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            filter_block = []
            if company_shareholder_id:
                filter_block.append(Shareholder.company_shareholder_id == company_shareholder_id)
            if company_share_id:
                filter_block.append(Shareholder.company_share_id == company_share_id)
            query = (
                select(Company, Shareholder)
                .join(Shareholder, Shareholder.company_shareholder_id == Company.id)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, (company, shareholder) in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                result_dict[str(idx)]["country"] = list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(company.country_id)] if company.country_id in list(COUNTRY_MAPPING.values()) else None
                result_dict[str(idx)]["registration_identifier_name"] = company.registration_identifier_name
                result_dict[str(idx)]["registration_identifier_value"] = company.registration_identifier_value
                result_dict[str(idx)]["tax_identifier_name"] = company.tax_identifier_name
                result_dict[str(idx)]["tax_identifier_value"] = company.tax_identifier_value
                result_dict[str(idx)]["status"] = company.status
                result_dict[str(idx)]["short_name"] = company.short_name
                result_dict[str(idx)]["full_name"] = company.full_name
                result_dict[str(idx)]["short_name_en"] = company.short_name_en
                result_dict[str(idx)]["full_name_en"] = company.full_name_en
                result_dict[str(idx)]["founding_date"] = company.founding_date
                result_dict[str(idx)]["termination_date"] = company.termination_date
                result_dict[str(idx)]["important_information"] = company.important_information
                result_dict[str(idx)]["source_info"] = company.source_info
                
                result_dict[str(idx)]["currency"] = list(CURRENCY_MAPPING)[list(CURRENCY_MAPPING.values()).index(shareholder.currency_id)] if shareholder.currency_id in list(CURRENCY_MAPPING.values()) else None
                result_dict[str(idx)]["share_percent"] = shareholder.share_percent
                result_dict[str(idx)]["share_value"] = shareholder.share_value
                result_dict[str(idx)]["purchase_date"] = shareholder.purchase_date
                result_dict[str(idx)]["actualized_at"] = shareholder.actualized_at
                result_dict[str(idx)]["updated_at"] = shareholder.updated_at
            # print(f"{result_dict=}")
            return result_dict
    
    @staticmethod
    async def get_person_shareholder_information(
        person_shareholder_id: Optional[int]=None,
        company_share_id: Optional[int]=None,
    ) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            filter_block = []
            if person_shareholder_id:
                filter_block.append(Shareholder.person_shareholder_id == person_shareholder_id)
            if company_share_id:
                filter_block.append(Shareholder.company_share_id == company_share_id)
            query = (
                select(Person, Shareholder)
                .join(Shareholder, Shareholder.person_shareholder_id == Person.id)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, (person, shareholder) in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                result_dict[str(idx)]["surname"] = person.surname
                result_dict[str(idx)]["first_name"] = person.first_name
                result_dict[str(idx)]["patronymic"] = person.patronymic
                result_dict[str(idx)]["date_birth"] = person.date_birth
                result_dict[str(idx)]["gender"] = person.gender
                result_dict[str(idx)]["citizenship"] = list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(person.citizenship)] if person.citizenship in list(COUNTRY_MAPPING.values()) else None
                result_dict[str(idx)]["identifier_name"] = person.identifier_name
                result_dict[str(idx)]["identifier_value"] = person.identifier_value
                result_dict[str(idx)]["identifier_sub_name"] = person.identifier_sub_name
                result_dict[str(idx)]["identifier_sub_value"] = person.identifier_sub_value
                result_dict[str(idx)]["important_information"] = person.important_information
                result_dict[str(idx)]["source_info"] = person.source_info
                
                result_dict[str(idx)]["currency"] = list(CURRENCY_MAPPING)[list(CURRENCY_MAPPING.values()).index(shareholder.currency_id)] if shareholder.currency_id in list(CURRENCY_MAPPING.values()) else None
                result_dict[str(idx)]["share_percent"] = shareholder.share_percent
                result_dict[str(idx)]["share_value"] = shareholder.share_value
                result_dict[str(idx)]["purchase_date"] = shareholder.purchase_date
                result_dict[str(idx)]["actualized_at"] = shareholder.actualized_at
                result_dict[str(idx)]["updated_at"] = shareholder.updated_at
                
            return result_dict
            
    @staticmethod
    async def get_company_branch_information(company_id: int) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            query = (
                select(CompanyBranch)
                .filter(
                    and_(
                        CompanyBranch.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],
                        CompanyBranch.company_id == company_id,
                    )
                )
            )
            response = await session.execute(query)
            result = response.all()
            return result
    
    @staticmethod
    async def get_company_activity_information(company_id: int) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            query = (
                select(Activity)
                .filter(
                    and_(
                        Activity.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],
                        Activity.company_id == company_id,
                    )
                )
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, activity_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                activity = activity_object[0]
                result_dict[str(idx)]["is_main"] = activity.is_main
                result_dict[str(idx)]["code"] = activity.code
                result_dict[str(idx)]["description"] = activity.description
                result_dict[str(idx)]["date"] = activity.date
                result_dict[str(idx)]["actualized_at"] = activity.actualized_at
                result_dict[str(idx)]["updated_at"] = activity.updated_at
                
            return result_dict
    
    @staticmethod
    async def get_company_capital_information(company_id: int) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            query = (
                select(Capital)
                .filter(
                    and_(
                        Capital.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],
                        Capital.company_id == company_id,
                    )
                )
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, capital_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                capital = capital_object[0]
                result_dict[str(idx)]["value"] = capital.value
                result_dict[str(idx)]["currency"] = list(CURRENCY_MAPPING)[list(CURRENCY_MAPPING.values()).index(capital.currency_id)] if capital.currency_id in list(CURRENCY_MAPPING.values()) else None
                result_dict[str(idx)]["type"] = capital.type
                result_dict[str(idx)]["date"] = capital.date
                result_dict[str(idx)]["actualized_at"] = capital.actualized_at
                result_dict[str(idx)]["updated_at"] = capital.updated_at
                
            return result_dict
    
    @staticmethod
    async def get_company_classifier_information(company_id: int) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            query = (
                select(Classifier)
                .filter(
                    and_(
                        Classifier.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],
                        Classifier.company_id == company_id,
                    )
                )
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, classifier_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                classifier = classifier_object[0]
                result_dict[str(idx)]["name"] = classifier.name
                result_dict[str(idx)]["value"] = classifier.value
                result_dict[str(idx)]["description"] = classifier.description
                result_dict[str(idx)]["actualized_at"] = classifier.actualized_at
                result_dict[str(idx)]["updated_at"] = classifier.updated_at
                
            return result_dict
    
    @staticmethod
    async def get_company_license_information(company_id: int) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            query = (
                select(License)
                .filter(
                    and_(
                        License.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],
                        License.company_id == company_id,
                    )
                )
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, license_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                license = license_object[0]
                result_dict[str(idx)]["license_identifier"] = license.license_identifier
                result_dict[str(idx)]["license_body"] = license.license_body
                result_dict[str(idx)]["licensee"] = license.licensee
                result_dict[str(idx)]["valid_from"] = license.valid_from
                result_dict[str(idx)]["valid_to"] = license.valid_to
                result_dict[str(idx)]["actualized_at"] = license.actualized_at
                result_dict[str(idx)]["updated_at"] = license.updated_at
            return result_dict
    
    @staticmethod
    async def get_company_manager_information(
        company_id: Optional[int]=None,
        person_id: Optional[int]=None
    ) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            filter_block = [Manager.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],]
            if company_id:
                filter_block.append(
                    Manager.company_id == company_id,
                )
            elif person_id:
                filter_block.append(
                    Manager.person_id == person_id,
                )
            query = (
                select(Person, Manager)
                .join(Manager, Manager.person_id == Person.id)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, (person, manager) in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                result_dict[str(idx)]["surname"] = person.surname
                result_dict[str(idx)]["first_name"] = person.first_name
                result_dict[str(idx)]["patronymic"] = person.patronymic
                result_dict[str(idx)]["date_birth"] = person.date_birth
                result_dict[str(idx)]["gender"] = person.gender
                result_dict[str(idx)]["citizenship"] = list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(person.citizenship)] if person.citizenship in list(COUNTRY_MAPPING.values()) else None
                result_dict[str(idx)]["identifier_name"] = person.identifier_name
                result_dict[str(idx)]["identifier_value"] = person.identifier_value
                result_dict[str(idx)]["identifier_sub_name"] = person.identifier_sub_name
                result_dict[str(idx)]["identifier_sub_value"] = person.identifier_sub_value
                result_dict[str(idx)]["important_information"] = person.important_information
                result_dict[str(idx)]["source_info"] = person.source_info
                
                result_dict[str(idx)]["job_title"] = manager.job_title
                result_dict[str(idx)]["supervisor"] = manager.supervisor
                result_dict[str(idx)]["appointment_date"] = manager.appointment_date
                result_dict[str(idx)]["important_information"] = manager.important_information
            # print(f"{result_dict=}")
            return result_dict
    
    @staticmethod
    async def get_contact_information(
        company_id: Optional[int]=None,
        person_id: Optional[int]=None
    ) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            filter_block = [Contact.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],]
            if company_id:
                filter_block.append(
                    Contact.company_id == company_id,
                )
            
            elif person_id:
                filter_block.append(
                    Contact.company_id == person_id,
                )
            query = (
                select(Contact)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, contact_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                contact = contact_object[0]
                result_dict[str(idx)]["contact_type"] = list(CONTACT_TYPE_MAPPING)[list(CONTACT_TYPE_MAPPING.values()).index(contact.contact_type_id)] if contact.contact_type_id in list(CONTACT_TYPE_MAPPING.values()) else None
                result_dict[str(idx)]["value"] = contact.value
                result_dict[str(idx)]["actualized_at"] = contact.actualized_at
                result_dict[str(idx)]["updated_at"] = contact.updated_at
            return result_dict
    
    @staticmethod
    async def get_address_information(
        company_id: Optional[int]=None,
        person_id: Optional[int]=None
    ) -> List[Optional[Any]]:
        async with async_session_maker() as session:
            filter_block = [Address.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],]
            if company_id:
                filter_block.append(
                    Address.company_id == company_id,
                )
            
            elif person_id:
                filter_block.append(
                    Address.person_id == person_id,
                )
            query = (
                select(Address)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, address_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                address = address_object[0]
                result_dict[str(idx)]["country"] = list(CONTACT_TYPE_MAPPING)[list(CONTACT_TYPE_MAPPING.values()).index(address.country_id)] if address.country_id in list(CONTACT_TYPE_MAPPING.values()) else None
                result_dict[str(idx)]["address_type"] = address.address_type
                result_dict[str(idx)]["region_code"] = address.region_code
                result_dict[str(idx)]["zip"] = address.zip
                result_dict[str(idx)]["full_address"] = address.full_address
                result_dict[str(idx)]["region"] = address.region
                result_dict[str(idx)]["area"] = address.area
                result_dict[str(idx)]["locality"] = address.locality
                result_dict[str(idx)]["street"] = address.street
                result_dict[str(idx)]["house"] = address.house
                result_dict[str(idx)]["frame"] = address.frame
                result_dict[str(idx)]["room"] = address.room
                result_dict[str(idx)]["date_from"] = address.date_from
                result_dict[str(idx)]["actualized_at"] = address.actualized_at
                result_dict[str(idx)]["updated_at"] = address.updated_at
            return result_dict
    
    @staticmethod
    async def get_event_information(
        company_id: Optional[int]=None,
        person_id: Optional[int]=None,
    ) -> Dict[str, Any]:
        async with async_session_maker() as session:
            filter_block = [Event.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],]
            if company_id:
                filter_block.append(
                    Event.company_id == company_id,
                )
            elif person_id:
                filter_block.append(
                    Event.company_id == person_id,
                )
            query = (
                select(Event)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, event_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                event = event_object[0]
                result_dict[str(idx)]["date"] = event.date
                result_dict[str(idx)]["description"] = event.description
                result_dict[str(idx)]["source_info"] = event.source_info
            return result_dict
    
    @staticmethod
    async def get_sanction_information(
        company_id: Optional[int]=None,
        person_id: Optional[int]=None
    ) -> Dict[str, Any]:
        async with async_session_maker() as session:
            filter_block = [Sanction.status_info_id == STATUS_INFORMATION_MAPPING["Actual"],]
            if company_id:
                filter_block.append(
                    Sanction.company_id == company_id,
                )
            elif person_id:
                filter_block.append(
                    Sanction.company_id == person_id,
                )
            query = (
                select(Sanction)
                .filter(and_(*filter_block))
            )
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, sanction_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                sanction = sanction_object[0]
                result_dict[str(idx)]["country"] = list(COUNTRY_MAPPING)[list(COUNTRY_MAPPING.values()).index(sanction.country_id)] if sanction.country_id in list(COUNTRY_MAPPING.values()) else None
                result_dict[str(idx)]["description"] = sanction.description
                result_dict[str(idx)]["actualized_at"] = sanction.actualized_at
                result_dict[str(idx)]["updated_at"] = sanction.updated_at
            return result_dict
    
    @staticmethod
    async def get_company_court_case_information(company_id: int) -> Dict[str, Any]:
        async with async_session_maker() as session:
            query = (
                select(CourtCase, ParticipantInCase.participant_type)
                .distinct(CourtCase.id)
                .select_from(CourtCase)
                .outerjoin(ParticipantInCase, ParticipantInCase.court_case == CourtCase.id)
                .where(
                    and_(
                        ParticipantInCase.is_legal_entity == True,  # noqa: E712
                        ParticipantInCase.subject_id == company_id,
                    )
                )
            )
            
            response = await session.execute(query)
            result = response.all()
            result_dict = {}
            for idx, court_case_object in enumerate(result):
                if not result_dict.get(str(idx)):
                    result_dict[str(idx)] = {}
                court_case_object_ = court_case_object[0]
                result_dict[str(idx)]["number"] = court_case_object_.number
                result_dict[str(idx)]["court"] = court_case_object_.court
                result_dict[str(idx)]["amount"] = court_case_object_.amount
                result_dict[str(idx)]["currency_id"] = court_case_object_.currency_id
                result_dict[str(idx)]["date"] = court_case_object_.date
                result_dict[str(idx)]["source_info"] = court_case_object_.source_info
                result_dict[str(idx)]["actualized_at"] = court_case_object_.actualized_at
                result_dict[str(idx)]["updated_at"] = court_case_object_.updated_at
                result_dict[str(idx)]["created_at"] = court_case_object_.created_at
                
                result_dict[str(idx)]["participant_type"] = {v:k for k, v in PARTICIPANT_TYPE_MAPPING.items()}[court_case_object[1]]
            
            return result_dict
    
    @staticmethod
    async def get_service_log(uuid: Optional[str], limit: int=100) -> List[Optional[ServiceLog]]:
        async with async_session_maker() as session:
            filter_block = []
            if uuid:
                filter_block.append(ServiceLog.uuid == uuid)
            
            query = (
                select(ServiceLog)
                .filter(
                    and_(*filter_block)
                )
                .limit(limit)
                .order_by(ServiceLog.id.desc())
            )
            
            response = await session.execute(query)
            result = [item[0] for item in response.all()]
            return result
    
    @staticmethod
    async def get_endpoint_log(uuid: Optional[str], limit: int=100) -> List[Optional[EndpointLog]]:
        async with async_session_maker() as session:
            filter_block = []
            if uuid is not None:
                filter_block.append(EndpointLog.uuid == uuid)
            
            query = (
                select(EndpointLog)
                .filter(
                    and_(*filter_block)
                )
                .limit(limit)
                .order_by(EndpointLog.id.desc())
            )
            
            response = await session.execute(query)
            result = [item[0] for item in response.all()]
            return result
    
    @staticmethod
    async def get_request_execution_time(
        uuid: Optional[str] = None
    ) -> Dict[str, datetime.timedelta]:
        async with async_session_maker() as session:
            target_messages = [
                'Успешная обработка запроса.',
                'Данные по запросу преобразованы.',
                'Файл сжат и отправлен в хранилище.'
            ]
            
            if uuid is None:
                last_request_uuid_query = (
                    select(ServiceLog.uuid)
                    .order_by(ServiceLog.id.desc())
                    .filter(or_(ServiceLog.service_id == 1, ServiceLog.service_id == 2))
                    .filter(ServiceLog.log_type_id == 1)
                    .filter(
                        or_(
                            ServiceLog.message.ilike('Получен запрос:%'),
                            ServiceLog.message.in_(target_messages)
                        )
                    )
                    .limit(1)
                )
                last_request_uuid_response = await session.execute(last_request_uuid_query)
                uuid: str = last_request_uuid_response.fetchone()[0]
            
            
            
            query = (
                select(ServiceLog)
                .filter(ServiceLog.uuid == uuid)
                .filter(or_(ServiceLog.service_id == 1, ServiceLog.service_id == 2))
                .filter(ServiceLog.log_type_id == 1)
                .filter(
                    or_(
                        ServiceLog.message.ilike('Получен запрос:%'),
                        ServiceLog.message.in_(target_messages)
                    )
                )
                .order_by(ServiceLog.id.asc())
            )
            
            response = await session.execute(query)
            logs = response.scalars().all()
            
            # Проверяем наличие всех необходимых записей
            time_intervals = {}
            if len(logs) >= 4:
                # Вычисляем временные интервалы
                time_intervals.update(
                    {
                        '(1-2) Подготовка данных': logs[1].created_at - logs[0].created_at,
                        '(2-3) Ожидание старта подготовки отчета': logs[2].created_at - logs[1].created_at,
                        '(3-4) Подготовка отчета': logs[3].created_at - logs[2].created_at,
                    }
                )
                time_intervals.update(
                    {
                        'Общее время': sum(time_intervals.values(), datetime.timedelta()),
                    }
                )
            else:
                time_intervals.update(
                    {
                        "warning": "Не выполнен полный цикл запроса отчета (размещение и подготовка)!"
                    }
                )
                print("Предупреждение: Недостаточно записей для расчета всех интервалов")
            
            identifier = None
            if "identifier: " in logs[0].message:
                identifier = logs[0].message.split("identifier: ")[-1].strip().replace(".", "")
            if identifier is not None:
                time_intervals.update(
                    {"Идентификатор компании": identifier,}
                )
            
            return time_intervals


class Statement:
    pass
