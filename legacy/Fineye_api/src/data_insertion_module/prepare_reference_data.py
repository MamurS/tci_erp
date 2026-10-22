from typing import List

from sqlalchemy.dialects.postgresql import insert

from src.connection_manager import async_session_maker
from src.data_insertion_module.models import (
    Country, Currency,
    FinancialStatementRowType,
    FinancialStatementPeriodType, StatusInfo,
    TrackedTable, ContactType,
    DataType,
    ParticipantType,
)
from src.utils.constants.data_insertion_module.reference_data import (
    COUNTRY, CURRENCY, FINANCIAL_STATEMENT_ROW_TYPE,
    FINANCIAL_STATEMENT_PERIOD_TYPE, STATUS_INFORMATION,
    TRACKED_TABLE, CONTACT_TYPE,
    DATA_TYPE,
    PARTICIPANT_TYPE,
)


async def prepare_reference():
    async with async_session_maker() as session:
        stmt_country = insert(Country).values(COUNTRY).on_conflict_do_nothing()
        stmt_currency = insert(Currency).values(CURRENCY).on_conflict_do_nothing()
        stmt_financial_statement_row_type = insert(FinancialStatementRowType).values(FINANCIAL_STATEMENT_ROW_TYPE).on_conflict_do_nothing()
        stmt_financial_statement_period_type = insert(FinancialStatementPeriodType).values(FINANCIAL_STATEMENT_PERIOD_TYPE).on_conflict_do_nothing()
        stmt_status_info = insert(StatusInfo).values(STATUS_INFORMATION).on_conflict_do_nothing()
        stmt_tracked_table = insert(TrackedTable).values(TRACKED_TABLE).on_conflict_do_nothing()
        stmt_contact_type = insert(ContactType).values(CONTACT_TYPE).on_conflict_do_nothing()
        stmt_data_type = insert(DataType).values(DATA_TYPE).on_conflict_do_nothing()
        stmt_participant_type = insert(ParticipantType).values(PARTICIPANT_TYPE).on_conflict_do_nothing()
        
        stmts: List = [
            stmt_country, stmt_currency,
            stmt_financial_statement_row_type,
            stmt_financial_statement_period_type, stmt_status_info,
            stmt_tracked_table, stmt_contact_type,
            stmt_data_type,
            stmt_participant_type,
        ]
        
        for stmt in stmts:
            await session.execute(stmt)
        
        await session.commit()