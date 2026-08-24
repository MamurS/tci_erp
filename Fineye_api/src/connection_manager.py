import os
from typing import Generator, AsyncGenerator, Optional

import asyncssh
from sqlalchemy import URL, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine, AsyncSession


from src.config import (
    db_user, db_pass, db_host, db_port, db_name,
    pg_bouncer_host, pg_bouncer_port,
    sftp_user, sftp_pass, sftp_host, sftp_port, sftp_base_path,
)


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


DATABASE_DSN_SYNC = f"postgresql+psycopg2://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
DATABASE_DSN_ASYNC = f"postgresql+asyncpg://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

DATABASE_BOUNCER_DSN_SYNC = f'postgresql+psycopg2://{db_user}:{db_pass}@{pg_bouncer_host}:{pg_bouncer_port}/{db_name}'
DATABASE_BOUNCER_DSN_ASYNC = f'postgresql+asyncpg://{db_user}:{db_pass}@{pg_bouncer_host}:{pg_bouncer_port}/{db_name}'

sync_engine = create_engine(DATABASE_DSN_SYNC)
async_engine = create_async_engine(
    url=URL.create(
        drivername="postgresql+asyncpg",
        username=db_user,
        password=db_pass,
        host=pg_bouncer_host,
        port=pg_bouncer_port,
        database=db_name
    ),
    pool_size=10,
    max_overflow=20,
    pool_timeout=70,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=False,
    connect_args={
        "prepared_statement_cache_size": 0,  # Должно быть int, а не строка
        "command_timeout": 180,
        "server_settings": {
            "application_name": "fineye_pro_api",
        }
    }
)

sync_engine_without_bouncer = create_engine(
    url=URL.create(
        drivername="postgresql+psycopg2",
        username=db_user,
        password=db_pass,
        host=db_host,
        port=db_port,
        database=db_name
    ),
    pool_size=5,
)
async_engine_without_bouncer = create_async_engine(
    DATABASE_DSN_ASYNC,
    connect_args={
        "server_settings": {
            "application_name": "fineye_pro_api"
        }
    },
)

sync_session_maker = sessionmaker(sync_engine)
async_session_maker = async_sessionmaker(async_engine)


def get_sync_session() -> Generator[Session, None, None]:
    with sync_session_maker() as session:
        yield session 

async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session

class AsyncSFTPStorage:
    def __init__(self,):
        self.host = sftp_host
        self.port = sftp_port
        self.username = sftp_user
        self.password = sftp_pass
        self.base_path = sftp_base_path.rstrip('/')
        self._conn = None
        self._sftp = None
    
    async def connect(self):
        """Устанавливает асинхронное соединение с SFTP сервером"""
        if not self._conn:
            self._conn = await asyncssh.connect(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                known_hosts=None
            )
            self._sftp = await self._conn.start_sftp_client()
            await self._ensure_directory_structure()
    
    async def close(self):
        """Закрывает соединение с SFTP сервером"""
        if self._sftp:
            self._sftp.exit()
        if self._conn:
            self._conn.close()
            self._conn = None
    
    async def __aenter__(self):
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
    
    async def _ensure_directory_structure(self):
        """Создает базовую структуру папок при инициализации"""
        try:
            await self._sftp.stat(self.base_path)
        except asyncssh.SFTPFailure:
            await self._sftp.mkdir(self.base_path)
    
    def get_file_path(self, file_uuid: str) -> str:
        """
        Генерирует путь для хранения файла на SFTP
        """
        folder_name = file_uuid[:2].lower()
        return f"{self.base_path}/{folder_name}/{file_uuid}"
    
    async def save_file(self, source_path: str, file_uuid: str) -> str:
        """
        Асинхронно сохраняет файл на SFTP
        """
        sftp_path = self.get_file_path(file_uuid)
        folder_path = os.path.dirname(sftp_path)
        
        try:
            await self._sftp.stat(folder_path)
        except asyncssh.SFTPFailure:
            await self._sftp.mkdir(folder_path)
        
        await self._sftp.put(source_path, sftp_path)
        return sftp_path
    
    async def download_file(self, sftp_path: str, local_path: Optional[str] = None) -> Optional[bytes]:
        """
        Асинхронно скачивает файл с SFTP сервера
        """
        if local_path:
            await self._sftp.get(sftp_path, local_path)
        else:
            async with self._sftp.open(sftp_path, 'rb') as remote_file:
                return await remote_file.read()
    
    async def delete_file(self, sftp_path: str) -> None:
        """Асинхронно удаляет файл с SFTP сервера"""
        await self._sftp.remove(sftp_path)
        
        # Попытка удалить пустую папку
        try:
            folder_path = os.path.dirname(sftp_path)
            if not await self._sftp.listdir(folder_path):
                await self._sftp.rmdir(folder_path)
        except:  # noqa: E722
            pass
    
    async def file_exists(self, sftp_path: str) -> bool:
        """Асинхронно проверяет существование файла на SFTP сервере"""
        try:
            await self._sftp.stat(sftp_path)
            return True
        except asyncssh.SFTPFailure:
            return False
