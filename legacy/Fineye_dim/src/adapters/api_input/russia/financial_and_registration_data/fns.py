import os
import sys
import asyncio
import datetime
from typing import Any, Dict, List
import aiohttp

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../../')))
from service_logger.app import Log
from src.schemas import (  # noqa: E402
    DataForInsertionModuleScheme, CompanyScheme, CapitalScheme,
    ClassifierScheme, ActivityScheme, EventScheme, LicenseScheme, AddressScheme,
    ContactScheme, ManagerScheme, PersonScheme, ShareholderScheme,
    CompanyBranchScheme, FinancialStatementScheme, FinancialStatementRowScheme,
    
)
from src.adapters.base_adapters import BaseAPIFinancialAndRegistrationDataAdapter
from src.utils.constants.mapping import (
    CURRENCY_MAPPING, FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING, FINANCIAL_STATEMENT_ROW_TYPE_MAPPING,
    STATUS_INFORMATION_MAPPING, COUNTRY_MAPPING,
    CONTACT_TYPE_MAPPING, 
)

class FNSAdapterFinancialAndRegistrationData(BaseAPIFinancialAndRegistrationDataAdapter):
    def __init__(self, token: str, identifier: str, request_uuid: str):
        super().__init__(
            token=token,
            identifier=identifier,
            request_uuid=request_uuid,
        )
    
    @BaseAPIFinancialAndRegistrationDataAdapter.cache_responses(source="fns")
    async def request(self) -> List[Dict[str, Any]]:
        async with aiohttp.ClientSession() as session:
            params = {
                'req': self.identifier,
                'key': self.token,
            }
            egr_url = 'https://api-fns.ru/api/egr'
            bo_url = 'https://api-fns.ru/api/bo'
            
            tasks: List[asyncio.Task] = [
                asyncio.create_task(session.get(url=egr_url, params=params, ssl=False)),
                asyncio.create_task(session.get(url=bo_url, params=params, ssl=False)),
            ]
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message=f"Попытка получить ответ от API (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
            )
            responses = await asyncio.gather(*tasks)
            
            results = []
            for response in responses:
                if response.status in range(200, 300):
                    data = await response.json()
                    # import json
                    # with open(f"{self.identifier}_{"EGR" if len(results) == 0 else "BO"}.json", "w", encoding="utf-8") as file:
                    #     json.dump(data, file, ensure_ascii=False)
                    results.append(data)
                else:
                    await Log.add_log(
                        log_type="error",
                        request_uuid=self.request_uuid,
                        message=f"Не удалось получить ответ от API (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
                    )
                    raise ValueError(f"Не удалось получить ответ от API ФНС России.  (статус: {response})")
            await Log.add_log(
                log_type="info",
                request_uuid=self.request_uuid,
                message=f"Получен ответ от API (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
            )
            return results
        
    async def adapt_data(self) -> DataForInsertionModuleScheme:
        egr, bo = await self.request()
        
        SOURCE_INFO = "ФНС России"
        COUNTRY_RUSSIA: int = COUNTRY_MAPPING["Russia"]
        CURRENCY_RUB: int = CURRENCY_MAPPING["RUB"]
        STATUS_INFO_ACTUAL: int = STATUS_INFORMATION_MAPPING["Actual"]
        FINANCIAL_STATEMENT_ANNUAL_PERIOD: int = FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING["Annual"]
        
        # EGR
        try:
            egr_data = egr["items"][0]["ЮЛ"]
            
            registration_identifier_name = "ОГРН"
            registration_identifier_value = egr_data.get('ОГРН')
            tax_identifier_name = "ИНН"
            tax_identifier_value = egr_data.get('ИНН')
            assert egr_data, "Отсутствует информация о ЮР лице"
            assert registration_identifier_value or tax_identifier_value, "Нет идентификатора компании"
        except Exception as e:
            await Log.add_log(
                log_type="error",
                request_uuid=self.request_uuid,
                message=f"Не удалось получить ответ (API ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
            )
            raise ValueError(f"Ошибка при получении регистрационных данных компании\n{e}")
        
        
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message=f"Старт разбора регистрационной информации (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
        )
        status = egr_data.get("Статус")
        short_name = egr_data.get("НаимСокрЮЛ")
        full_name = egr_data.get("НаимПолнЮЛ")
        founding_date = (
            datetime.datetime.strptime(egr_data["ДатаРег"], "%Y-%m-%d")
            if egr_data.get("ДатаРег") else None
        )
        termination_date = (
            datetime.datetime.strptime(egr_data["ДатаПрекр"], "%Y-%m-%d")
            if egr_data.get("ДатаПрекр") else None
        )
        company_important_information = egr_data.get("СпПрекрЮЛ")
        
        foreigners_founders = []
        # company_row=['0', 85.0, 8500.0, 'АО УК "КОНОМИКА"', '1247700658083']
        founders_data = egr_data.get("Учредители")
        if founders_data:
            for founder_data in founders_data:
                if founder_data.get("УчрИН"):
                    foreigner_founder_data = founder_data["УчрИН"]
                    key = "ff"
                    foreigner_founder_share_percent = round(float(founder_data["Процент"]), 2) if founder_data.get("Процент") else None
                    foreigner_founder_share_value = round(float(founder_data["СуммаУК"]), 2) if founder_data.get("СуммаУК") else None
                    foreigner_founder_short_name = foreigner_founder_data["НаимСокрЮЛ"].strip() if foreigner_founder_data.get("НаимСокрЮЛ") else foreigner_founder_data.get("ФИОПолн")
                    foreigner_founder_full_name = foreigner_founder_data["НаимПолнЮЛ"].strip() if foreigner_founder_data.get("НаимПолнЮЛ") else foreigner_founder_data.get("ФИОПолн")
                    identifier = foreigner_founder_data.get("НомерРег", foreigner_founder_data.get("ИННФЛ"))
                    
                    foreigners_founders.append(
                        [
                            key,
                            foreigner_founder_share_percent,
                            foreigner_founder_share_value,
                            foreigner_founder_short_name if foreigner_founder_short_name else foreigner_founder_full_name,
                            identifier,
                        ]
                    )
        
        
        self.data["companies"]["company_1"] = CompanyScheme(
            source_info=SOURCE_INFO,
            important_information=company_important_information,
            country_id=COUNTRY_RUSSIA,
            registration_identifier_name=registration_identifier_name,
            registration_identifier_value=registration_identifier_value,
            tax_identifier_name=tax_identifier_name,
            tax_identifier_value=tax_identifier_value,
            status=status,
            short_name=short_name,
            full_name=full_name,
            short_name_en=None,
            full_name_en=None,
            founding_date=founding_date,
            termination_date=termination_date,
            is_financial_company=None,
            foreigners_founders=foreigners_founders if foreigners_founders else None,
        )
        # print(f"{self.data["companies"]["company_1"]=}")
        
        # Capital
        capital_data = egr_data.get("Капитал")
        if capital_data:
            capital_value = round(float(capital_data["СумКап"]), 2) if capital_data.get("СумКап") else None
            capital_currency_id = CURRENCY_RUB
            capital_type = capital_data.get("ВидКап")
            capital_date = (
                datetime.datetime.strptime(capital_data["Дата"], '%Y-%m-%d').date()
                if capital_data.get("Дата") else None
            )
            capital_status_info_id = STATUS_INFO_ACTUAL
            self.data["companies_capitals"]["company_1"] = []
            company_capital = CapitalScheme(
                value=capital_value,
                currency_id=capital_currency_id,
                type=capital_type,
                date=capital_date,
                status_info_id=capital_status_info_id,
            )
            self.data["companies_capitals"]["company_1"].append(company_capital)
        
        # Company_classifier
        CPP = egr_data.get('КПП')
        codeOKOPF = egr_data.get('КодОКОПФ')
        OKOPF = egr_data.get('ОКОПФ')
        if CPP or (codeOKOPF and OKOPF):
            self.data["companies_classifiers"]["company_1"] = []
            if CPP:
                CPP_classifier = ClassifierScheme(
                    name="КПП",
                    value=CPP,
                    description="Идентификатор, присваеваемый компании налоговым органом",
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_classifiers"]["company_1"].append(CPP_classifier)
            if codeOKOPF or OKOPF:
                OKOPF_classifier = ClassifierScheme(
                    name="ОКОПФ",
                    value=codeOKOPF if codeOKOPF else OKOPF,
                    description="Общероссийский классификатор организационно-правовых форм",
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_classifiers"]["company_1"].append(OKOPF_classifier)
        
        company_classifier_data = egr_data.get("КодыСтат")
        if company_classifier_data:
            if not self.data["companies_classifiers"].get("company_1"):
                self.data["companies_classifiers"]["company_1"] = []
            OKPO = egr_data["КодыСтат"].get('ОКПО')
            if OKPO:
                OKPO_classifier = ClassifierScheme(
                    name="ОКПО",
                    value=OKPO,
                    description="Общероссийский классификатор предприятий и организаций",
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_classifiers"]["company_1"].append(OKPO_classifier)
            OKTMO = egr_data["КодыСтат"].get('ОКТМО')
            if OKTMO:
                OKTMO_classifier = ClassifierScheme(
                    name="ОКТМО",
                    value=OKTMO,
                    description="Общероссийский классификатор территорий муниципальных образований",
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_classifiers"]["company_1"].append(OKTMO_classifier)
            OKFS = egr_data["КодыСтат"].get('ОКФС')
            if OKFS:
                OKFS_classifier = ClassifierScheme(
                    name="ОКФС",
                    value=OKFS,
                    description="Общероссийский классификатор форм собственности",
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_classifiers"]["company_1"].append(OKFS_classifier)
            OKOGU = egr_data["КодыСтат"].get('ОКОГУ')
            if OKOGU:
                OKOGU_classifier = ClassifierScheme(
                    name="ОКОГУ",
                    value=OKOGU,
                    description="Общероссийский классификатор органов государственной власти и управления",
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_classifiers"]["company_1"].append(OKOGU_classifier)
        
        # Company_activity
        is_financial_company: bool = False
        main_activity_data = egr_data.get("ОснВидДеят")
        if main_activity_data:
            self.data["companies_activities"]["company_1"] = []
            is_main_main_activity = True
            code_main_activity = main_activity_data.get("Код")
            if code_main_activity.startswith(("64.92", "64.99", "65.1", "65.2", "65.3", )) or code_main_activity in (
                    "64.11", "64.19",
                ):
                is_financial_company = True
            description_main_activity = main_activity_data.get("Текст")
            date_main_activity = (
                datetime.datetime.strptime(main_activity_data["Дата"], "%Y-%m-%d").date()
                if main_activity_data.get("Дата") else None
            )
            main_activity = ActivityScheme(
                is_main=is_main_main_activity,
                code=code_main_activity,
                description=description_main_activity,
                date=date_main_activity,
                status_info_id=STATUS_INFO_ACTUAL,
            )
            self.data["companies_activities"]["company_1"].append(main_activity)
        
        sub_activities_data = egr_data.get("ДопВидДеят")
        if sub_activities_data:
            if not self.data["companies_activities"].get("company_1"):
                self.data["companies_activities"]["company_1"] = []
            for sub_activity in sub_activities_data:
                is_main_sub_activity = False
                code_sub_activity = sub_activity.get("Код")
                # if code_sub_activity.startswith(("64.92", "64.99", "65.1", "65.2", "65.3", )) or code_sub_activity in (
                #     "64.11", "64.19",
                # ):
                #     is_financial_company = True
                description_sub_activity = sub_activity.get("Текст")
                date_sub_activity = (
                    datetime.datetime.strptime(sub_activity["Дата"], "%Y-%m-%d").date() \
                    if sub_activity.get("Дата") else None
                )
                sub_activity = ActivityScheme(
                    is_main=is_main_sub_activity,
                    code=code_sub_activity,
                    description=description_sub_activity,
                    date=date_sub_activity,
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_activities"]["company_1"].append(sub_activity)
        self.data["companies"]["company_1"].is_financial_company = is_financial_company
        
        # License
        licenses_data = egr_data.get("Лицензии")
        if licenses_data:
            self.data["companies_licenses"]["company_1"] = []
            for license in licenses_data:
                license_identifier = license.get("НомерЛиц")
                license_body = license.get("ВидДеятельности")
                licensee = license.get("ЛицОрг")
                license_valid_from = (
                    datetime.datetime.strptime(license["ДатаНачала"], "%Y-%m-%d").date() 
                    if license.get("ДатаНачала") else None
                )
                license_valid_to = (
                    datetime.datetime.strptime(license["ДатаОконч"], "%Y-%m-%d").date()
                    if license.get("ДатаОконч") else None
                )
                company_license = LicenseScheme(
                    license_identifier=license_identifier,
                    license_body=license_body,
                    licensee=licensee,
                    valid_from=license_valid_from,
                    valid_to=license_valid_to,
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["companies_licenses"]["company_1"].append(company_license)
        
        # Address (Company)
        company_address_data = egr_data.get("Адрес")
        if company_address_data:
            self.data["companies_addresses"]["company_1"] = []
            region_code = company_address_data.get('КодРегион')
            address_zip = company_address_data.get('Индекс')
            
            full_address = company_address_data["АдресПолн"]
            address_date_from = company_address_data.get("Дата")
            
            company_address_detail = company_address_data.get('АдресДетали')
            region = None
            area = None
            locality = None
            street = None
            house = None
            frame = None
            room = None
            if company_address_detail:
                company_address_detail_region = company_address_detail.get('Регион')
                if company_address_detail_region:
                    region_name = (
                        company_address_detail_region['Наим'].title()
                        if company_address_detail_region.get('Наим') else None
                    )
                    region_type = (
                        company_address_detail_region['Тип'].lower()
                        if company_address_detail_region.get('Тип', None) else None
                    )
                    if region_name:
                        region = (
                            f"{region_type[0] if region_type[:3].lower() != 'обл' else 'обл'}. {region_name}"
                            if region_type
                            else f"{region_name.split()[0].lower()} {region_name.split()[-1]}"
                            if region_name and region_name.lower().startswith("край ")
                            else region_name
                        )
                    else:
                        region = None
                company_address_detail_district = company_address_detail.get('Район')
                if company_address_detail_district:
                    area_name = (
                        company_address_detail_district['Наим'].title()
                        if company_address_detail_district.get('Наим') else None
                    )
                    
                    area_type = (
                        company_address_detail_district['Тип'].lower()
                        if company_address_detail_district.get('Тип') else None
                    )
                    if area_name:
                        area = (
                            f"{area_type[0].lower()}-{area_type[-1].lower() if area_type != 'городской округ' else 'г.о.'} {area_name}"
                            if area_type else area_name
                        )
                    else:
                        area = None
                
                company_address_detail_locality = company_address_detail.get('НаселПункт')
                if company_address_detail_locality:
                    locality_name = (
                        company_address_detail_locality['Наим'].title()
                        if company_address_detail_locality.get('Наим') else None
                    )
                    
                    locality_type = (
                        company_address_detail_locality['Тип'].lower()
                        if company_address_detail_locality.get('Тип') else None
                    )
                    
                    if locality_name:
                        locality = (
                            f"{locality_type[0] if locality_type != 'рабочий поселок' else 'р.п'}. {locality_name}"
                            if locality_type else locality_name
                        )
                    else:
                        locality = None
                
                company_address_detail_street = company_address_detail.get('Улица')
                if company_address_detail_street:
                    street_name = (
                        company_address_detail_street['Наим'].title()
                        if company_address_detail_street.get('Наим') else None
                    )
                    street_type = (
                        company_address_detail_street['Тип'].lower()
                        if company_address_detail_street.get('Тип') else None
                    )
                    if street_name:
                        if street_type:
                            street_type_short = (
                                street_type[:2].lower()
                                if street_type[:2].lower() != "шо" else "ш"
                                if street_type[:2].lower() == "ШО" else street_type
                            )
                        else:
                            street_type_short = None
                        street = f"{street_type_short if street_type_short != 'пе' else 'пер'}. {street_name}" if street_type else street_name
                    else:
                        street = None
                house = company_address_detail['Дом'].split()[-1].lower() if company_address_detail.get('Дом') else None
                frame = company_address_detail['Корпус'].split()[-1].lower() if company_address_detail.get('Корпус') else None
                room = company_address_detail['Помещ'].lower().replace('i', 'I') if company_address_detail.get('Помещ') else None
        
        company_address = AddressScheme(
            country_id=COUNTRY_RUSSIA,
            address_type="Legal address",
            region_code=region_code,
            zip=address_zip,
            full_address=full_address,
            region=region,
            area=area,
            locality=locality,
            street=street,
            house=house,
            frame=frame,
            room=room,
            date_from=address_date_from,
            status_info_id=STATUS_INFO_ACTUAL,
        )
        self.data["companies_addresses"]["company_1"].append(company_address)
        
        # Contact (Company)
        contacts_data = egr_data.get("Контакты")
        if contacts_data:
            self.data["companies_contacts"]["company_1"] = []
            phones_data = contacts_data.get('Телефон')
            if phones_data:
                for phone in phones_data:
                    phone = ContactScheme(
                        contact_type_id=CONTACT_TYPE_MAPPING["Phone"],
                        value=phone.strip(),
                        status_info_id=STATUS_INFO_ACTUAL,
                    )
                    self.data["companies_contacts"]["company_1"].append(phone)
            emails_data = contacts_data.get('e-mail')
            if emails_data:
                for email in emails_data:
                    email = ContactScheme(
                        contact_type_id=CONTACT_TYPE_MAPPING["Email"],
                        value=email.strip(),
                        status_info_id=STATUS_INFO_ACTUAL,
                    )
                    self.data["companies_contacts"]["company_1"].append(email)
            saites_data = contacts_data.get('Сайт')
            if saites_data:
                for site in saites_data:
                    site = ContactScheme(
                        contact_type_id=CONTACT_TYPE_MAPPING["Site"],
                        value=site.strip(),
                        status_info_id=STATUS_INFO_ACTUAL,
                    )
                    self.data["companies_contacts"]["company_1"].append(site)
        
        # Managers
        supervisor_data = egr_data.get("Руководитель")
        if supervisor_data:
            supervisor_full_name = supervisor_data.get("ФИОПолн")
            
            if supervisor_full_name:
                supervisor_surname = supervisor_full_name.strip().split()[0].strip()  # Фамилия
                supervisor_patronymic = supervisor_full_name.strip().split()[-1].strip() if len(
                    supervisor_full_name.strip().split()) > 2 else None  # Отчество
                supervisor_first_name = (
                    " ".join(supervisor_full_name.strip().split()[1:-1]).strip()
                    if supervisor_patronymic
                    else supervisor_full_name.strip().split()[-1]
                )
            supervisor_date_birth = None
            supervisor_gender = supervisor_data.get("Пол")
            supervisor_citizenship = (
                COUNTRY_RUSSIA
                if supervisor_data.get("ВидГражд") and "Гражданин РФ" in supervisor_data["ВидГражд"]
                else None
            )
            supervisor_identifier_name = "ИННФЛ"
            supervisor_identifier_value = supervisor_data.get("ИННФЛ")
            supervisor_identifier_sub_name = None
            supervisor_identifier_sub_value = None
            supervisor_important_information = supervisor_data.get('ОКСМ')
            
            if supervisor_identifier_value:
                self.data["persons"]["person_1"] = PersonScheme(
                    source_info=SOURCE_INFO,
                    important_information=supervisor_important_information,
                    surname=supervisor_surname,
                    first_name=supervisor_first_name,
                    patronymic=supervisor_patronymic,
                    date_birth=supervisor_date_birth,
                    gender=supervisor_gender,
                    citizenship=supervisor_citizenship,
                    identifier_name=supervisor_identifier_name,
                    identifier_value=supervisor_identifier_value,
                    identifier_sub_name=supervisor_identifier_sub_name,
                    identifier_sub_value=supervisor_identifier_sub_value,
                )
            
            supervisor_person_id = "person_1"
            supervisor_company_id = "company_1"
            supervisor_job_title = supervisor_data["Должн"].strip() if supervisor_data.get("Должн") else None
            supervisor_appointment_date = (
                datetime.datetime.strptime(supervisor_data["Дата"], "%Y-%m-%d").date()
                if supervisor_data.get("Дата") else None
            )
            if supervisor_identifier_value:
                supervisor_manager = ManagerScheme(
                    source_info=SOURCE_INFO,
                    person_id=supervisor_person_id,
                    company_id=supervisor_company_id,
                    job_title=supervisor_job_title,
                    supervisor=True,
                    appointment_date=supervisor_appointment_date,
                    important_information=supervisor_important_information,
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["managers"].append(supervisor_manager)
        
        other_managers_data = egr_data.get("ИныеРуководители")
        if other_managers_data:
            for other_manager_data in other_managers_data:
                other_manager_full_name = other_manager_data.get("ФИОПолн", None)
                if other_manager_full_name:
                    other_manager_surname = other_manager_full_name.strip().split()[0].strip()
                    other_manager_patronymic = (
                        other_manager_full_name.strip().split()[-1].strip()
                        if len(other_manager_full_name.strip().split()) > 2 else None
                    )
                    other_manager_first_name = (
                        " ".join(other_manager_full_name.strip().split()[1:-1]).strip()
                        if other_manager_patronymic else other_manager_full_name.strip().split()[-1]
                    )
                other_manager_date_birth = None
                other_manager_gender = other_manager_data["Пол"].strip() if other_manager_data.get("Пол") else None
                other_manager_citizenship = (
                    COUNTRY_RUSSIA 
                    if other_manager_data.get("ВидГражд") and "Гражданин РФ" in other_manager_data["ВидГражд"]
                    else None
                )
                other_manager_identifier_name = "ИННФЛ"
                other_manager_identifier_value = other_manager_data["ИННФЛ"].strip() if other_manager_data.get("ИННФЛ") else None
                other_manager_identifier_sub_name = None
                other_manager_identifier_sub_value = None
                other_manager_important_information = other_manager_data["ДопИнфо"].strip() if other_manager_data.get("ДопИнфо") else None
                
                if supervisor_identifier_value:
                    other_manager_person_id = None
                    if not self.data["persons"]:
                        other_manager_person_id = "person_1"
                    else:
                        for person_key in self.data["persons"]:
                            if (
                                self.data["persons"].get(person_key)
                                and 
                                self.data["persons"][person_key].identifier_value == supervisor_identifier_value
                            ):
                                other_manager_person_id = person_key
                                break
                        if not other_manager_person_id:
                            other_manager_person_id = f"person_{len(self.data["persons"]) + 1}"
                    
                    other_manager_company_id = "company_1"
                    self.data["persons"][other_manager_person_id] = PersonScheme(
                        source_info=SOURCE_INFO,
                        important_information=other_manager_important_information,
                        surname=other_manager_surname,
                        first_name=other_manager_first_name,
                        patronymic=other_manager_patronymic,
                        date_birth=other_manager_date_birth,
                        gender=other_manager_gender,
                        citizenship=other_manager_citizenship,
                        identifier_name=other_manager_identifier_name,
                        identifier_value=other_manager_identifier_value,
                        identifier_sub_name=other_manager_identifier_sub_name,
                        identifier_sub_value=other_manager_identifier_sub_value,
                    )
                
                other_manager_job_title = other_manager_data["Должн"].strip() if other_manager_data.get("Должн") else None
                
                other_manager_appointment_date = (
                    datetime.datetime.strptime(other_manager_data["Дата"], "%Y-%m-%d").date()
                    if other_manager_data.get("Дата") else None
                )
            
            if other_manager_identifier_value:
                other_manager = ManagerScheme(
                    source_info=SOURCE_INFO,
                    person_id=other_manager_person_id,
                    company_id=other_manager_company_id,
                    job_title=other_manager_job_title,
                    supervisor=False,
                    appointment_date=other_manager_appointment_date,
                    important_information=other_manager_important_information,
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                self.data["managers"].append(other_manager)
        
        # Founders
        founders_data = egr_data.get("Учредители")
        if founders_data:
            for founder_data in founders_data:
                # ФЛ
                person_founder_data = founder_data.get('УчрФЛ')
                if person_founder_data:
                    person_founder_full_name = person_founder_data.get("ФИОПолн")
                    if person_founder_full_name:
                        person_founder_surname = person_founder_full_name.split()[0].strip()
                        person_founder_patronymic = (
                            person_founder_full_name.strip().split()[-1].strip()
                            if len(person_founder_full_name.strip().split()) > 2 else None
                        )
                        person_founder_first_name = (
                            " ".join(person_founder_full_name.strip().split()[1:-1]).strip()
                            if person_founder_patronymic else person_founder_full_name.strip().split()[-1]
                        )
                    person_founder_gender = person_founder_data.get("Пол")
                    
                    person_founder_citizenship = (
                        COUNTRY_RUSSIA 
                        if person_founder_data.get("ВидГражд") and "Гражданин РФ" in person_founder_data["ВидГражд"]
                        else None
                    )
                    person_founder_identifier_name = "ИННФЛ"
                    person_founder_identifier_value = person_founder_data.get("ИННФЛ")
                    if person_founder_identifier_value:
                        founder_person_id = None
                        if not self.data["persons"]:
                            founder_person_id = "person_1"
                        else:
                            for person_key in self.data["persons"]:
                                if (
                                    self.data["persons"].get(person_key)
                                    and 
                                    self.data["persons"][person_key].identifier_value == person_founder_identifier_value
                                ):
                                    founder_person_id = person_key
                                    break
                            if not founder_person_id:
                                founder_person_id = f"person_{len(self.data["persons"]) + 1}"
                        self.data["persons"][founder_person_id] = PersonScheme(
                            source_info=SOURCE_INFO,
                            important_information=None,
                            surname=person_founder_surname,
                            first_name=person_founder_first_name,
                            patronymic=person_founder_patronymic,
                            date_birth=None,
                            gender=person_founder_gender,
                            citizenship=person_founder_citizenship,
                            identifier_name=person_founder_identifier_name,
                            identifier_value=person_founder_identifier_value,
                            identifier_sub_name=None,
                            identifier_sub_value=None,
                        )
                        # Shareholder ФЛ
                        person_founder_share_percent = founder_data.get("Процент")
                        person_founder_share_value = founder_data.get("СуммаУК")
                        if person_founder_share_percent or person_founder_share_value:
                            person_founder_share_percent = round(float(person_founder_share_percent), 2) if founder_data.get("Процент") else None
                            person_founder_share_value = round(float(person_founder_share_value), 2) if founder_data.get("СуммаУК") else None
                            person_founder_purchase_date = (
                                datetime.datetime.strptime(founder_data["Дата"], "%Y-%m-%d").date()
                                if founder_data.get("Дата") else None
                            )
                            person_shareholder = ShareholderScheme(
                                source_info=SOURCE_INFO,
                                company_shareholder_id=None,
                                person_shareholder_id=founder_person_id,
                                company_share_id="company_1",
                                currency_id=CURRENCY_RUB,
                                share_percent=person_founder_share_percent,
                                share_value=person_founder_share_value,
                                purchase_date=person_founder_purchase_date,
                                status_info_id=STATUS_INFO_ACTUAL,
                            )
                            self.data["shareholders"].append(person_shareholder)
                        
                # ЮЛ
                company_founder_data = founder_data.get("УчрЮЛ")
                company_founder_registration_identifier_value = company_founder_data.get("ОГРН") if company_founder_data else None
                if company_founder_data and company_founder_registration_identifier_value:
                    company_founder_registration_identifier_name = "ОГРН"
                    company_founder_tax_identifier_name = "ИНН"
                    company_founder_tax_identifier_value = company_founder_data.get("ИНН")
                    company_founder_status = company_founder_data.get("Статус")
                    company_founder_short_name = company_founder_data["НаимСокрЮЛ"].strip() if company_founder_data.get("НаимСокрЮЛ") else None
                    company_founder_full_name = company_founder_data["НаимПолнЮЛ"].strip() if company_founder_data.get("НаимПолнЮЛ") else None
                    
                    founder_company_id = None
                    if not self.data["companies"]:
                        founder_company_id = "company_1"
                    else:
                        for company_key in self.data["companies"]:
                            if (
                                self.data["companies"].get(company_key)
                                and 
                                self.data["companies"][company_key].registration_identifier_value == company_founder_registration_identifier_value
                            ):
                                founder_company_id = company_key
                                break
                        if not founder_company_id:
                            if company_founder_registration_identifier_value != registration_identifier_value:
                                founder_company_id = f"company_{len(self.data["companies"]) + 1}"
                            else:
                                founder_company_id = "company_1"
                            
                    
                    self.data["companies"][founder_company_id] = CompanyScheme(
                        source_info=SOURCE_INFO,
                        important_information=None,
                        country_id=COUNTRY_RUSSIA,
                        registration_identifier_name=company_founder_registration_identifier_name,
                        registration_identifier_value=company_founder_registration_identifier_value,
                        tax_identifier_name=company_founder_tax_identifier_name,
                        tax_identifier_value=company_founder_tax_identifier_value,
                        status=company_founder_status,
                        short_name=company_founder_short_name,
                        full_name=company_founder_full_name,
                        short_name_en=None,
                        full_name_en=None,
                        founding_date=None,
                        termination_date=None,
                        is_financial_company=None,
                    )
                    
                    # Shareholder ЮЛ
                    company_founder_share_percent = founder_data.get("Процент")
                    company_founder_share_value = founder_data.get("СуммаУК")
                    if company_founder_share_percent or company_founder_share_value:
                        company_founder_share_percent = round(float(company_founder_share_percent), 2) if founder_data.get("Процент") else None
                        company_founder_share_value = round(float(company_founder_share_value), 2) if founder_data.get("СуммаУК") else None
                        company_founder_purchase_date = (
                            datetime.datetime.strptime(founder_data["Дата"], "%Y-%m-%d").date()
                            if founder_data.get("Дата") else None
                        )
                        company_shareholder = ShareholderScheme(
                            source_info=SOURCE_INFO,
                            company_shareholder_id=founder_company_id,
                            person_shareholder_id=None,
                            company_share_id="company_1",
                            currency_id=CURRENCY_RUB,
                            share_percent=company_founder_share_percent,
                            share_value=company_founder_share_value,
                            purchase_date=company_founder_purchase_date,
                            status_info_id=STATUS_INFO_ACTUAL,
                        )
                        self.data["shareholders"].append(company_shareholder)
        
        # Participation
        company_participations_data = egr_data.get("Участия")
        if company_participations_data:
            for company_participation_data in company_participations_data:
                company_participation_registration_identifier_value = company_participation_data.get("ОГРН")
                if company_participation_registration_identifier_value and company_participation_registration_identifier_value != registration_identifier_value:
                    company_participation_registration_identifier_name = "ОГРН"
                    company_participation_tax_identifier_name = "ИНН"
                    company_participation_tax_identifier_value = company_participation_data.get("ИНН")
                    company_participation_short_name = company_participation_data["НаимСокрЮЛ"].strip() if company_participation_data.get("НаимСокрЮЛ") else None
                    company_participation_full_name = company_participation_data["НаимПолнЮЛ"].strip() if company_participation_data.get("НаимПолнЮЛ") else None
                    company_participation_status = company_participation_data.get("Статус")
                                        
                    participation_company_id = None
                    if not self.data["companies"]:
                        participation_company_id = "company_1"
                    else:
                        for company_key in self.data["companies"]:
                            if (
                                self.data["companies"].get(company_key)
                                and 
                                self.data["companies"][company_key].registration_identifier_value == company_participation_registration_identifier_value
                            ):
                                participation_company_id = company_key
                                break
                        if not participation_company_id:
                            if company_participation_registration_identifier_value != registration_identifier_value:
                                participation_company_id = f"company_{len(self.data["companies"]) + 1}"
                            else:
                                participation_company_id = "company_1"
                            
                    self.data["companies"][participation_company_id] = CompanyScheme(
                        source_info=SOURCE_INFO,
                        important_information=None,
                        country_id=COUNTRY_RUSSIA,
                        registration_identifier_name=company_participation_registration_identifier_name,
                        registration_identifier_value=company_participation_registration_identifier_value,
                        tax_identifier_name=company_participation_tax_identifier_name,
                        tax_identifier_value=company_participation_tax_identifier_value,
                        status=company_participation_status,
                        short_name=company_participation_short_name,
                        full_name=company_participation_full_name,
                        short_name_en=None,
                        full_name_en=None,
                        founding_date=None,
                        termination_date=None,
                        is_financial_company=None,
                    )
                    
                    company_participation_share_percent = company_participation_data.get("Процент")
                    company_participation_share_value = company_participation_data.get("СуммаУК")
                    if company_participation_share_percent or company_participation_share_value:
                        company_participation_share_percent = round(float(company_participation_share_percent), 2) if company_participation_data.get("Процент") else None
                        company_participation_share_value = round(float(company_participation_share_value), 2) if company_participation_data.get("СуммаУК") else None
                        company_participation_purchase_date = (
                            datetime.datetime.strptime(company_participation_data["Дата"], "%Y-%m-%d").date()
                            if company_participation_data.get("Дата") else None
                        )
                        company_participant = ShareholderScheme(
                            source_info=SOURCE_INFO,
                            company_shareholder_id="company_1",
                            person_shareholder_id=None,
                            company_share_id=participation_company_id,
                            currency_id=CURRENCY_RUB,
                            share_percent=company_participation_share_percent,
                            share_value=company_participation_share_value,
                            purchase_date=company_participation_purchase_date,
                            status_info_id=STATUS_INFO_ACTUAL,
                        )
                        self.data["shareholders"].append(company_participant)
        
        # Events (События)
        company_events_data = egr_data.get("СПВЗ")
        if company_events_data:
            self.data["companies_events"]["company_1"] = []
            for company_event_data in company_events_data:
                company_event_date = (
                    datetime.datetime.strptime(company_event_data["Дата"], '%Y-%m-%d')
                    if company_event_data.get("Дата") else None
                )
                company_event_description = company_event_data.get("Текст")
                event = EventScheme(
                    source_info=SOURCE_INFO,
                    date=company_event_date,
                    description=company_event_description,
                    status_info_id=STATUS_INFO_ACTUAL,
                )
                if event not in self.data["companies_events"]["company_1"]:
                    self.data["companies_events"]["company_1"].append(event)
        
        # company branches
        company_branches_data = egr_data.get("Филиалы")
        if company_branches_data:
            self.data["companies_branches"]["company_1"] = []
            for company_branch_data in company_branches_data:
                if company_branch_data:
                    branch_main_identifier = company_branch_data["КПП"].strip() if company_branch_data.get("КПП") else None
                    branch_sub_identifier = company_branch_data["Наименование"].strip() if company_branch_data.get("Наименование") else None
                    branch_type = company_branch_data["Тип"].strip() if company_branch_data.get("Тип") else None
                    branch_founding_date = company_branch_data["ДатаПостУч"].strip() if company_branch_data.get("ДатаПостУч") else None
                    company_branch = CompanyBranchScheme(
                        main_identifier=branch_main_identifier,
                        sub_identifier=branch_sub_identifier,
                        type=branch_type,
                        founding_date=branch_founding_date,
                        status_info_id=STATUS_INFO_ACTUAL,
                    )
                    self.data["companies_branches"]["company_1"].append(company_branch)
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message=f"Успешный разбор регистрационной информации (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
        )
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message=f"Старт разбора финансовой информации (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
        )
        
        # BO
        bo = bo[list(bo)[0]] if bo[list(bo)[0]] else None
        if bo and not is_financial_company:
            self.data["companies_financial_statements"]["company_1"] = {}
            
            bo_periods = sorted([
                datetime.datetime.strptime(f"{year}-12-31", "%Y-%m-%d").date() for year in list(bo)
            ])
            
            for idx, bo_period in enumerate(bo_periods):
                financial_statement_id = f"financial_statement_{idx + 1}"
                self.data["companies_financial_statements"]["company_1"][financial_statement_id] = FinancialStatementScheme(
                    source_info=SOURCE_INFO,
                    period_type_id=FINANCIAL_STATEMENT_ANNUAL_PERIOD,
                    date=bo_period,
                    currency_id=CURRENCY_RUB,
                )
                
                self.data["companies_financial_statements_rows"][financial_statement_id] = []
                for financial_statement_row_name, financial_statement_row_value in bo[str(bo_period.year)].items():
                    if financial_statement_row_name.startswith("1"):
                        fs_row_type = FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Balance sheet"]
                    elif financial_statement_row_name.startswith("2"):
                        fs_row_type = FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Profit and loss"]
                    elif financial_statement_row_name.startswith("4"):
                        fs_row_type = FINANCIAL_STATEMENT_ROW_TYPE_MAPPING["Cash flow statement"]
                    else:
                        fs_row_type = None
                    if financial_statement_row_value:
                        financial_statement_row = FinancialStatementRowScheme(
                            type_id=fs_row_type,
                            name=financial_statement_row_name,
                            value=round(float(financial_statement_row_value) * 1000, 2),
                            status_info_id=STATUS_INFO_ACTUAL,
                        )
                        self.data["companies_financial_statements_rows"][financial_statement_id].append(financial_statement_row)
        await Log.add_log(
            log_type="info",
            request_uuid=self.request_uuid,
            message=f"Успешный разбор финансовой информации (ФНС России):\ncountry: 170;\nidentifier: {self.identifier}."
        )
        
        # print(DataForInsertionModuleScheme(**self.data))
        return DataForInsertionModuleScheme(**self.data)


if __name__ == "__main__":
    obj = FNSAdapterFinancialAndRegistrationData(request_uuid="test-test-test-test", identifier="123", token="123")
    print(asyncio.run(obj.adapt_data()))
