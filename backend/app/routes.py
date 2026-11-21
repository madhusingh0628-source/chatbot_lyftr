from fastapi import APIRouter, Header, HTTPException, Path, Request
from fastapi.responses import JSONResponse, Response

from . import db
from .llm_gateway import AllProvidersUnavailable, NoVisionModel, cache_enabled, parse_simulation_header
from .schemas import ChatRequest, ChatResponse
from .sessions import handle_chat

router = APIRouter()

SessionId = Path(min_length=1, max_length=128)


@router.get("/health")
def health(request: Request):
    s = request.app.state.settings
    db_ok = db.check_db(s.db_path)
    keys = len(s.api_keys)
    healthy = db_ok and keys > 0
    body = {"status": "ok" if healthy else "degraded",
            "keys_configured": keys, "cache_enabled": cache_enabled(),
            "database_ok": db_ok,
            # lets the UI hide the failover controls when the header would be ignored
            "failure_simulation": s.enable_failure_simulation}
    return JSONResponse(body, status_code=200 if healthy else 503)


@router.get("/sessions/{session_id}/messages")
def session_messages(request: Request, session_id: str = SessionId):
    db_path = request.app.state.settings.db_path
    messages = db.get_history(db_path, session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session_id": session_id, "messages": messages,
            "system_prompt": db.get_system_prompt(db_path, session_id)}


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(request: Request, session_id: str = SessionId):
    if not db.delete_session(request.app.state.settings.db_path, session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return Response(status_code=204)


@router.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest,
    request: Request,
    x_simulate_failure: str | None = Header(default=None),  # reads the X-Simulate-Failure header
):
    settings = request.app.state.settings
    # the test hook is honored ONLY when explicitly enabled
    simulate = parse_simulation_header(x_simulate_failure) if settings.enable_failure_simulation else {}
    try:
        return handle_chat(settings, req, simulate)
    except NoVisionModel:
        return JSONResponse(status_code=422, content={"detail": "no configured model can read images"})
    except AllProvidersUnavailable:
        if not settings.api_keys:
            return JSONResponse(status_code=503, content={"detail": "all providers unavailable (no API keys configured)"})
        return JSONResponse(status_code=503, content={"detail": "all providers unavailable"})
