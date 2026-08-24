from sqlalchemy import (
    Column, ForeignKey, UniqueConstraint, Index, func,
    SmallInteger, Integer, BigInteger, Numeric,
    String, Text,
    Boolean,
    Date, DateTime,
    LargeBinary,
)

from src.connection_manager import Base


class Endpoint(Base):
    __tablename__ = "endpoint"
    
    id = Column(SmallInteger, primary_key=True)
    
    name = Column(String, nullable=False)
    description = Column(Text)


class EndpointLog(Base):
    __tablename__ = "endpoint_log"
    
    id = Column(BigInteger, primary_key=True)
    
    token_id = Column(Integer, ForeignKey("token.id"), nullable=False)
    endpoint_id = Column(SmallInteger, ForeignKey("endpoint.id"), nullable=False)
    log_type_id = Column(SmallInteger, ForeignKey("log_type.id", ondelete="SET NULL", onupdate="CASCADE"))
    uuid = Column(String(length=36), nullable=False)
    message = Column(String)
    data = Column(LargeBinary)
    status = Column(Boolean, server_default="false")
    
    requested_at = Column(DateTime(timezone=True), server_default=func.timezone('UTC', func.current_timestamp()))
    responded_at = Column(DateTime(timezone=True))
    
    __table_args__ = (
        UniqueConstraint(token_id, endpoint_id, uuid, name="uix_token_id_endpoint_id_uuid"),
        Index("idx_hash_uuid_endpoint_log", uuid, postgresql_using="hash")
    ,)


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

    __table_args__ = (
        Index("idx_hash_uuid_service_log", uuid, postgresql_using="hash")
    ,)

class LogType(Base):
    __tablename__ = "log_type"
    
    id = Column(SmallInteger, primary_key=True)
    name = Column(String)

