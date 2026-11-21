"""LiteLLM cache: miss, hit, identical reply, faster, key correctness, tokens on hit."""


def test_first_request_is_cache_miss(chat):
    m = chat("s1", "What is the capital of France?").json()["metadata"]
    assert m["resolution_source"] == "LIVE_INFERENCE"


def test_same_first_message_in_new_session_is_cache_hit(chat, fake_llm):
    chat("s1", "What is the capital of France?")
    r = chat("s2", "What is the capital of France?")
    m = r.json()["metadata"]
    assert m["resolution_source"] == "LLM_CACHE"
    assert m["key_id"] is None
    assert m["fallback_attempts"] == 0
    assert len(fake_llm.calls) == 1  # provider was called only once


def test_cache_hit_returns_identical_reply_and_tokens(chat):
    a = chat("s1", "What is the capital of France?").json()
    b = chat("s2", "What is the capital of France?").json()
    assert b["reply"] == a["reply"]
    assert b["metadata"]["input_tokens"] == a["metadata"]["input_tokens"]
    assert b["metadata"]["output_tokens"] == a["metadata"]["output_tokens"]


def test_cache_hit_is_faster_than_live(chat, fake_llm):
    fake_llm.delay = 0.5
    live = chat("s1", "What is the capital of France?").json()["metadata"]["latency_ms"]
    hit = chat("s2", "What is the capital of France?").json()["metadata"]["latency_ms"]
    assert hit < live


def test_different_message_is_never_served_from_cache(chat):
    a = chat("s1", "What is the capital of France?").json()
    b = chat("s2", "What is the capital of Spain?").json()
    assert b["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert b["reply"] != a["reply"]


def test_same_message_with_different_history_is_a_miss(chat):
    chat("s1", "hello")
    chat("s1", "What is the capital of France?")
    chat("s2", "What is the capital of France?")   # caches the no-history version
    m = chat("s1", "hello").json()["metadata"]     # s1 has history now -> different list
    assert m["resolution_source"] == "LIVE_INFERENCE"


def test_different_system_prompt_is_a_miss(chat):
    chat("s1", "hi", system_prompt="Be formal.")
    m = chat("s2", "hi", system_prompt="Be casual.").json()["metadata"]
    assert m["resolution_source"] == "LIVE_INFERENCE"


def test_cache_hit_is_stored_in_history(client, chat):
    chat("s1", "hello")
    chat("s2", "hello")
    meta = client.get("/sessions/s2/messages").json()["messages"][1]["metadata"]
    assert meta["resolution_source"] == "LLM_CACHE"
