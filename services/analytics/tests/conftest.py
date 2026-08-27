import pytest

from app.ratelimit import provisioning_limiter


@pytest.fixture
def anyio_backend() -> str:
    """Async tests run on asyncio only; trio is not a dependency."""
    return "asyncio"


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """The provisioning limiter is deliberately process-wide state, so it has
    to be cleared between tests: otherwise the suite exhausts its own per-IP
    window (every TestClient request comes from the same address) and later
    tests get 429s that have nothing to do with what they assert."""
    provisioning_limiter.reset()
