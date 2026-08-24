from pydantic import BaseModel, Field


class InputModelRatingDescription(BaseModel):
    rating_description_paragraph: str = Field(...)

class OutputModelRatingDescription(BaseModel):
    rating_description_paragraph: str = Field(...)


class InputModel(BaseModel):
    company_name: str = Field(...)
    status: str = Field(...)
    owners: str = Field(...)
    address: str = Field(...)
    main_companies_sales: str = Field(...)
    net_financial_result_main_companies: str = Field(...)
    gross_debt_main_companies: str = Field(...)
    total_long_term_assets_main_companies: str = Field(...)
    rating_description_paragraph: str = Field(...)
    group_structure_company_names: str = Field(...)


class OutputModel(BaseModel):
    company_name: str = Field(...)
    status: str = Field(...)
    owners: str = Field(...)
    address: str = Field(...)
    main_companies_sales: str = Field(...)
    net_financial_result_main_companies: str = Field(...)
    gross_debt_main_companies: str = Field(...)
    total_long_term_assets_main_companies: str = Field(...)
    rating_description_paragraph: str = Field(...)
    group_structure_company_names: str = Field(...)
