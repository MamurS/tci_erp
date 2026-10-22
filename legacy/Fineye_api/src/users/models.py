from sqlalchemy import Column, ForeignKey, func, UniqueConstraint, SmallInteger, Integer, String, Boolean, DateTime

from src.connection_manager import Base


class Contract(Base):
    __tablename__ = "contract"
    
    id = Column(Integer, primary_key=True)
    
    number = Column(String, nullable=False)
    uuid = Column(String(length=36), nullable=False)
    country_id = Column(SmallInteger, ForeignKey("country.id", ondelete="NO ACTION", onupdate="CASCADE"), nullable=False)
    currency_id = Column(SmallInteger, ForeignKey("currency.id", ondelete="NO ACTION", onupdate="CASCADE"), nullable=False)
    is_active = Column(Boolean, server_default="false")
    created_at = Column(DateTime(timezone=False), server_default=func.timezone('UTC', func.current_timestamp()))


class User(Base):
    __tablename__ = "user"
    
    id = Column(Integer, primary_key=True)
    
    contract_id = Column(Integer, ForeignKey("contract.id", ondelete="NO ACTION"), nullable=False)
    name = Column(String)
    is_active = Column(Boolean, server_default="false")
    created_at = Column(DateTime(timezone=False), server_default=func.timezone('UTC', func.current_timestamp()))
    
    __table_args__ = (
        UniqueConstraint("contract_id", "name", name="uix_contractid_name")
    ,)


class Token(Base):
    __tablename__ = "token"
    
    id = Column(Integer, primary_key=True)
    
    user_id = Column(Integer, ForeignKey("user.id", ondelete="NO ACTION"), nullable=True)
    value = Column(String(length=36), nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, server_default="false")
    is_admin = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=False), nullable=False, server_default=func.timezone('UTC', func.current_timestamp()))



if __name__ == "__main__":
    from connection_manager import sync_engine
    Base.metadata.create_all(sync_engine)
    