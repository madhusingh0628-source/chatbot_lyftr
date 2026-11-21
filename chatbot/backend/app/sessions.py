"""Session Manager: turns an incoming chat request into a full message list,
calls the gateway, and stores the result."""
import threading
import time
from collections import defaultdict

from . import db
from .config import Settings
from .llm_gateway import generate
from .schemas import ChatRequest


# One lock per session: two requests for the SAME session (double click, two tabs)
# run one after the other, so the second one sees the first one's turn in its history
# instead of both answering from the same stale history.
_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def _session_lock(session_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks[session_id]


def handle_chat(settings: Settings, req: ChatRequest,
                simulate: dict[str, int] | None = None) -> dict:
    with _session_lock(req.session_id):
        return _handle_chat(settings, req, simulate)


def _handle_chat(settings: Settings, req: ChatRequest,
                 simulate: dict[str, int] | None = None) -> dict:
    started = time.perf_counter()

    # prompt priority: this request > saved for this session > server default
    system_prompt = (
        req.system_prompt
        or db.get_system_prompt(settings.db_path, req.session_id)
        or settings.default_system_prompt
    )
    # only the newest N messages go to the LLM so long chats don't overflow its context
    history = db.get_history(settings.db_path, req.session_id, limit=settings.max_history_messages)
    if history and history[0]["role"] == "assistant":
        history = history[1:]  # the window must start with a user turn

    # full list the LLM sees: system prompt + all past turns + the new message
    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": m["role"], "content": m["content"]} for m in history]
    if req.images:
        # OpenAI-style multimodal content; LiteLLM translates it for each provider.
        # The images are part of `messages`, so they are part of the cache key too.
        content = [{"type": "text", "text": req.message}]
        content += [{"type": "image_url", "image_url": {"url": img}} for img in req.images]
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": req.message})

    result = generate(settings, messages, simulate, has_images=bool(req.images))   # raises AllProvidersUnavailable -> nothing saved

    latency_ms = int((time.perf_counter() - started) * 1000)
    metadata = {
        "resolution_source": result.resolution_source,
        "model": result.model,
        "latency_ms": latency_ms,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "key_id": result.key_id,
        "fallback_attempts": result.fallback_attempts,
    }
    # images are not stored (keeps SQLite small); history keeps a text marker instead
    stored_user_text = req.message
    if req.images:
        stored_user_text += f"\n[{len(req.images)} image(s) attached]"
    db.save_exchange(settings.db_path, req.session_id, stored_user_text, result.reply,
                     metadata, system_prompt=req.system_prompt)
    return {"session_id": req.session_id, "reply": result.reply, "metadata": metadata}
