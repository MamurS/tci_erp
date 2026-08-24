from sqlalchemy import (
    Column, UniqueConstraint, func, ForeignKey, Index, CheckConstraint,# UniqueConstraint,
    SmallInteger, Integer, BigInteger, Numeric,
    String, Text,
    Boolean,
    Date, DateTime,
    ARRAY,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from src.connection_manager import Base


class Company(Base):
    """
    Юр лица
    """
    __tablename__ = "company"
    
    id = Column(BigInteger, primary_key=True)
    
    country_id = Column(SmallInteger, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"))
    registration_identifier_name = Column(String(length=50))
    registration_identifier_value = Column(String(length=50))
    tax_identifier_name = Column(String(length=50))
    tax_identifier_value = Column(String(length=50))
    status = Column(String)
    short_name = Column(String)
    full_name = Column(String)
    short_name_en = Column(String)
    full_name_en = Column(String)
    founding_date = Column(Date)
    termination_date = Column(Date)
    important_information = Column(Text)
    is_financial_company = Column(Boolean)
    with_group = Column(Boolean, server_default="false")  # флаг, подготовлена ли группа компаний по ЮЛ
    with_court_case = Column(Boolean, server_default="false")  # флаг, подготовлены ли судебные дела по ЮЛ
    source_info = Column(String(length=75))
    
    foreigners_founders = Column(JSONB)  # FIXME Денормализация для учредителей иностранцев
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    company_shareholder = relationship(
        "Shareholder",
        back_populates="company_shareholder",
        foreign_keys="Shareholder.company_shareholder_id"
    )
    company_share = relationship(
        "Shareholder",
        back_populates="company_share",
        foreign_keys="Shareholder.company_share_id"
    )
    
    __table_args__ = (
        UniqueConstraint("country_id", "registration_identifier_value", name="uix_country_id_registration_identifier_value")
    ,)
    
    def to_dict(self):
        return {
            "id": self.id,
            "country_id": self.country_id,
            "registration_identifier_name": self.registration_identifier_name,
            "registration_identifier_value": self.registration_identifier_value,
            "tax_identifier_name": self.tax_identifier_name,
            "tax_identifier_value": self.tax_identifier_value,
            "status": self.status,
            "short_name": self.short_name,
            "full_name": self.full_name,
            "short_name_en": self.short_name_en,
            "full_name_en": self.full_name_en,
            "founding_date": self.founding_date,
            "termination_date": self.termination_date,
            "important_information": self.important_information,
            "is_financial_company": self.is_financial_company,
            "with_group": self.with_group,
            "with_court_case": self.with_court_case,
            "source_info": self.source_info,
            "foreigners_founders": self.foreigners_founders,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }

class CompanyBranch(Base):
    """
    Филиалы компаний
    """
    __tablename__ = "company_branch"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    main_identifier = Column(String(length=80))
    sub_identifier = Column(String)
    type = Column(String)
    founding_date = Column(Date)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "main_identifier": self.main_identifier,
            "sub_identifier": self.sub_identifier,
            "type": self.type,
            "founding_date": self.founding_date,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_company_branch", main_identifier, sub_identifier)
    ,)

class Activity(Base):
    """
    Виды деятельности ЮЛ
    """
    __tablename__ = "activity"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    is_main = Column(Boolean, server_default="false")
    code = Column(String)
    description = Column(Text)
    date = Column(Date)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "is_main": self.is_main,
            "code": self.code,
            "description": self.description,
            "date": self.date,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_activity", is_main, code)
    ,)

class Capital(Base):
    """
    Капиталы
    """
    __tablename__ = "capital"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    value = Column(Numeric(precision=30, scale=2))
    currency_id = Column(SmallInteger, ForeignKey("currency.id", ondelete="NO ACTION", onupdate="CASCADE"))
    type = Column(String(length=100))
    date = Column(Date)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "value": self.value,
            "currency_id": self.currency_id,
            "type": self.type,
            "date": self.date,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_capital", type, value)
    ,)

class Classifier(Base):
    """
    Коды классификаторов ЮЛ
    """
    __tablename__ = "classifier"    
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    name = Column(String)
    value = Column(String)
    description = Column(String)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "name": self.name,
            "value": self.value,
            "description": self.description,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_classifier", name, value)
    ,)

class License(Base):
    """
    Лицензии
    """
    __tablename__ = "license"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    license_identifier = Column(String(length=150))
    license_body = Column(Text)
    licensee = Column(String)
    valid_from = Column(Date)
    valid_to = Column(Date)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "license_identifier": self.license_identifier,
            "license_body": self.license_body,
            "licensee": self.licensee,
            "valid_from": self.valid_from,
            "valid_to": self.valid_to,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_license", license_identifier, license_body)
    ,)

