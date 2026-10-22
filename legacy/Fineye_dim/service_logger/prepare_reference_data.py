from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from .reference_data import SERVICE, LOG_TYPE
from .models import Service, LogType

def prepare_referense(sync_session: Session):
    stmt_service = insert(Service).values(SERVICE).on_conflict_do_nothing()
    stmt_log_type = insert(LogType).values(LOG_TYPE).on_conflict_do_nothing()
    [
        sync_session.execute(stmt) for stmt in [stmt_service, stmt_log_type, ]
    ]
    sync_session.commit()