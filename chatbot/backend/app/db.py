"""SQLite storage. Plain sqlite3, no ORM."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    metadata    TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

CREATE TABLE IF NOT EXISTS session_settings (
    session_id     TEXT PRIMARY KEY,
    system_prompt  TEXT NOT NULL
);
"""


@contextmanager
def _connect(db_path: str) -> Iterator[sqlite3.Connection]:
    """Open a connection, commit on success / roll back on error, and ALWAYS close it.
    (`with sqlite3.connect(...)` alone only manages the transaction and leaks the
    connection, which keeps the file locked on Windows.)"""
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db(db_path: str) -> None:
    """Create the folder and tables if missing (runs on every startup)."""
    folder = os.path.dirname(db_path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with _connect(db_path) as conn:
        conn.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
        conn.executescript(SCHEMA)


def check_db(db_path: str) -> bool:
    try:
        with _connect(db_path) as conn:
            conn.execute("SELECT 1 FROM messages LIMIT 1")
        return True
    except sqlite3.Error:
        return False


def _row_to_message(r: sqlite3.Row) -> dict:
    item = {"role": r["role"], "content": r["content"], "created_at": r["created_at"]}
    if r["metadata"]:
        try:
            item["metadata"] = json.loads(r["metadata"])
        except ValueError:
            pass  # a corrupt row must not break the whole history
    return item


def get_history(db_path: str, session_id: str, limit: int = 0) -> list[dict]:
    """Messages of one session, oldest first. `limit` > 0 keeps only the newest N."""
    with _connect(db_path) as conn:
        if limit > 0:
            rows = conn.execute(
                "SELECT * FROM (SELECT role, content, metadata, created_at, id FROM messages "
                "WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id",
                (session_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT role, content, metadata, created_at FROM messages "
                "WHERE session_id = ? ORDER BY id",
                (session_id,),
            ).fetchall()
    return [_row_to_message(r) for r in rows]


def get_system_prompt(db_path: str, session_id: str) -> str | None:
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT system_prompt FROM session_settings WHERE session_id = ?", (session_id,)
        ).fetchone()
    return row["system_prompt"] if row else None


def delete_session(db_path: str, session_id: str) -> bool:
    """Remove every message and the saved prompt of a session. True if anything existed."""
    with _connect(db_path) as conn:
        n = conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,)).rowcount
        n += conn.execute("DELETE FROM session_settings WHERE session_id = ?", (session_id,)).rowcount
    return n > 0


def save_exchange(db_path: str, session_id: str, user_text: str,
                  assistant_text: str, metadata: dict,
                  system_prompt: str | None = None) -> None:
    """Save the user message and the assistant reply together (one transaction),
    so a half-saved turn can never exist."""
    now = datetime.now(timezone.utc).isoformat()
    with _connect(db_path) as conn:
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