class Country(Base):
    """
    Страны
    """
    __tablename__ = "country"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String(length=200))
    name_en_snake = Column(String(length=200))

class Currency(Base):
    """
    Список валют
    """
    __tablename__ = "currency"
    
    id = Column(SmallInteger, primary_key=True)
    name = Column(String(length=100))
    letter_code = Column(String(length=10))
    number_code = Column(String(length=10))

class FinancialStatementRowType(Base):
    """
    Виды отчетов
    """
    __tablename__ = "financial_statement_row_type"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String)

class FinancialStatementPeriodType(Base):
    """
    Типы отчетов по временым периодам
    """
    __tablename__ = "financial_statement_period_type"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String)

class FinancialStatement(Base):
    """
    Финансовые отчеты
    """
    __tablename__ = "financial_statement"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    period_type_id = Column(SmallInteger, ForeignKey("financial_statement_period_type.id", ondelete="NO ACTION"))
    date = Column(Date, nullable=False)
    currency_id = Column(SmallInteger, ForeignKey("currency.id", ondelete="NO ACTION", onupdate="CASCADE"))
    source_info = Column(String(length=75))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    financial_statement_row = relationship("FinancialStatementRow", back_populates="financial_statement")
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "period_type_id": self.period_type_id,
            "date": self.date,
            "currency_id": self.currency_id,
            "source_info": self.source_info,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_financial_statement", period_type_id, date)
    ,)

class FinancialStatementRow(Base):
    """
    Строки финансовых отчетов
    """
    __tablename__ = "financial_statement_row"
    
    id = Column(BigInteger, primary_key=True)
    
    financial_statement_id = Column(BigInteger, ForeignKey("financial_statement.id", ondelete="CASCADE", onupdate="CASCADE"))
    type_id = Column(SmallInteger, ForeignKey("financial_statement_row_type.id", ondelete="SET NULL", onupdate="CASCADE"))
    name = Column(String(length=100), nullable=False)
    value = Column(Numeric(precision=30, scale=2), nullable=False)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    financial_statement = relationship("FinancialStatement", back_populates="financial_statement_row")
    
    def to_dict(self):
        return {
            "id": self.id,
            "financial_statement_id": self.financial_statement_id,
            "type_id": self.type_id,
            "name": self.name,
            "value": self.value,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_financial_statement_row", name, status_info_id, value)
    ,)

