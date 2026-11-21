"""Multi-turn state, isolation, history endpoint, system prompt, persistence."""
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings


def test_multi_turn_sends_full_history(chat, fake_llm):
    chat("A", "My name is Madhu")
    chat("A", "What is my name?")
    sent = fake_llm.calls[-1]["messages"]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert sent[1]["content"] == "My name is Madhu"
    assert sent[3]["content"] == "What is my name?"


def test_sessions_are_isolated(chat, fake_llm):
    chat("A", "secret from A")
    chat("B", "hello from B")
    sent_b = fake_llm.calls[-1]["messages"]
    assert all("secret from A" not in m["content"] for m in sent_b)
    assert len(sent_b) == 2  # system + B's message only


def test_history_endpoint_oldest_first_without_system_prompt(client, chat):
    chat("H", "first")
    chat("H", "second")
    body = client.get("/sessions/H/messages").json()
    assert body["session_id"] == "H"
    msgs = body["messages"]
    assert [(m["role"], m["content"]) for m in msgs[::2]] == [("user", "first"), ("user", "second")]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert all(m["role"] != "system" for m in msgs)
    meta = msgs[1]["metadata"]
    assert {"resolution_source", "input_tokens", "output_tokens"} <= set(meta)
    assert "metadata" not in msgs[0]  # user messages carry no metadata


def test_system_prompt_used_and_remembered_for_session(chat, fake_llm):
    chat("P", "hi", system_prompt="You are a pirate.")
    assert fake_llm.calls[-1]["messages"][0] == {"role": "system", "content": "You are a pirate."}
    chat("P", "again")  # not resent
    assert fake_llm.calls[-1]["messages"][0]["content"] == "You are a pirate."


def test_default_system_prompt(chat, fake_llm):
    chat("D", "hi")
    assert fake_llm.calls[-1]["messages"][0]["content"] == "You are a test assistant."


def test_history_survives_app_restart(tmp_path, fake_llm):
    c1 = TestClient(create_app(make_settings(tmp_path)))
    c1.post("/chat", json={"session_id": "R", "message": "remember me"})
    c2 = TestClient(create_app(make_settings(tmp_path)))  # new app, same DB file
    assert len(c2.get("/sessions/R/messages").json()["messages"]) == 2


def test_history_sent_to_llm_is_capped(tmp_path, fake_llm):
    from dataclasses import replace
    c = TestClient(create_app(replace(make_settings(tmp_path), max_history_messages=3)))
    for i in range(4):
        c.post("/chat", json={"session_id": "cap", "message": f"m{i}"})
    sent = fake_llm.calls[-1]["messages"]
    # system + window (3 newest, trimmed to start with a user turn = 2) + new message
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert sent[-1]["content"] == "m3"
    # the full history is still stored and returned
    assert len(c.get("/sessions/cap/messages").json()["messages"]) == 8
