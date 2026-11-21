"""Health, successful chat, contract shape, validation (422), 404 and CORS."""
import pytest

META_FIELDS = {"resolution_source", "model", "latency_ms", "input_tokens",
               "output_tokens", "key_id", "fallback_attempts"}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "keys_configured": 2, "cache_enabled": True,
                        "database_ok": True, "failure_simulation": True}


def test_chat_success_matches_contract(chat):
    r = chat("s-7f3a", "What is the capital of France?")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "s-7f3a"
    assert body["reply"]
    assert set(body["metadata"]) == META_FIELDS
    m = body["metadata"]
    assert m["resolution_source"] == "LIVE_INFERENCE"
    assert m["model"] == "gemini/gemini-2.0-flash"
    assert isinstance(m["latency_ms"], int) and m["latency_ms"] >= 0
    assert m["key_id"] == "key_1"
    assert m["fallback_attempts"] == 0


def test_response_never_contains_api_key(chat):
    text = chat("s", "hello").text
    assert "key-A" not in text and "key-B" not in text


@pytest.mark.parametrize("body", [
    {"message": "hi"},                                  # missing session_id
    {"session_id": "", "message": "hi"},               # empty session_id
    {"session_id": "x" * 129, "message": "hi"},        # session_id too long
    {"session_id": "s"},                               # missing message
    {"session_id": "s", "message": ""},                # empty message
    {"session_id": "s", "message": "   \n  "},         # whitespace only
    {"session_id": "s", "message": "x" * 4001},        # over 4000
    {"session_id": 123, "message": "hi"},              # wrong type
])
def test_invalid_input_returns_422(client, body):
    r = client.post("/chat", json=body)
    assert r.status_code == 422
    assert "detail" in r.json()


def test_malformed_json_returns_422(client):
    r = client.post("/chat", content=b"{not json", headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_message_of_exactly_4000_chars_is_accepted(chat):
    assert chat("s", "x" * 4000).status_code == 200


def test_message_is_trimmed_before_length_check(chat):
    assert chat("s", "  " + "x" * 4000 + "  ").status_code == 200


def test_invalid_request_is_not_stored(client, chat):
    chat("s-bad", "")
    assert client.get("/sessions/s-bad/messages").status_code == 404


def test_unknown_session_returns_404(client):
    r = client.get("/sessions/does-not-exist/messages")
    assert r.status_code == 404
    assert r.json() == {"detail": "session not found"}


def test_unknown_route_is_json_not_html(client):
    r = client.get("/nope")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


def test_cors_preflight_allows_frontend_and_simulation_header(client):
    r = client.options("/chat", headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-simulate-failure",
    })
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_cors_rejects_unknown_origin(client):
    r = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_delete_session(client, chat):
    chat("del-me", "hello")
    assert client.delete("/sessions/del-me").status_code == 204
    assert client.get("/sessions/del-me/messages").status_code == 404
    assert client.delete("/sessions/del-me").status_code == 404


def test_history_includes_saved_system_prompt_and_timestamps(client, chat):
    chat("sp", "hi", system_prompt="Be brief.")
    body = client.get("/sessions/sp/messages").json()
    assert body["system_prompt"] == "Be brief."
    assert all(m["created_at"] for m in body["messages"])


def test_system_prompt_too_long_is_422(chat):
    assert chat("s", "hi", system_prompt="x" * 4001).status_code == 422


def test_svg_image_is_rejected(chat):
    assert chat("s", "hi", images=["data:image/svg+xml;base64,PHN2Zz4="]).status_code == 422
