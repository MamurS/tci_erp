from contextlib import asynccontextmanager, contextmanager
from typing import AsyncGenerator, Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from .config import (
    db_user, db_pass, db_host, db_port, db_name,
    pg_bouncer_host, pg_bouncer_port,
)


DATABASE_DSN_SYNC = f'postgresql+psycopg2://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}'
DATABASE_DSN_ASYNC = f'postgresql+asyncpg://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}'

DATABASE_BOUNCER_DSN_SYNC = f'postgresql+psycopg2://{db_user}:{db_pass}@{pg_bouncer_host}:{pg_bouncer_port}/{db_name}'
DATABASE_BOUNCER_DSN_ASYNC = f'postgresql+asyncpg://{db_user}:{db_pass}@{pg_bouncer_host}:{pg_bouncer_port}/{db_name}'

sync_engine = create_engine(DATABASE_DSN_SYNC)
async_engine = create_async_engine(
    url=DATABASE_BOUNCER_DSN_ASYNC,
    pool_size=10,
    max_overflow=20,
    pool_timeout=70,
    pool_pre_ping=True,
    connect_args={
        "prepared_statement_cache_size": 0,
        "command_timeout": 180,
        "server_settings": {
            "application_name": "fineye_pro_dim"
        }
    }
)

session_fabric_sync = sessionmaker(sync_engine)
session_fabric_async = async_sessionmaker(async_engine, class_=AsyncSession)

class Base(DeclarativeBase):
    __abstract__ = True
    
    repr_cols_ignore = ("created_at", "updated_at", )
    
    def __repr__(self):
        """Используем только столбцы данных, исключая relationship для избежания неожиданных загрузок."""
        cols = self.__table__.columns
        # Собираем имена всех атрибутов, участвующих в отношениях
        relationship_keys = set(rel.key for rel in self.__mapper__.relationships)
        # Фильтруем столбцы, исключая те, которые принадлежат к отношениям
        display_cols = [col for col in cols if col.name not in relationship_keys]
        # Фильтрация и выбор столбцов на основе repr_cols и repr_cols_num
        selected_cols = [
            col for col in display_cols if col.name not in self.repr_cols_ignore
        ]
        # Формирование строки представления
        cols_data = [
            f"{col.name}={getattr(self, col.name)}" for col in selected_cols
        ]
        return f"<{self.__class__.__name__} {', '.join(cols_data)}>"

@contextmanager
def get_sync_session() -> Generator[Session, None, None]:
    with session_fabric_sync() as session:
        yield session 

@asynccontextmanager
async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with session_fabric_async() as session:
        yield session
