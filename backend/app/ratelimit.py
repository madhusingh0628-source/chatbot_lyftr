"""Small in-memory sliding-window rate limiter for POST /chat.

Protects the LLM key quota on a public deployment. In memory on purpose: the app
runs as ONE worker (the LiteLLM cache needs that too), so no Redis is required.
"""
import threading
import time
from collections import deque


class RateLimiter:
    def __init__(self, per_client: int, global_limit: int, window: float = 60.0):
        self.per_client = per_client
        self.global_limit = global_limit
        self.window = window
        self._hits: dict[str, deque] = {}
        self._all: deque = deque()
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    @property
    def enabled(self) -> bool:
        return self.per_client > 0 or self.global_limit > 0

    def _trim(self, q: deque, now: float) -> None:
        while q and now - q[0] >= self.window:
            q.popleft()

    def check(self, client: str) -> float | None:
        """Record one request. Returns None if allowed, else seconds to wait."""
        if not self.enabled:
            return None
        now = time.monotonic()
        with self._lock:
            if now - self._last_sweep > self.window:   # forget idle clients
                for key in [k for k, q in self._hits.items() if not q or now - q[-1] >= self.window]:
                    del self._hits[key]
                self._last_sweep = now
            mine = self._hits.setdefault(client, deque())
            self._trim(mine, now)
            self._trim(self._all, now)
            if self.global_limit and len(self._all) >= self.global_limit:
                return max(1.0, self.window - (now - self._all[0]))
            if self.per_client and len(mine) >= self.per_client:
                return max(1.0, self.window - (now - mine[0]))
            mine.append(now)
            self._all.append(now)
            return None


def client_key(request) -> str:
    """Best-effort client id. Behind Vercel/Render the socket peer is the proxy, so use the
    first X-Forwarded-For hop. A client can fake that header, which is why there is also a
    global limit that no header can get around."""
    fwd = request.headers.get("x-forwarded-for", "")
    first = fwd.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"
