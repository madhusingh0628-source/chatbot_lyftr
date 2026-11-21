"""Rate limiting, CORS origin regex, storage failures."""
from dataclasses import replace

from fastapi.testclient import TestClient

from app import db
from app.main import create_app
from app.ratelimit import RateLimiter
from tests.conftest import make_settings


def _client(tmp_path, **overrides):
    return TestClient(create_app(replace(make_settings(tmp_path), **overrides)))


def test_rate_limit_per_client(tmp_path, fake_llm):
    c = _client(tmp_path, rate_limit_per_minute=2)
    ok = {"session_id": "r", "message": "hi"}
    assert c.post("/chat", json=ok, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert c.post("/chat", json=ok, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    r = c.post("/chat", json=ok, headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.1"})
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1
    assert "detail" in r.json()
    # another client is unaffected
    assert c.post("/chat", json=ok, headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 200


def test_global_rate_limit_cannot_be_dodged_with_fake_ips(tmp_path, fake_llm):
    c = _client(tmp_path, rate_limit_global_per_minute=2)
    for i in range(2):
        assert c.post("/chat", json={"session_id": "g", "message": f"m{i}"},
                      headers={"X-Forwarded-For": f"9.9.9.{i}"}).status_code == 200
    assert c.post("/chat", json={"session_id": "g", "message": "m3"},
                  headers={"X-Forwarded-For": "9.9.9.99"}).status_code == 429


def test_rate_limit_off_by_default(chat):
    for i in range(5):
        assert chat("free", f"m{i}").status_code == 200


def test_window_expires(monkeypatch):
    clock = [1000.0]   # fake clock: real sleeps are too coarse on Windows and made this flaky
    monkeypatch.setattr("app.ratelimit.time.monotonic", lambda: clock[0])
    rl = RateLimiter(per_client=1, global_limit=0, window=60)
    assert rl.check("a") is None
    clock[0] += 30
    assert 29 <= rl.check("a") <= 31      # blocked, ~30 s left
    clock[0] += 31
    assert rl.check("a") is None          # window passed


def test_cors_origin_regex(tmp_path, fake_llm):
    c = _client(tmp_path, allowed_origin_regex=r"https://chatbot-lyftr(-[a-z0-9-]+)?\.vercel\.app")
    ok = c.get("/health", headers={"Origin": "https://chatbot-lyftr-git-main-abc.vercel.app"})
    assert ok.headers["access-control-allow-origin"] == "https://chatbot-lyftr-git-main-abc.vercel.app"
    bad = c.get("/health", headers={"Origin": "https://evil-chatbot-lyftr.vercel.app.evil.com"})
    assert "access-control-allow-origin" not in bad.headers


def test_database_failure_is_json_503(client, monkeypatch):
    def boom(*a, **k):
        raise db.DatabaseError("OperationalError")
    monkeypatch.setattr(db, "get_history", boom)
    r = client.get("/sessions/x/messages")
    assert r.status_code == 503
    assert r.json() == {"detail": "database unavailable"}
