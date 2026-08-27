"""Rate limiting for the provisioning endpoints.

These endpoints create auth users, so they are the ones worth throttling: an
attacker who somehow obtained a sales token should not be able to mint
hundreds of accounts, and an unauthenticated flood should not be able to make
us hammer Supabase's admin API.

Two independent buckets, both of which must allow the call:

  * per IP     — blunt, and the only thing available before we know who is
                 calling (the 401 path burns IP budget, not caller budget);
  * per caller — the authenticated user id, so one compromised token is
                 capped no matter how many addresses it comes from.

Deliberately in-process. The service runs as a single small instance, and a
fixed-window counter in memory needs no Redis, no extra failure mode and no
extra cost. It resets on redeploy, and two instances would each hold their own
window — both acceptable at this size, and both documented in the README. If
the service is ever scaled out, this is the piece to replace.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Decision:
    allowed: bool
    #: Seconds until the current window rolls over — sent as Retry-After.
    retry_after: int


class FixedWindowLimiter:
    """`limit` events per `window_seconds` per key."""

    def __init__(self, window_seconds: int = 3600) -> None:
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._counts: dict[tuple[str, int], int] = {}

    def _bucket(self, now: float) -> int:
        return int(now // self.window_seconds)

    def check(self, key: str, limit: int, now: float | None = None) -> Decision:
        """Count this event and say whether it is allowed."""
        now = time.time() if now is None else now
        bucket = self._bucket(now)
        with self._lock:
            self._evict(bucket)
            count = self._counts.get((key, bucket), 0) + 1
            self._counts[(key, bucket)] = count
        remaining_window = int((bucket + 1) * self.window_seconds - now)
        return Decision(allowed=count <= limit, retry_after=max(remaining_window, 1))

    def _evict(self, current_bucket: int) -> None:
        """Drop closed windows so the dict cannot grow without bound. Called
        under the lock."""
        stale = [k for k in self._counts if k[1] < current_bucket]
        for key in stale:
            del self._counts[key]

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


#: Module-level so every request shares one window.
provisioning_limiter = FixedWindowLimiter()
