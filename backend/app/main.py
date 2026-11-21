import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .config import Settings, load_settings
from .llm_gateway import setup_cache
from .routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("chatbot")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    db.init_db(settings.db_path)  # schema is created automatically on startup
    setup_cache()                 # LiteLLM in-memory response cache

    app = FastAPI(title="LLM Chatbot")
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        max_age=600,  # browsers cache the preflight instead of sending one per message
    )

    # --- every error is JSON with a "detail" field, never HTML or a stack trace ---
    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        details = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg", "invalid value")}
            for e in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": details})

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        log.exception("unhandled error")  # full trace goes to server logs only
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

    app.include_router(router)
    return app


_app: FastAPI | None = None


def __getattr__(name: str):
    """`uvicorn app.main:app` still works, but the app (and its SQLite file) is only
    created when something actually asks for it, not whenever this module is imported
    (tests import create_app and used to leave a stray ./app.db behind)."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(name)
