from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseFinancialDataAdapter(ABC):
    def __init__(self, financial_data: Dict[str, Any]):
        self.financial_data = financial_data
        self.adapted_financial_data: Dict[str, Any] = {}
    
    @abstractmethod
    def adapt_financial_data(self) -> Dict[str, Any]:
        ...
