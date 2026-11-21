"""The same storage behaviour against a real PostgreSQL server.

Skipped unless TEST_DATABASE_URL points at a disposable Postgres database, e.g.
    TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/chatbot_test python -m pytest tests/test_postgres.py
"""
import os
import uuid
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import create_app
from tests.conftest import make_settings

PG_URL = os.getenv("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not PG_URL.startswith(("postgres://", "postgresql://")),
                                reason="TEST_DATABASE_URL not set")


@pytest.fixture
def pg_client(tmp_path, fake_llm):
    return TestClient(create_app(replace(make_settings(tmp_path), database_url=PG_URL)))


def sid():
    return f"pg-{uuid.uuid4()}"


def test_health_reports_database_ok(pg_client):
    assert pg_client.get("/health").json()["database_ok"] is True


def test_multi_turn_history_and_prompt(pg_client, fake_llm):
    s = sid()
    pg_client.post("/chat", json={"session_id": s, "message": "My name is Madhu", "system_prompt": "Be a pirate."})
    pg_client.post("/chat", json={"session_id": s, "message": "What is my name?"})
    sent = fake_llm.calls[-1]["messages"]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert sent[0]["content"] == "Be a pirate."
    body = pg_client.get(f"/sessions/{s}/messages").json()
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user", "assistant"]
    assert body["messages"][1]["metadata"]["resolution_source"] in ("LIVE_INFERENCE", "LLM_CACHE")
    assert body["system_prompt"] == "Be a pirate."


def test_prompt_upsert_and_history_window(tmp_path, fake_llm):
    c = TestClient(create_app(replace(make_settings(tmp_path), database_url=PG_URL, max_history_messages=3)))
    s = sid()
    c.post("/chat", json={"session_id": s, "message": "m0", "system_prompt": "one"})
    c.post("/chat", json={"session_id": s, "message": "m1", "system_prompt": "two"})
    for i in range(2, 4):
        c.post("/chat", json={"session_id": s, "message": f"m{i}"})
    assert c.get(f"/sessions/{s}/messages").json()["system_prompt"] == "two"
    assert [m["role"] for m in fake_llm.calls[-1]["messages"]] == ["system", "user", "assistant", "user"]


def test_delete_and_404(pg_client):
    s = sid()
    pg_client.post("/chat", json={"session_id": s, "message": "hello"})
    assert pg_client.delete(f"/sessions/{s}").status_code == 204
    assert pg_client.get(f"/sessions/{s}/messages").status_code == 404
    assert pg_client.delete(f"/sessions/{s}").status_code == 404


def test_history_survives_app_restart(tmp_path, fake_llm):
    s = sid()
    settings = replace(make_settings(tmp_path), database_url=PG_URL)
    TestClient(create_app(settings)).post("/chat", json={"session_id": s, "message": "remember me"})
    assert len(TestClient(create_app(settings)).get(f"/sessions/{s}/messages").json()["messages"]) == 2


def test_failed_turn_stores_nothing(pg_client):
    s = sid()
    r = pg_client.post("/chat", json={"session_id": s, "message": "hi"}, headers={"X-Simulate-Failure": "*=429"})
    assert r.status_code == 503
    assert pg_client.get(f"/sessions/{s}/messages").status_code == 404


def test_check_db_false_when_server_unreachable():
    assert db.check_db("postgresql://nobody:x@127.0.0.1:1/none?connect_timeout=2") is False
