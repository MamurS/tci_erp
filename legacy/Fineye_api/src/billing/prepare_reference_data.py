from sqlalchemy.dialects.postgresql import insert

from src.connection_manager import async_session_maker
from src.utils.constants.billing.reference_data import VAT
from .models import Vat

async def prepare_reference():
    async with async_session_maker() as session:
        stmt_vat = insert(Vat).values(VAT).on_conflict_do_nothing()
        [
            await session.execute(stmt) for stmt in [stmt_vat, ]
        ]
        await session.commit()