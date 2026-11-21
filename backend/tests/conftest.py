"""Shared test setup.

No test ever calls a real LLM. We replace litellm.completion with a wrapper that
passes `mock_response` to the REAL litellm.completion, so LiteLLM's real cache
logic still runs; only the network call is faked.
"""
import litellm
import pytest
from fastapi.testclient import TestClient

from app import llm_gateway
from app.config import Settings
from app.main import create_app

REAL_COMPLETION = litellm.completion
MODEL = "gemini/gemini-2.0-flash"


def _text(content):
    if isinstance(content, str):
        return content
    return " ".join(part.get("text", "") for part in content if part.get("type") == "text")


def _count_words(messages):
    return sum(len(_text(m["content"]).split()) for m in messages)


class FakeLLM:
    """Controls what the 'provider' does. Configure per test:
        fake.errors["key-A"] = litellm.RateLimitError(...)   # this key fails
        fake.delay = 0.3                                     # seconds of "network" time
    """

    def __init__(self):
        self.errors: dict[str, Exception] = {}
        self.delay = 0.2
        self.calls: list[dict] = []          # every call that reached the provider

    def __call__(self, **kw):
        if kw["api_key"] in self.errors:
            kw["mock_response"] = self.errors[kw["api_key"]]   # litellm raises it
            return REAL_COMPLETION(**kw)
        msgs = kw["messages"]
        n_images = 0 if isinstance(msgs[-1]["content"], str) else len(msgs[-1]["content"]) - 1
        reply = f"Answer to: {_text(msgs[-1]['content'])}" + (f" (saw {n_images} image)" if n_images else "")
        kw["mock_response"] = litellm.ModelResponse(
            choices=[{"message": {"role": "assistant", "content": reply},
                      "finish_reason": "stop", "index": 0}],
            usage={"prompt_tokens": _count_words(msgs),            # grows with history
                   "completion_tokens": len(reply.split()),
                   "total_tokens": 0},
        )
        kw["mock_delay"] = self.delay
        resp = REAL_COMPLETION(**kw)
        if not resp._hidden_params.get("cache_hit"):
            self.calls.append({"api_key": kw["api_key"], "messages": msgs})
        return resp


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(llm_gateway.litellm, "completion", fake)
    return fake


def make_settings(tmp_path, simulation=True, keys=("key-A", "key-B")):
    return Settings(
        api_keys=list(keys),
        model=MODEL,
        database_url=f"sqlite:///{tmp_path}/test.db",
        allowed_origins=["http://localhost:3000"],
        enable_failure_simulation=simulation,
        default_system_prompt="You are a test assistant.",
    )


@pytest.fixture
def client(tmp_path, fake_llm):
    # fresh DB file and fresh LiteLLM cache for every test -> tests can't affect each other
    return TestClient(create_app(make_settings(tmp_path)))


@pytest.fixture
def chat(client):
    def _chat(session_id, message, headers=None, **extra):
        return client.post("/chat", json={"session_id": session_id, "message": message, **extra},
                           headers=headers or {})
    return _chat
