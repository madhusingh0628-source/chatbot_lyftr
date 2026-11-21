"""The ONLY module that talks to LiteLLM. API keys never leave this file."""
import logging
import warnings
from dataclasses import dataclass

import litellm
from litellm.caching.caching import Cache

from .config import Settings

litellm.drop_params = True
litellm.suppress_debug_info = True
logging.getLogger("LiteLLM").setLevel(logging.WARNING)
# LiteLLM 1.80 emits noisy (harmless) pydantic serializer warnings on cached responses
warnings.filterwarnings("ignore", message="Pydantic serializer warnings")


def setup_cache() -> None:
    """Turn on LiteLLM's built-in in-memory cache.
    Cache key = hash of model + full messages list (+ call params). The API key is
    NOT part of it, so a response is shared by every key in the pool."""
    litellm.cache = Cache(type="local")


def cache_enabled() -> bool:
    return litellm.cache is not None


log = logging.getLogger("chatbot.gateway")

# Errors that mean "THIS key/provider can't serve right now -> try the next key".
#  429      rate limit / quota exhausted (Gemini RESOURCE_EXHAUSTED arrives as 429)
#  5xx      provider-side failure
#  401/403  bad, revoked or quota-blocked key (another key may still work)
#  408      timeout
FAILOVER_STATUS = {401, 403, 408, 429, 500, 502, 503, 504}


def is_failover_error(exc: Exception) -> bool:
    if isinstance(exc, (litellm.RateLimitError, litellm.APIConnectionError, litellm.Timeout)):
        return True  # connection errors / timeouts have no HTTP status but are transient
    status = getattr(exc, "status_code", None)
    if status in FAILOVER_STATUS:
        return True
    return "quota" in str(exc).lower()


# ---------- failure simulation (X-Simulate-Failure header) ----------
SIMULATABLE = {429, 500, 502, 503}


def parse_simulation_header(value: str | None) -> dict[str, int]:
    """'key_1=429,key_2=500' -> {'key_1': 429, 'key_2': 500};  '*=429' -> {'*': 429}.
    Malformed or unsupported pairs are ignored."""
    result: dict[str, int] = {}
    for part in (value or "").split(","):
        key_id, sep, status = part.strip().partition("=")
        if not sep or not status.strip().isdigit():
            continue
        code = int(status.strip())
        if code in SIMULATABLE and key_id.strip():
            result[key_id.strip()] = code
    return result


def _simulated_error(status: int, model: str) -> Exception:
    """The same exception types LiteLLM raises for a real provider error with that status."""
    msg = f"simulated {status}"
    if status == 429:
        return litellm.RateLimitError(msg, "simulated", model)
    if status == 502:
        return litellm.BadGatewayError(msg, "simulated", model)
    if status == 503:
        return litellm.ServiceUnavailableError(msg, "simulated", model)
    return litellm.InternalServerError(msg, "simulated", model)


class EmptyReply(Exception):
    """Provider answered 200 but with no text; treated as a failed key."""


class NoVisionModel(Exception):
    """The request has images but no configured model can read images -> HTTP 422."""


def supports_vision(model: str) -> bool:
    try:
        return bool(litellm.supports_vision(model=model))
    except Exception:
        return False


class AllProvidersUnavailable(Exception):
    """Raised when no key could produce an answer -> HTTP 503."""


@dataclass
class GatewayResult:
    reply: str
    model: str
    input_tokens: int
    output_tokens: int
    key_id: str | None
    fallback_attempts: int
    resolution_source: str  # "LIVE_INFERENCE" or "LLM_CACHE"


def _call_llm(model: str, api_key: str, messages: list[dict], use_cache: bool = True,
              timeout: float = 30.0):
    return litellm.completion(
        model=model,
        messages=messages,
        api_key=api_key,
        num_retries=0,   # WE decide when to switch keys, not LiteLLM
        timeout=timeout,
        caching=True,    # store successful responses
        # no-cache=True skips the cache READ (used by failure simulation in Phase 7)
        cache={"no-cache": not use_cache},
    )


def _to_result(model: str, resp, key_id: str | None, attempts: int) -> GatewayResult:
    choices = getattr(resp, "choices", None) or []
    reply = ((choices[0].message.content if choices else "") or "").strip()
    if not reply:
        raise EmptyReply()
    hidden = getattr(resp, "_hidden_params", None) or {}
    cache_hit = bool(hidden.get("cache_hit"))
    usage = getattr(resp, "usage", None)  # some providers omit usage -> report 0, don't crash
    return GatewayResult(
        reply=reply,
        model=model,  # the LiteLLM model name that produced this reply
        # usage from the provider for THIS call (or the usage stored with a cached response)
        input_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
        output_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
        key_id=None if cache_hit else key_id,
        fallback_attempts=0 if cache_hit else attempts,
        resolution_source="LLM_CACHE" if cache_hit else "LIVE_INFERENCE",
    )


def generate(settings: Settings, messages: list[dict],
             simulate: dict[str, int] | None = None, has_images: bool = False) -> GatewayResult:
    """Try key_1, key_2, ... in order. Return the first success.
    A cache hit is detected inside the first call, before any provider is contacted.
    `simulate` ({key_id or '*': status}) makes chosen keys fail for this request only."""
    simulate = simulate or {}
    attempts = 0       # keys that failed before one succeeded
    # while simulating, skip cache READS so the request really goes through the key pool
    # (otherwise '*=429' on an already-cached question would wrongly return 200)
    use_cache = not simulate
    pool = list(enumerate(zip(settings.key_ids, settings.api_keys)))
    if has_images:
        # only keys whose model can read images; text-only keys are skipped, not "failed"
        pool = [p for p in pool if supports_vision(settings.model_for(p[0]))]
        if not pool and settings.api_keys:
            raise NoVisionModel()
    for index, (key_id, api_key) in pool:
        model = settings.model_for(index)
        try:
            forced = simulate.get(key_id, simulate.get("*"))
            if forced:
                raise _simulated_error(forced, model)  # handled exactly like a real error
            resp = _call_llm(model, api_key, messages, use_cache=use_cache,
                             timeout=settings.llm_timeout)
            return _to_result(model, resp, key_id, attempts)
        except EmptyReply:
            # LiteLLM already cached this empty answer; skip the cache read on the next
            # key so its (good) answer is fetched live and overwrites the bad entry
            use_cache = False
            log.warning("%s returned an empty reply, trying next key", key_id)
        except Exception as exc:
            # log class + status only: provider messages can contain request URLs with the key
            status = getattr(exc, "status_code", None)
            if not is_failover_error(exc):
                log.error("%s failed with non-retryable %s (status=%s)", key_id, type(exc).__name__, status)
                raise AllProvidersUnavailable() from None
            log.warning("%s failed with %s (status=%s), trying next key", key_id, type(exc).__name__, status)
        attempts += 1
    if not settings.api_keys:
        log.error("no API keys configured (set LLM_API_KEYS)")
    else:
        log.error("all %d usable keys failed", len(pool))
    raise AllProvidersUnavailable()
