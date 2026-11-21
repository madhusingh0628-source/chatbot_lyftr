"""Per-request token usage (never a running total)."""


def test_tokens_present_and_integers(chat):
    m = chat("s", "What is the capital of France?").json()["metadata"]
    assert isinstance(m["input_tokens"], int) and m["input_tokens"] > 0
    assert isinstance(m["output_tokens"], int) and m["output_tokens"] > 0


def test_tokens_come_from_provider_usage(chat, fake_llm):
    m = chat("s", "one two three").json()["metadata"]
    # fake provider: prompt_tokens = words in all messages sent (system prompt + user)
    system_words = len("You are a test assistant.".split())
    assert m["input_tokens"] == system_words + 3
    assert m["output_tokens"] == len("Answer to: one two three".split())


def test_input_tokens_include_history_but_are_not_a_running_total(chat, fake_llm):
    t1 = chat("s", "one two three").json()["metadata"]
    t2 = chat("s", "four five").json()["metadata"]
    sent = fake_llm.calls[-1]["messages"]
    expected = sum(len(m["content"].split()) for m in sent)
    assert t2["input_tokens"] == expected               # system + history + new message
    assert t2["input_tokens"] != t1["input_tokens"] + expected   # not cumulative
    assert t2["output_tokens"] == len("Answer to: four five".split())


def test_equal_length_first_messages_in_new_sessions_have_same_input_tokens(chat):
    a = chat("s1", "alpha beta gamma").json()["metadata"]["input_tokens"]
    b = chat("s2", "delta epsilon zeta").json()["metadata"]["input_tokens"]
    assert a == b
