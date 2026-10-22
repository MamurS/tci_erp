from sqlalchemy.dialects.postgresql import insert

from src.connection_manager import async_session_maker
from src.utils.constants.users.reference_data import TEST_CONTRACT, TEST_USER, TEST_TOKEN
from .models import Contract, Token, User

async def prepare_reference():
    async with async_session_maker() as session:        
        stmt_contract = insert(Contract).values(TEST_CONTRACT).on_conflict_do_nothing()
        stmt_user = insert(User).values(TEST_USER).on_conflict_do_nothing()
        stmt_token = insert(Token).values(TEST_TOKEN).on_conflict_do_nothing()
        [
            await session.execute(stmt) for stmt in [stmt_contract, stmt_user, stmt_token]
        ]
        await session.commit()