"""Key pool failover, 503, X-Simulate-Failure, nothing stored on failure."""
import litellm
import pytest
from fastapi.testclient import TestClient

from app.llm_gateway import parse_simulation_header
from app.main import create_app
from tests.conftest import make_settings


def rate_limit():
    return litellm.RateLimitError("quota exceeded", "gemini", "m")


def server_error():
    return litellm.InternalServerError("boom", "gemini", "m")


# ---------- real provider errors ----------

@pytest.mark.parametrize("error", [
    rate_limit,
    server_error,
    lambda: litellm.ServiceUnavailableError("down", "gemini", "m"),
    lambda: litellm.BadGatewayError("bad gw", "gemini", "m"),
    lambda: litellm.AuthenticationError("bad key", "gemini", "m"),
])
def test_key_1_failure_falls_back_to_key_2(chat, fake_llm, error):
    fake_llm.errors["key-A"] = error()
    r = chat("s", "hello")
    assert r.status_code == 200
    m = r.json()["metadata"]
    assert m["key_id"] == "key_2"
    assert m["fallback_attempts"] == 1
    assert m["resolution_source"] == "LIVE_INFERENCE"


def test_all_keys_fail_returns_503(chat, fake_llm):
    fake_llm.errors["key-A"] = rate_limit()
    fake_llm.errors["key-B"] = server_error()
    r = chat("s", "hello")
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}


def test_failed_request_is_not_stored(client, chat, fake_llm):
    chat("s", "first ok")
    fake_llm.errors["key-A"] = rate_limit()
    fake_llm.errors["key-B"] = rate_limit()
    chat("s", "this fails")
    msgs = client.get("/sessions/s/messages").json()["messages"]
    assert [m["content"] for m in msgs if m["role"] == "user"] == ["first ok"]


def test_fallback_attempts_counts_failed_keys(tmp_path, fake_llm):
    c = TestClient(create_app(make_settings(tmp_path, keys=("key-A", "key-B", "key-C"))))
    fake_llm.errors["key-A"] = rate_limit()
    fake_llm.errors["key-B"] = server_error()
    m = c.post("/chat", json={"session_id": "s", "message": "hi"}).json()["metadata"]
    assert (m["key_id"], m["fallback_attempts"]) == ("key_3", 2)


def test_non_retryable_error_does_not_try_other_keys(chat, fake_llm):
    fake_llm.errors["key-A"] = litellm.BadRequestError("bad", "gemini/x", "gemini")
    assert chat("s", "hi").status_code == 503
    assert fake_llm.calls == []  # key_2 never called


def test_no_keys_configured(tmp_path, fake_llm):
    c = TestClient(create_app(make_settings(tmp_path, keys=())))
    assert c.get("/health").json()["keys_configured"] == 0
    assert c.post("/chat", json={"session_id": "s", "message": "hi"}).status_code == 503


# ---------- X-Simulate-Failure ----------

SIM = "X-Simulate-Failure"


def test_simulated_429_on_key_1(chat, fake_llm):
    r = chat("s", "hello", headers={SIM: "key_1=429"})
    assert r.status_code == 200
    assert r.json()["metadata"]["key_id"] == "key_2"
    assert r.json()["metadata"]["fallback_attempts"] == 1
    assert [c["api_key"] for c in fake_llm.calls] == ["key-B"]


def test_simulated_500_on_key_1(chat):
    r = chat("s", "hello", headers={SIM: "key_1=500"})
    assert r.status_code == 200
    assert r.json()["metadata"]["key_id"] == "key_2"


def test_simulated_all_keys_429_returns_503_and_stores_nothing(client, chat, fake_llm):
    r = chat("s", "hello", headers={SIM: "*=429"})
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}
    assert client.get("/sessions/s/messages").status_code == 404
    assert fake_llm.calls == []


def test_simulated_both_keys_listed(chat):
    r = chat("s", "hello", headers={SIM: "key_1=429,key_2=500"})
    assert r.status_code == 503


def test_simulation_is_not_masked_by_cache(chat):
    chat("warm", "What is the capital of France?")             # now cached
    r = chat("s", "What is the capital of France?", headers={SIM: "*=429"})
    assert r.status_code == 503
    r = chat("s2", "What is the capital of France?", headers={SIM: "key_1=429"})
    assert r.json()["metadata"]["key_id"] == "key_2"


def test_simulation_applies_to_that_request_only(chat):
    chat("s", "hello", headers={SIM: "*=429"})
    r = chat("s", "hello")
    assert r.status_code == 200
    assert r.json()["metadata"]["key_id"] == "key_1"


def test_simulation_ignored_when_disabled(tmp_path, fake_llm):
    c = TestClient(create_app(make_settings(tmp_path, simulation=False)))
    r = c.post("/chat", json={"session_id": "s", "message": "hi"}, headers={SIM: "*=429"})
    assert r.status_code == 200
    assert r.json()["metadata"]["key_id"] == "key_1"


def test_parse_simulation_header():
    assert parse_simulation_header("key_1=429") == {"key_1": 429}
    assert parse_simulation_header("key_1=429,key_2=500") == {"key_1": 429, "key_2": 500}
    assert parse_simulation_header("*=429") == {"*": 429}
    assert parse_simulation_header("garbage,key_1=418,key_2=abc") == {}
    assert parse_simulation_header(None) == {}


# ---------- one model per key (LLM_MODELS) ----------

def test_per_key_models_report_the_model_that_answered(tmp_path, fake_llm):
    from dataclasses import replace
    s = replace(make_settings(tmp_path), models=("groq/llama-3.1-8b-instant", "gemini/gemini-2.5-flash"))
    c = TestClient(create_app(s))
    m = c.post("/chat", json={"session_id": "a", "message": "hi"}).json()["metadata"]
    assert (m["model"], m["key_id"]) == ("groq/llama-3.1-8b-instant", "key_1")
    m = c.post("/chat", json={"session_id": "b", "message": "yo"}, headers={SIM: "key_1=429"}).json()["metadata"]
    assert (m["model"], m["key_id"]) == ("gemini/gemini-2.5-flash", "key_2")


def test_single_model_applies_to_all_keys(tmp_path, fake_llm):
    s = make_settings(tmp_path)
    assert s.model_for(0) == s.model_for(1) == "gemini/gemini-2.0-flash"
