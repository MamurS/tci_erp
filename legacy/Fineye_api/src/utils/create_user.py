from sqlalchemy import text

from src.connection_manager import sync_session_maker
from src.config import db_name, db_sub_user, db_sub_user_pass


def create_user() -> None:
    """Создание технического пользователя"""
    with sync_session_maker() as session:
        session.execute(
            text(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '{db_sub_user}') THEN
                        CREATE ROLE simplex WITH LOGIN PASSWORD '{db_sub_user_pass}';
                    END IF;
                END
                $$;
                GRANT CONNECT ON DATABASE {db_name} TO simplex;
                GRANT USAGE ON SCHEMA public TO simplex;
                GRANT SELECT ON service_log TO simplex;
                """
            )
        )
        session.commit()
