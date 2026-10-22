import asyncio
import datetime
from typing import Any, Dict, List, NoReturn
from uuid import uuid4

from sqlalchemy import Engine
from sqlalchemy.dialects.postgresql import insert
from src.utils.constants.reference_data import (
    COUNTRY, CURRENCY, FINANCIAL_STATEMENT_ROW_TYPE,
    FINANCIAL_STATEMENT_PERIOD_TYPE, STATUS_INFORMATION,
    TRACKED_TABLE, CONTACT_TYPE,
    DATA_TYPE
)

from src.database import sync_engine, get_sync_session, Base
from src.models import (
    Country, Currency,
    FinancialStatementRowType,
    FinancialStatementPeriodType, StatusInfo,
    TrackedTable, ContactType,
    DataType
)
from src.schemas import (    
    CompanyBranchScheme, ActivityScheme, CapitalScheme,
    FinancialStatementRowScheme, ClassifierScheme, LicenseScheme,
    AddressScheme, ContactScheme, SanctionScheme,
    CompanyScheme, FinancialStatementScheme, PersonScheme,
    ManagerScheme, ShareholderScheme, EventScheme,
    DataForInsertionModuleScheme,
)
from src.config import (
    checko_token, fns_token
)
from rpc.app import RPC
from service_logger.app import Log
from service_logger.prepare_reference_data import prepare_referense
# for test
from src.utils.constants.mapping import (
    COUNTRY_MAPPING, CURRENCY_MAPPING, FINANCIAL_STATEMENT_ROW_TYPE_MAPPING, 
    FINANCIAL_STATEMENT_PERIOD_TYPE_MAPPING, STATUS_INFORMATION_MAPPING, 
    CONTACT_TYPE_MAPPING, 
)
# ________

TOKENS: Dict[str, str] = {
    "CHECKO": checko_token,
    "FNS": fns_token, # type: ignore
}


def prepare_db(
    base: Any, sync_engine: Engine
):
    # base.metadata.drop_all(sync_engine)
    base.metadata.create_all(sync_engine)
    with get_sync_session() as session:
        prepare_referense(sync_session=session)
        
        stmt_country = insert(Country).values(COUNTRY).on_conflict_do_nothing()
        stmt_currency = insert(Currency).values(CURRENCY).on_conflict_do_nothing()
        stmt_financial_statement_row_type = insert(FinancialStatementRowType).values(FINANCIAL_STATEMENT_ROW_TYPE).on_conflict_do_nothing()
        stmt_financial_statement_period_type = insert(FinancialStatementPeriodType).values(FINANCIAL_STATEMENT_PERIOD_TYPE).on_conflict_do_nothing()
        stmt_status_info = insert(StatusInfo).values(STATUS_INFORMATION).on_conflict_do_nothing()
        stmt_tracked_table = insert(TrackedTable).values(TRACKED_TABLE).on_conflict_do_nothing()
        stmt_contact_type = insert(ContactType).values(CONTACT_TYPE).on_conflict_do_nothing()
        stmt_data_type = insert(DataType).values(DATA_TYPE).on_conflict_do_nothing()
        
        stmts: List = [
            stmt_country, stmt_currency,
            stmt_financial_statement_row_type,
            stmt_financial_statement_period_type, stmt_status_info,
            stmt_tracked_table, stmt_contact_type,
            stmt_data_type
        ]
        
        for stmt in stmts:
            session.execute(stmt)
        
        session.commit()

async def main() -> NoReturn:
    await Log.add_log(
        log_type="info",
        request_uuid=str(uuid4()),
        message="starting a DIM instance.",
    )
    while True:
        try:
            await RPC.consume(tokens=TOKENS)
        except Exception as e:
            print(e)



if __name__ == "__main__":
    prepare_db(
        base=Base,
        sync_engine=sync_engine,
    )
    asyncio.run(main())
