from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

from src.connection_manager import async_session_maker
from src.utils.constants.logger.reference_data import ENDPOINT, SERVICE, LOG_TYPE
from .models import Endpoint, Service, LogType

async def prepare_reference():
    async with async_session_maker() as session:
        stmt_endpoint = insert(Endpoint).values(ENDPOINT).on_conflict_do_nothing()
        stmt_service = insert(Service).values(SERVICE).on_conflict_do_nothing()
        stmt_log_type = insert(LogType).values(LOG_TYPE).on_conflict_do_nothing()
        [
            await session.execute(stmt) for stmt in [stmt_endpoint, stmt_service, stmt_log_type, ]
        ]
        await session.commit()
        
        stmt_func = text(
            
            """
            CREATE OR REPLACE FUNCTION notify_fineye_pro()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Проверяем что это новая запись с нужным log_type_id
                -- и что service_id = 2 (без лишнего запроса к таблице service)
                IF TG_OP = 'INSERT' AND NEW.log_type_id = 3 AND NEW.service_id = 2 THEN
                    PERFORM pg_notify(
                        'fineye_pro', 
                        json_build_object(
                            'event', 'insert',
                            'id', NEW.id,
                            'service_id', NEW.service_id,
                            'uuid', NEW.uuid,
                            'created_at', NEW.created_at,
                            'message', NEW.message
                        )::text
                    );
                    
                    RAISE NOTICE 'Уведомление отправлено для записи %', NEW.id;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        await session.execute(stmt_func)
        await session.execute(
            text(
                """
                DO $$
                BEGIN
                    -- Безопасное удаление с обработкой ошибки
                    BEGIN
                        EXECUTE 'DROP TRIGGER IF EXISTS fineye_pro_trigger ON service_log';
                    EXCEPTION WHEN undefined_object THEN
                        -- Триггера нет - ничего не делаем
                        NULL;
                    END;
                END $$;
                """
            )
        )
        
        # 3. Создаем триггер заново
        await session.execute(
            text(
                """
                CREATE TRIGGER fineye_pro_trigger
                AFTER INSERT ON service_log
                FOR EACH ROW
                EXECUTE FUNCTION notify_fineye_pro();
                """
            )
        )
        
        await session.commit()
