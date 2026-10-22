from sqlalchemy import (
    Column, ForeignKey, func,
    SmallInteger, Integer, BigInteger, Numeric,
    Text,
    Date, DateTime,
)

from src.connection_manager import Base



class Billing(Base):
    __tablename__ = "billing"
    
    id = Column(BigInteger, primary_key=True)
    
    contract_id = Column(Integer, ForeignKey("contract.id", ondelete="NO ACTION", onupdate="CASCADE"), nullable=False)
    inquiry = Column(Text)
    currency_id = Column(SmallInteger, ForeignKey("currency.id", ondelete="NO ACTION", onupdate="CASCADE"), nullable=False)
    to_pay = Column(Numeric(precision=30, scale=2))
    sum_vat = Column(Numeric(precision=30, scale=2))
    payment_start_date = Column(Date, nullable=False)
    payment_end_date = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()), nullable=False)


class Vat(Base):  # TODO
    __tablename__ = "vat"
    
    id = Column(SmallInteger, primary_key=True)
    
    country_id = Column(SmallInteger, ForeignKey("country.id"))
    percent = Column(Numeric(precision=5, scale=2))
