"""Chat storage: SQLite (local dev, tests, Docker volume) or PostgreSQL (hosted).

Every function takes a `target`: a SQLite file path, or a postgres:// URL.
Use Postgres on hosts with an ephemeral disk (Render free tier): there a SQLite
file is wiped on every redeploy/restart and all chat history disappears.
SQL is written once with `?` placeholders and translated for Postgres.
"""
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

_SQLITE_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        metadata    TEXT,
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)",
    """CREATE TABLE IF NOT EXISTS session_settings (
        session_id     TEXT PRIMARY KEY,
        system_prompt  TEXT NOT NULL
    )""",
]
_PG_SCHEMA = [s.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY") for s in _SQLITE_SCHEMA]


def is_postgres(target: str) -> bool:
    return target.startswith(("postgres://", "postgresql://"))


class DatabaseError(Exception):
    """Any storage failure, whichever engine is underneath."""


# ---------- PostgreSQL: one small connection pool per URL ----------
_pools: dict[str, Any] = {}
_pools_lock = threading.Lock()


def _pg_pool(url: str):
    with _pools_lock:
        pool = _pools.get(url)
        if pool is None:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool
            pool = ConnectionPool(
                url,
                min_size=1,
                max_size=5,
                max_idle=240,      # hosted Postgres (Neon etc.) drops idle connections
                timeout=15,
                kwargs={"row_factory": dict_row, "connect_timeout": 10},
                check=ConnectionPool.check_connection,   # reconnect if the server closed it
                open=True,
            )
            _pools[url] = pool
        return pool


class _Conn:
    """Tiny common surface over sqlite3 / psycopg connections."""

    def __init__(self, raw, pg: bool):
        self.raw = raw
        self.pg = pg

    def execute(self, sql: str, params: tuple = ()):
        if self.pg:
            sql = sql.replace("?", "%s")
        return self.raw.execute(sql, params)


@contextmanager
def _connect(target: str) -> Iterator[_Conn]:
    """Commit on success, roll back on error, always release the connection."""
    if is_postgres(target):
        try:
            with _pg_pool(target).connection() as raw:   # commits / rolls back for us
                yield _Conn(raw, pg=True)
        except DatabaseError:
            raise
        except Exception as exc:   # psycopg.Error, pool timeout, ...
            if type(exc).__module__.startswith(("psycopg", "psycopg_pool")):
                raise DatabaseError(type(exc).__name__) from exc
            raise
        return
    conn = sqlite3.connect(target, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield _Conn(conn, pg=False)
    except sqlite3.Error as exc:
        raise DatabaseError(type(exc).__name__) from exc
    finally:
        conn.close()


def init_db(target: str) -> None:
    """Create the folder (SQLite) and tables if missing. Runs on every startup."""
    if is_postgres(target):
        with _connect(target) as conn:
            for stmt in _PG_SCHEMA:
                conn.execute(stmt)
        return
    folder = os.path.dirname(target)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with _connect(target) as conn:
        conn.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
        for stmt in _SQLITE_SCHEMA:
            conn.execute(stmt)


def check_db(target: str) -> bool:
    try:
        with _connect(target) as conn:
            conn.execute("SELECT 1 FROM messages LIMIT 1")
        return True
    except DatabaseError:
        return False


def _row_to_message(r) -> dict:
    item = {"role": r["role"], "content": r["content"], "created_at": r["created_at"]}
    if r["metadata"]:
        try:
            item["metadata"] = json.loads(r["metadata"])
        except ValueError:
            pass  # a corrupt row must not break the whole history
    return item


def get_history(target: str, session_id: str, limit: int = 0) -> list[dict]:
    """Messages of one session, oldest first. `limit` > 0 keeps only the newest N."""
    with _connect(target) as conn:
        if limit > 0:
            rows = conn.execute(
                "SELECT * FROM (SELECT role, content, metadata, created_at, id FROM messages "
                "WHERE session_id = ? ORDER BY id DESC LIMIT ?) AS recent ORDER BY id",
                (session_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT role, content, metadata, created_at FROM messages "
                "WHERE session_id = ? ORDER BY id",
                (session_id,),
            ).fetchall()
    return [_row_to_message(r) for r in rows]


def get_system_prompt(target: str, session_id: str) -> str | None:
    with _connect(target) as conn:
        row = conn.execute(
            "SELECT system_prompt FROM session_settings WHERE session_id = ?", (session_id,)
        ).fetchone()
    return row["system_prompt"] if row else None


def delete_session(target: str, session_id: str) -> bool:
    """Remove every message and the saved prompt of a session. True if anything existed."""
    with _connect(target) as conn:
        n = conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,)).rowcount
        n += conn.execute("DELETE FROM session_settings WHERE session_id = ?", (session_id,)).rowcount
    return n > 0


def save_exchange(target: str, session_id: str, user_text: str,
                  assistant_text: str, metadata: dict,
                  system_prompt: str | None = None) -> None:
    """Save the user message and the assistant reply together (one transaction),
    so a half-saved turn can never exist."""
    now = datetime.now(timezone.utc).isoformat()
    with _connect(target) as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?,?,?,?,?)",
            (session_id, "user", user_text, None, now),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?,?,?,?,?)",
            (session_id, "assistant", assistant_text, json.dumps(metadata), now),
        )
        if system_prompt:  # remember the prompt for the rest of this session
            conn.execute(
                "INSERT INTO session_settings (session_id, system_prompt) VALUES (?, ?) "
                "ON CONFLICT(session_id) DO UPDATE SET system_prompt = excluded.system_prompt",
                (session_id, system_prompt),
            )
