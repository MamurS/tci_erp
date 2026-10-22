from sqlalchemy import (
    Column, ForeignKey, func,
    String,
    SmallInteger, Integer, BigInteger, Boolean, Numeric,
    Date, DateTime,
    JSON,
    )

from src.connection_manager import Base


class Currency(Base):
    """
    Список валют
    """
    __tablename__ = "currency"
    
    id = Column(SmallInteger, primary_key=True)
    name = Column(String(length=100))
    letter_code = Column(String(length=10))
    number_code = Column(String(length=10))

class RequestResult(Base):
    __tablename__ = "request_result"
    
    id = Column(BigInteger, primary_key=True)
    
    recipient = Column(String, nullable=False)
    file_id = Column(BigInteger, ForeignKey("file_store.id"))
    uuid = Column(String(length=36))
    data = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))

class FileStore(Base):
    __tablename__ = "file_store"
        
    id = Column(Integer, primary_key=True)
    
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    uuid = Column(String(length=36))
    is_deleted = Column(Boolean, nullable=False, server_default="false")
    deleted_at = Column(DateTime(timezone=True))
    loaded_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    
class ExchangeRate(Base):
    __tablename__ = "exchange_rate"
    
    id = Column(Integer, primary_key=True)
    
    from_currency = Column(SmallInteger, ForeignKey("currency.id", ondelete="SET NULL", onupdate="CASCADE"), nullable=False)
    to_currency = Column(SmallInteger, ForeignKey("currency.id", ondelete="SET NULL", onupdate="CASCADE"), nullable=False)
    value = Column(Numeric(precision=30, scale=2), nullable=False)
    date = Column(Date, nullable=False)
