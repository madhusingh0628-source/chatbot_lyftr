"""All configuration comes from environment variables, read in one place."""
import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
    for p in Path(__file__).resolve().parents:
        env_file = p / ".env"
        if env_file.is_file():
            load_dotenv(env_file)
except ImportError:
    pass


def _split(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    api_keys: list[str]
    model: str                      # default model (LLM_MODEL)
    database_url: str
    allowed_origins: list[str]
    enable_failure_simulation: bool
    default_system_prompt: str
    models: tuple[str, ...] = ()    # optional per-key models (LLM_MODELS), same order as keys
    llm_timeout: float = 30.0       # seconds per provider call (LLM_TIMEOUT)
    max_history_messages: int = 100 # past messages sent to the LLM; 0 = unlimited (MAX_HISTORY_MESSAGES)
    allowed_origin_regex: str | None = None  # e.g. Vercel preview URLs (ALLOWED_ORIGIN_REGEX)
    rate_limit_per_minute: int = 0  # /chat requests per client per minute; 0 = off (RATE_LIMIT_PER_MINUTE)
    rate_limit_global_per_minute: int = 0  # /chat requests per minute for everyone; 0 = off

    @property
    def db_path(self) -> str:
        """Storage target for app.db: 'sqlite:////data/app.db' -> '/data/app.db';
        a postgres:// or postgresql:// URL is passed through unchanged."""
        url = self.database_url
        if url.startswith(("postgres://", "postgresql://")):
            return url
        prefix = "sqlite:///"
        if not url.startswith(prefix):
            raise ValueError("DATABASE_URL must start with sqlite:/// or postgresql://")
        return url[len(prefix):]

    @property
    def uses_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite:///")

    def model_for(self, index: int) -> str:
        """Model used with key number `index` (0-based). Falls back to LLM_MODEL."""
        if index < len(self.models) and self.models[index]:
            return self.models[index]
        return self.model

    @property
    def key_ids(self) -> list[str]:
        return [f"key_{i + 1}" for i in range(len(self.api_keys))]


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def load_settings() -> Settings:
    return Settings(
        api_keys=_split(os.getenv("LLM_API_KEYS", "")),
        model=os.getenv("LLM_MODEL", "gemini/gemini-2.0-flash"),
        database_url=os.getenv("DATABASE_URL", "sqlite:///./app.db"),
        allowed_origins=_split(os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,https://chatbot-lyftr.vercel.app")),
        enable_failure_simulation=os.getenv("ENABLE_FAILURE_SIMULATION", "false").strip().lower() in ("1", "true", "yes"),
        default_system_prompt=os.getenv("DEFAULT_SYSTEM_PROMPT", "You are a helpful, concise assistant."),
        models=tuple(_split(os.getenv("LLM_MODELS", ""))),
        llm_timeout=max(1.0, _float("LLM_TIMEOUT", 30.0)),
        max_history_messages=max(0, _int("MAX_HISTORY_MESSAGES", 100)),
        allowed_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX", "").strip() or None,
        rate_limit_per_minute=max(0, _int("RATE_LIMIT_PER_MINUTE", 0)),
        rate_limit_global_per_minute=max(0, _int("RATE_LIMIT_GLOBAL_PER_MINUTE", 0)),
    )
