# from typing import Optional
from pydantic import BaseModel


class TokenScheme(BaseModel):
    value: str
    # amqp_conn: Optional[AMQPConnectionSchema]