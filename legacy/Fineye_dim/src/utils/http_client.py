import asyncio
from functools import wraps
from typing import Callable, Any, Dict, Optional

from diskcache import Cache
import aiohttp
from async_limiter import DualRateLimiter
import requests


HTTP_CACHE = Cache(
    "http_cache",
    size_limit=1_000_000_000,  # ~1GB
    eviction_policy="least-recently-used"
)

async_rate_limiter = DualRateLimiter(
    max_concurrent=19,
    max_requests=19,
    time_period=1.0,
    name="http-client rate limiter",
)

def cache_http_responses(ttl: int = 86400,) -> Callable:
    def decorator(func: Callable) -> Callable:
        if asyncio.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs) -> Any:
                cache_key = make_cache_key(func, *args, **kwargs)
                
                # Проверяем кеш (синхронная операция в отдельном потоке)
                if cache_key in HTTP_CACHE:
                    return HTTP_CACHE.get(cache_key)
                
                result = await func(*args, **kwargs)
                
                if result is not None:
                    # Записываем в кеш (синхронная операция в отдельном потоке)
                    await asyncio.to_thread(
                        lambda: HTTP_CACHE.set(cache_key, result, expire=ttl)
                    )
                
                return result
            
            wrapper = async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs) -> Any:
                cache_key = make_cache_key(func, *args, **kwargs)
                
                if cache_key in HTTP_CACHE:
                    return HTTP_CACHE.get(cache_key)
                
                result = func(*args, **kwargs)
                
                if result is not None:
                    HTTP_CACHE.set(cache_key, result, expire=ttl)
                
                return result
            
            wrapper = sync_wrapper
        
        return wrapper
    
    return decorator

def make_cache_key(func: Callable, *args, **kwargs) -> str:
    """Создает ключ кэша на основе аргументов функции"""
    key_parts = [func.__name__]
    
    # Обрабатываем аргументы
    for arg in args:
        if isinstance(arg, (str, int, float, bool)):
            key_parts.append(str(arg))
        elif isinstance(arg, dict):
            key_parts.extend(f"{k}={v}" for k, v in sorted(arg.items()))
    
    # Обрабатываем ключевые аргументы
    for k, v in sorted(kwargs.items()):
        if isinstance(v, (str, int, float, bool)):
            key_parts.append(f"{k}={v}")
        elif isinstance(v, dict):
            key_parts.extend(f"{k}_{sub_k}={sub_v}" for sub_k, sub_v in sorted(v.items()))
    
    return "|".join(key_parts)


class AsyncHTTPClient:
    @async_rate_limiter.limit()
    @cache_http_responses()
    async def get_json(self, url: str, params: Optional[Dict] = None) -> Dict:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params, ssl=False) as response:
                response.raise_for_status()
                return await response.json()

class SyncHTTPClient:
    @cache_http_responses()
    def get_json(self, url: str, params: Optional[Dict] = None) -> Dict:
        response = requests.get(url, params=params, verify=False)
        response.raise_for_status()
        return response.json()

sync_client = SyncHTTPClient()
async_client = AsyncHTTPClient()
