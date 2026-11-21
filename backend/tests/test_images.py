"""Bonus: optional image attachments routed only to vision-capable models."""
from dataclasses import replace

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
TEXT_ONLY, VISION = "groq/llama-3.1-8b-instant", "gemini/gemini-2.5-flash"


def client_with(tmp_path, models):
    return TestClient(create_app(replace(make_settings(tmp_path), models=models)))


def post(c, **body):
    return c.post("/chat", json={"session_id": "img", "message": "What is this?", **body})


def test_image_goes_to_vision_model_skipping_text_only_key(tmp_path, fake_llm):
    c = client_with(tmp_path, (TEXT_ONLY, VISION))
    r = post(c, images=[PNG])
    assert r.status_code == 200
    m = r.json()["metadata"]
    assert (m["model"], m["key_id"]) == (VISION, "key_2")
    assert m["fallback_attempts"] == 0          # skipping is not a failure
    sent = fake_llm.calls[-1]["messages"][-1]["content"]
    assert sent[0] == {"type": "text", "text": "What is this?"}
    assert sent[1]["image_url"]["url"] == PNG


def test_text_message_still_uses_key_1(tmp_path, fake_llm):
    c = client_with(tmp_path, (TEXT_ONLY, VISION))
    assert post(c).json()["metadata"]["key_id"] == "key_1"


def test_no_vision_model_returns_422(tmp_path, fake_llm):
    c = client_with(tmp_path, (TEXT_ONLY, TEXT_ONLY))
    r = post(c, images=[PNG])
    assert r.status_code == 422
    assert r.json() == {"detail": "no configured model can read images"}


def test_history_stores_marker_not_image(tmp_path, fake_llm):
    c = client_with(tmp_path, (VISION, VISION))
    post(c, images=[PNG])
    user = c.get("/sessions/img/messages").json()["messages"][0]
    assert user["content"] == "What is this?\n[1 image(s) attached]"
    assert "base64" not in user["content"]


def test_same_text_different_image_is_not_a_cache_hit(tmp_path, fake_llm):
    c = client_with(tmp_path, (VISION, VISION))
    post(c, images=[PNG])
    other = PNG[:-6] + "AAAAAA"
    r = c.post("/chat", json={"session_id": "img2", "message": "What is this?", "images": [other]})
    assert r.json()["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_invalid_images_return_422(tmp_path, fake_llm):
    c = client_with(tmp_path, (VISION, VISION))
    assert post(c, images=["https://example.com/cat.png"]).status_code == 422
    assert post(c, images=[PNG] * 4).status_code == 422
