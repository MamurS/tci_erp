from contextlib import asynccontextmanager, contextmanager
import os
from typing import AsyncGenerator, Generator
import paramiko
from sqlalchemy import create_engine, insert
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from .config import (
    db_user, db_pass, db_host, db_port, db_name,
    sftp_user, sftp_pass, sftp_host, sftp_port, sftp_base_path,
)


DATABASE_DSN_SYNC = f'postgresql+psycopg2://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}'
DATABASE_DSN_ASYNC = f'postgresql+asyncpg://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}'

sync_engine = create_engine(DATABASE_DSN_SYNC)
async_engine = create_async_engine(DATABASE_DSN_ASYNC)

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

class SyncSFTPStorage:
    def __init__(self, rotation_folders: int=50):
        self.host = sftp_host
        self.port = int(sftp_port)
        self.username = sftp_user
        self.password = sftp_pass
        self.base_path = sftp_base_path.rstrip('/')
        self.rotation_folders = rotation_folders
        self._transport = None
        self._sftp = None
        self._folder_counter = 0
        self._connect()
        self._verify_permissions()
        self._ensure_directory_structure()
        self._init_rotation_folders()
    
    def _connect(self):
        """Устанавливает соединение с SFTP сервером"""
        self._transport = paramiko.Transport((self.host, self.port))
        self._transport.connect(username=self.username, password=self.password)
        self._sftp = paramiko.SFTPClient.from_transport(self._transport)
    
    def _verify_permissions(self):
        """Проверяет права на запись в базовую директорию"""
        try:
            test_dir = f"{self.base_path}/_permission_test"
            self._sftp.mkdir(test_dir)
            self._sftp.rmdir(test_dir)
        except Exception as e:
            raise PermissionError(f"No write permissions in {self.base_path}: {str(e)}")
    
    def _ensure_directory_structure(self):
        """Создает базовую директорию если её нет"""
        try:
            self._sftp.chdir(self.base_path)
            print(f"Base directory exists: {self.base_path}")
        except IOError:
            try:
                print(f"Creating base directory: {self.base_path}")
                self._sftp.mkdir(self.base_path)
                print("Base directory created successfully")
            except Exception as e:
                raise IOError(f"Cannot create base directory: {str(e)}")
    
    def _init_rotation_folders(self):
        """Создает папки для ротации с проверкой прав"""
        print(f"Initializing {self.rotation_folders} rotation folders...")
        for i in range(self.rotation_folders):
            folder_name = f"{i:02d}"
            folder_path = f"{self.base_path}/{folder_name}"
            try:
                self._sftp.stat(folder_path)
                # print(f"Folder exists: {folder_path}")
            except IOError:
                try:
                    # print(f"Creating folder: {folder_path}")
                    self._sftp.mkdir(folder_path)
                    # print(f"Folder created: {folder_path}")
                except Exception as e:
                    raise IOError(f"Cannot create rotation folder {folder_path}: {str(e)}")
        print("Rotation folders initialized")
    
    def _get_next_rotation_folder(self):
        """Возвращает следующую папку для ротации"""
        folder_name = f"{self._folder_counter:02d}"
        self._folder_counter = (self._folder_counter + 1) % self.rotation_folders
        return f"{self.base_path}/{folder_name}"
    
    def close(self):
        """Закрывает соединение с SFTP сервером"""
        if self._sftp:
            self._sftp.close()
        if self._transport:
            self._transport.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    def _get_file_path(self, original_filename: str):
        """
        Генерирует путь для хранения файла на SFTP с оригинальным именем
        """
        rotation_folder = self._get_next_rotation_folder()
        
        filename, ext = os.path.splitext(original_filename)
        unique_filename = f"{filename}{ext}"
        return f"{rotation_folder}/{unique_filename}"
    
    def save_file(self, source_path: str, original_filename: str, file_uuid: str):
        """
        Сохраняет файл на SFTP с оригинальным именем
        """
        sftp_path = self._get_file_path(original_filename)
        
        self._sftp.put(source_path, sftp_path)
        
        return sftp_path
    
    def download_file(self, sftp_path: str, local_path: str=None):
        """
        Скачивает файл с SFTP сервера
        """
        if local_path:
            self._sftp.get(sftp_path, local_path)
        else:
            with self._sftp.file(sftp_path, 'rb') as remote_file:
                return remote_file.read()
    
    def delete_file(self, sftp_path):
        """Удаляет файл с SFTP сервера"""
        self._sftp.remove(sftp_path)
        
        # Попытка удалить пустую папку (не критично если не получится)
        try:
            folder_path = os.path.dirname(sftp_path)
            if not self._sftp.listdir(folder_path):
                self._sftp.rmdir(folder_path)
        except:  # noqa: E722
            pass
    
    def file_exists(self, sftp_path: str):
        """Проверяет существование файла на SFTP сервере"""
        try:
            self._sftp.stat(sftp_path)
            return True
        except IOError:
            return False
