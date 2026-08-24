
from typing import List, Optional
from pydantic import BaseModel


class CustomGroupIdentifiers(BaseModel):
    Russia: List[Optional[str]] = []
