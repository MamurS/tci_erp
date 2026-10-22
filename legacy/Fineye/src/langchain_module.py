from abc import ABC

from typing import Any, Dict, List, Type

from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate
from langchain.output_parsers import PydanticOutputParser
from langchain_core.runnables.config import RunnableConfig

from pydantic import BaseModel
import tiktoken

from tenacity import retry, stop_after_attempt, wait_exponential

from .config import gpt_token


def custom_retry(multiplier: float, max_timeout: int, max_attempts: int):
    def _log_retry_attempt(retry_state):
        if retry_state and retry_state.attempt_number and retry_state.attempt_number != 1:
            print(f"🔄 Retrying function \"{retry_state.fn.__name__}\" attempt #{retry_state.attempt_number}")
    
    def _custom_retry(f):
        """
        Wrapper over tenacity retry so that all retry config is at a single place
        :param f:
        :return:
        """
        return retry(
            wait=wait_exponential(multiplier=multiplier, max=max_timeout),
            stop=stop_after_attempt(max_attempts),
            before=_log_retry_attempt,
        )(f)
    
    return _custom_retry

class LangChainAbstract(ABC):
    _RETRY_MULTIPLIER = 3
    _RETRY_MAX_TIMEOUT = 60
    _RETRY_MAX_ATTEMPTS = 1
    
    def __init__(self, temperature: float | int = 0.3, model_name: str = "gpt-4o"):
        self.temperature = temperature
        self.model_name = model_name
        self.llm = ChatOpenAI(
            model_name=self.model_name,
            temperature=self.temperature,
            streaming=True,
            openai_api_key=gpt_token
        )
        self.batch_size = 20
        self.tokenizer = tiktoken.encoding_for_model("gpt-4o")
    
    @custom_retry(_RETRY_MULTIPLIER, _RETRY_MAX_TIMEOUT, _RETRY_MAX_ATTEMPTS)
    async def _execute_langchain_task(
        self,
        input_data: dict | str,
        pydantic_object: Type[BaseModel] | None = None,
        prompt: str | None = None,
        input_variables_name: str = "query",
        # tags: List[str] = ["DEAFULT_TAG"],
        metadata: Dict[str, Any] = {"source": "Unknow"},
    ) -> Dict[Any, Any]:
        
        if not input_data:
            raise ValueError("It is necessary to provide data for processing.")
        
        if not pydantic_object:
            pydantic_object = self.pydantic_object
        
        if not prompt:
            prompt = self.prompt
        
        chain = self._set_model_params(
            pydantic_object=pydantic_object,
            prompt=prompt,
            input_variables=input_variables_name,
        )
        
        response = await chain.ainvoke(
            input={input_variables_name: input_data},
            config=RunnableConfig(
            # tags=tags,
            metadata=metadata,
        ))
        
        response_dict = response.dict()
        
        return response_dict
    
    @custom_retry(_RETRY_MULTIPLIER, _RETRY_MAX_TIMEOUT, _RETRY_MAX_ATTEMPTS)
    async def _execute_langchain_task_by_batch(
        self,
        input_data: List[Dict[str, Any]],
        pydantic_object: Type[BaseModel] | None = None,
        prompt: str | None = None,
        input_variables_name: str = "query",
        # tags: List[str] = ["DEAFULT_TAG"],
        metadata: Dict[str, Any] = {"source": "Unknow"}
    ) -> List[Dict[str, Any]]:
        if not input_data:
            raise ValueError("It is necessary to provide data for processing.")
        
        if not pydantic_object:
            pydantic_object = self.pydantic_object
        
        if not prompt:
            prompt = self.prompt
        
        chain = self._set_model_params(
            pydantic_object=pydantic_object,
            prompt=prompt,
            input_variables=input_variables_name
        )
        batch_results = []
        for batch in self._create_batches(input_data, self.batch_size):
            response = await chain.abatch(
                inputs=[{input_variables_name: item} for item in batch],
                config=RunnableConfig(
                    # tags=tags,
                    metadata=metadata
                )
            )
            batch_results.extend([res.dict() for res in response])
        
        return batch_results
    
    def _set_model_params(
        self,
        pydantic_object: Type[BaseModel],
        prompt: str,
        input_variables: str = "query"
    ):
        parser = PydanticOutputParser(pydantic_object=pydantic_object)
        prompt_template = PromptTemplate(
            template=prompt,
            input_variables=[input_variables],
            partial_variables={"format_instructions": parser.get_format_instructions()},
        )
        chain = prompt_template | self.llm | parser
        return chain
    
    def _create_batches(self, data: List[Dict[str, Any]], batch_size: int) -> List[List[Dict[str, Any]]]:
        return [data[i:i + batch_size] for i in range(0, len(data), batch_size)]