class Person(Base):
    """
    Физ лица
    """
    __tablename__ = "person"
    
    id = Column(BigInteger, primary_key=True)
    
    surname = Column(String)
    first_name = Column(String)
    patronymic = Column(String)
    date_birth = Column(Date)
    gender = Column(String(length=35))
    citizenship = Column(SmallInteger, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"))
    identifier_name = Column(String)
    identifier_value = Column(String)
    identifier_sub_name = Column(String)
    identifier_sub_value = Column(String)
    important_information = Column(Text)
    source_info = Column(String(length=75))
        
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    person_shareholder = relationship("Shareholder", back_populates="person_shareholder")
    
    __table_args__ = (
        UniqueConstraint("identifier_name", "identifier_value", name="uix_identifier_name_identifier_value")
    ,)
    
    def to_dict(self):
        return {
            "id": self.id,
            "surname": self.surname,
            "first_name": self.first_name,
            "patronymic": self.patronymic,
            "date_birth": self.date_birth,
            "gender": self.gender,
            "citizenship": self.citizenship,
            "identifier_name": self.identifier_name,
            "identifier_value": self.identifier_value,
            "identifier_sub_name": self.identifier_sub_name,
            "identifier_sub_value": self.identifier_sub_value,
            "important_information": self.important_information,
            "source_info": self.source_info,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }    

class Manager(Base):
    """
    Должности ФЛ
    """
    __tablename__ = "manager"
    
    id = Column(BigInteger, primary_key=True)
    
    person_id = Column(BigInteger, ForeignKey('person.id', ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    company_id = Column(BigInteger, ForeignKey('company.id', ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    job_title = Column(String(length=200))
    supervisor = Column(Boolean, server_default="false")
    appointment_date = Column(Date)
    important_information = Column(Text)
    source_info = Column(String(length=75))
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    person = relationship("Person")
    
    def to_dict(self):
        return {
            "id": self.id,
            "person_id": self.person_id,
            "company_id": self.company_id,
            "job_title": self.job_title,
            "supervisor": self.supervisor,
            "appointment_date": self.appointment_date,
            "important_information": self.important_information,
            "source_info": self.source_info,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_manager", person_id, company_id)
    ,)

class Shareholder(Base):
    """Доли ЮЛ и ФЛ в ЮЛ"""
    
    __tablename__ = 'shareholder'
    
    id = Column(BigInteger, primary_key=True)
    
    company_shareholder_id = Column(
        BigInteger,
        ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    person_shareholder_id = Column(
        BigInteger,
        ForeignKey("person.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    company_share_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    
    currency_id = Column(SmallInteger, ForeignKey("currency.id", ondelete="NO ACTION", onupdate="CASCADE"))
    share_percent = Column(Numeric(precision=5, scale=2))
    share_value = Column(Numeric(precision=30, scale=2))
    purchase_date = Column(Date)
    source_info = Column(String(length=75))
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    company_shareholder = relationship(
        "Company",
        foreign_keys=[company_shareholder_id],
        back_populates="company_shareholder"
    )
    person_shareholder = relationship("Person")
    company_share = relationship(
        "Company",
        foreign_keys=[company_share_id],
        back_populates="company_share"
    )
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_shareholder_id": self.company_shareholder_id,
            "person_shareholder_id": self.person_shareholder_id,
            "company_share_id": self.company_share_id,
            "currency_id": self.currency_id,
            "share_percent": self.share_percent,
            "share_value": self.share_value,
            "purchase_date": self.purchase_date,
            "source_info": self.source_info,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_shareholder", company_shareholder_id, person_shareholder_id, company_share_id),
        CheckConstraint(
            'company_shareholder_id IS NOT NULL OR person_shareholder_id IS NOT NULL',
            name='company_shareholder_id_or_person_shareholder_id_not_null'
        ),
        UniqueConstraint("company_shareholder_id", "person_shareholder_id", "company_share_id", name="uix_company_shareholders")
    ,)

class CompanyGroup(Base):
    __tablename__ = "company_group"
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    
    
    company_id = Column(BigInteger, ForeignKey('company.id', ondelete="CASCADE", onupdate="CASCADE"), nullable=False)  # Полная идентификация
    
    country_id = Column(SmallInteger, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"))  # комбинированный идентификатор с company_identifier_value
    company_identifier_value = Column(String(length=50))                                                   # комбинированный идентификатор с country_id 
    
    relations = Column(ARRAY(String))
    
    source_info = Column(String(length=75))
    
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    __table_args__ = (
        Index("idx_company_group", country_id, company_identifier_value),
        UniqueConstraint("country_id", "company_id", "company_identifier_value", name="uix_company_group")
    ,)
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "country_id": self.country_id,
            "company_identifier_value": self.company_identifier_value,
            "relations": self.relations,
            "source_info": self.source_info,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }

class Contact(Base):
    """
    Контактная информация ЮЛ
    """
    __tablename__ = "contact"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(BigInteger, ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=True)
    person_id = Column(BigInteger, ForeignKey("person.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=True)
    contact_type_id = Column(SmallInteger, ForeignKey("contact_type.id", ondelete="NO ACTION", onupdate="CASCADE"), nullable=False)
    value = Column(String, nullable=False)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "person_id": self.person_id,
            "contact_type_id": self.contact_type_id,
            "value": self.value,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_contact", contact_type_id, value)
    ,)

class ContactType(Base):
    """
    Тип контактной информации
    """
    __tablename__ = "contact_type"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String(length=50))

class Address(Base):
    """
    Адреса
    """
    __tablename__ = "address"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(
        BigInteger,
        ForeignKey("company.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    # company_branch_id = Column(BigInteger,
    #                            ForeignKey("company_branch.id", ondelete="CASCADE", onupdate="CASCADE"),
    #                            nullable=True)
    person_id = Column(
        BigInteger,
        ForeignKey("person.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    country_id = Column(Integer, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"))
    address_type = Column(String)
    region_code = Column(String)
    zip = Column(String(length=50))
    full_address = Column(String)
    region = Column(String)
    area = Column(String)
    locality = Column(String)
    street = Column(String)
    house = Column(String)
    frame = Column(String)
    room = Column(String)
    date_from  = Column(Date)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            # "company_branch_id": self.company_branch_id,
            "person_id": self.person_id,
            "country_id": self.country_id,
            "address_type": self.address_type,
            "region_code": self.region_code,
            "zip": self.zip,
            "full_address": self.full_address,
            "region": self.region,
            "area": self.area,
            "locality": self.locality,
            "street": self.street,
            "house": self.house,
            "frame": self.frame,
            "room": self.room,
            "date_from": self.date_from,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_address", address_type, full_address)
    ,)

class Event(Base):
    """
    События ЮЛ/ФЛ
    """
    __tablename__ = "event"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(
        BigInteger,
        ForeignKey('company.id', ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    person_id = Column(
        BigInteger,
        ForeignKey('person.id', ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    date = Column(Date)
    description = Column(Text)
    source_info = Column(String(length=75))
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "person_id": self.person_id,
            "date": self.date,
            "description": self.description,
            "source_info": self.source_info,
            "status_info_id": self.status_info_id,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_event", date, description)
    ,)

class Sanction(Base):
    """
    Санции в отношении ЮЛ/ФЛ
    """
    __tablename__ = "sanction"
    
    id = Column(BigInteger, primary_key=True)
    
    company_id = Column(
        BigInteger,
        ForeignKey('company.id', ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    person_id = Column(
        BigInteger,
        ForeignKey('person.id', ondelete="CASCADE", onupdate="CASCADE"),
        nullable=True
    )
    country_id = Column(Integer, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"))
    description = Column(Text)
    
    status_info_id = Column(SmallInteger, ForeignKey("status_info.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "company_id": self.company_id,
            "person_id": self.person_id,
            "country_id": self.country_id,
            "description": self.description,
            "status_info_id": self.status_info_id,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        Index("idx_sanction", country_id, description)
    ,)

class TrackedTable(Base):
    """
    Структура таблиц для мониторинга изменений в полях
    """
    __tablename__ = "tracked_table"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String(length=70))
    description = Column(Text)

class DataType(Base):
    """
    Типы данных для ведения история изменений значений полей
    """
    __tablename__ = "data_type"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String(length=30))
    description = Column(Text)

class History(Base):
    """
    История изменений полей таблиц
    """
    __tablename__ = "history"
    
    id = Column(BigInteger, primary_key=True)
    
    tracked_table_id = Column(SmallInteger, ForeignKey("tracked_table.id", ondelete="NO ACTION", onupdate="CASCADE"))
    row_id = Column(BigInteger)
    column_name = Column(String(length=70))
    data_before = Column(String)
    data_after = Column(String)
    data_type_before = Column(SmallInteger, ForeignKey("data_type.id", ondelete="NO ACTION", onupdate="CASCADE"))
    data_type_after = Column(SmallInteger, ForeignKey("data_type.id", ondelete="NO ACTION", onupdate="CASCADE"))
    valid_from = Column(DateTime(timezone=True))
    valid_to = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))

class StatusInfo(Base):
    """
    Статус информации в таблице
    """
    __tablename__ = "status_info"
    
    id = Column(SmallInteger, primary_key=True)
    value = Column(String)


class CourtCase(Base):
    """
    Судебные дела
    """
    __tablename__ = "court_case"
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    
    country_id = Column(SmallInteger, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"))
    number = Column(String, nullable=False)
    court = Column(String)
    
    amount = Column(Numeric)
    currency_id = Column(SmallInteger, ForeignKey("currency.id", ondelete="NO ACTION", onupdate="CASCADE"))
    
    date = Column(Date)
    
    source_info = Column(String(length=75))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "country_id": self.country_id,
            "number": self.number,
            "court": self.court,
            "amount": self.amount,
            "currency_id": self.currency_id,
            "date": self.date,
            "source_info": self.source_info,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }
    
    __table_args__ = (
        UniqueConstraint('country_id', 'number', name='uq_court_case_country_id_number'),
    )

class ParticipantInCase(Base):
    """
    Участники судебных дел (ФЛ/ЮЛ)
    """
    __tablename__ = "participant_in_case"
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    
    court_case = Column(BigInteger, ForeignKey("court_case.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    
    is_legal_entity = Column(Boolean, nullable=False)
    participant_type = Column(SmallInteger, ForeignKey("participant_type.id", ondelete="NO ACTION", onupdate="CASCADE"), nullable=False)
    subject_id = Column(BigInteger)
    
    # Денормализующая часть (нужна для постановки задач на определение ссылок в БД для таск-менеджера)
    name = Column(String)
    identifier_type = Column(String)
    identifier_value = Column(String)
    address = Column(String)
    
    source_info = Column(String(length=75))
    
    actualized_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
    def to_dict(self):
        return {
            "id": self.id,
            "court_case": self.court_case,
            "is_legal_entity": self.is_legal_entity,
            "participant_type": self.participant_type,
            "subject_id": self.subject_id,
            "name": self.name,
            "identifier_type": self.identifier_type,
            "identifier_value": self.identifier_value,
            "address": self.address,
            "source_info": self.source_info,
            "actualized_at": self.actualized_at,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
        }

class ParticipantType(Base):
    """
    Тип участника судебного дела (ответчик, истец ...)
    """
    __tablename__ = "participant_type"
    
    id = Column(SmallInteger, primary_key=True, autoincrement=True)
    
    name = Column(String)
    description = Column(Text)
