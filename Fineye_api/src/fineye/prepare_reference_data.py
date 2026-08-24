from typing import List

from sqlalchemy.dialects.postgresql import insert

from src.connection_manager import async_session_maker
from src.fineye.models import ExchangeRate
from src.utils.constants.fineye.reference_data import EXCHANGE_RATE


async def prepare_reference():
    async with async_session_maker() as session:
        stmt_exchange_rate = insert(ExchangeRate).values(EXCHANGE_RATE).on_conflict_do_nothing()
        
        stmts: List = [
            stmt_exchange_rate, 
        ]
        
        for stmt in stmts:
            await session.execute(stmt)
        
        await session.commit()