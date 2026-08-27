import pytest


@pytest.fixture
def anyio_backend() -> str:
    """Async tests run on asyncio only; trio is not a dependency."""
    return "asyncio"
