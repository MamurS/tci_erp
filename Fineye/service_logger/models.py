
from sqlalchemy import (
    Column, ForeignKey, func,
    SmallInteger, BigInteger, Numeric,
    String, Text,
    Date, DateTime,
)

from src.connection_manager import Base

class Service(Base):
    __tablename__ = "service"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String)
    price = Column(Numeric(precision=12, scale=2), nullable=False)
    price_from = Column(Date, server_default=func.current_date(), nullable=False)
    price_to = Column(Date)
    description = Column(Text)


class ServiceLog(Base):
    __tablename__ = "service_log"
    
    id = Column(BigInteger, primary_key=True)
    
    service_id = Column(SmallInteger, ForeignKey("service.id", ondelete="SET NULL", onupdate="CASCADE"), nullable=False)
    log_type_id = Column(SmallInteger, ForeignKey("log_type.id"), nullable=False)
    uuid = Column(String(length=36), nullable=False)
    message = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()), nullable=False)


class LogType(Base):
    __tablename__ = "log_type"
    
    id = Column(SmallInteger, primary_key=True)
    name = Column(String)
