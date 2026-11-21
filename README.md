# LLM Chatbot with Key Failover and Response Caching

Production-ready, fault-tolerant chatbot system with automated multi-key failover, in-memory response caching, token usage tracking, and multi-turn session persistence. Built with **FastAPI**, **React (Vite)**, **LiteLLM**, and **SQLite**.

---

## 1. Live URLs

- **Frontend**: https://chatbot-lyftr.vercel.app
- **Backend API**: https://chatbot-backend-3k2m.onrender.com
- **Health Check**: https://chatbot-backend-3k2m.onrender.com/health
- **Public GitHub Repository**: https://github.com/madhusingh0628-source/chatbot_lyftr

---

## 2. Run locally: with Docker and without

### With Docker (Recommended)
The stack starts backend on port 8000 and frontend on port 3000 using multi-stage Dockerfiles and a named volume for SQLite persistence.

```bash
# 1. Create environment file from example
cp .env.example .env
# Edit .env and insert your API keys

# 2. Build and start services in background
make up

# 3. Stop services
make down

# 4. View logs
make logs
```
- Backend health check: `http://localhost:8000/health`
- Frontend application: `http://localhost:3000`

---

### Without Docker

#### Backend Setup
```powershell
cd backend

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Run server with Uvicorn
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Backend runs at `http://127.0.0.1:8000`.

#### Frontend Setup
```powershell
cd frontend

# Install npm dependencies
npm install

# Start Vite dev server
npm run dev -- --host 127.0.0.1 --port 5173
```
Frontend runs at `http://127.0.0.1:5173`.

---

### Environment Variables

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `LLM_API_KEYS` | Comma-separated key pool (ordered: `key_1`, `key_2`, ...) | `gsk_...,AQ....` |
| `LLM_MODEL` | Default LiteLLM model provider/name | `groq/openai/gpt-oss-20b` |
| `LLM_MODELS` | Optional per-key models (matched to key order) | `groq/openai/gpt-oss-20b,gemini/gemini-3.5-flash-lite` |
| `DATABASE_URL` | SQLite database URI (`sqlite:////data/app.db` in Docker) | `sqlite:///./app.db` |
| `ALLOWED_ORIGINS` | Permitted CORS origins for the frontend | `http://localhost:3000,http://localhost:5173` |
| `ENABLE_FAILURE_SIMULATION` | Enables `X-Simulate-Failure` test header | `true` |
| `DEFAULT_SYSTEM_PROMPT` | Fallback system prompt for sessions | `You are a helpful, concise assistant.` |
| `VITE_API_URL` | Base URL of backend called by frontend | `http://localhost:8000` |

---

## 3. Design decisions: key fallback, caching, SQLite session storage

### Key Fallback Architecture
- **Failover Priority Chain**: Keys are organized into an ordered pool (`key_1`, `key_2`, ...). In this configuration, Key 1 is Groq (`groq/openai/gpt-oss-20b`) and Key 2 is Google Gemini (`gemini/gemini-3.5-flash-lite`).
- **Failover Errors Detected**: The gateway intercepts transient and quota errors (`429 RateLimitError`, `401/403 AuthenticationError`, `408 Timeout`, `5xx InternalServerError / BadGateway / ServiceUnavailable`, and API connection drops).
- **Graceful Failover**: When Key 1 fails with any of these statuses, the gateway records the fallback attempt and immediately delegates to Key 2. The client receives a successful HTTP 200 with `key_id: "key_2"` and `fallback_attempts: 1`.
- **Atomic Failure Handling**: If all keys in the pool fail, the gateway raises `AllProvidersUnavailable`, returning HTTP 503 `{"detail": "all providers unavailable"}`. No half-saved states or corrupted turns are written to SQLite.

### Response Caching
- **Shared In-Memory Cache**: Powered by LiteLLM's local cache. The cache key is computed over the full conversation history (messages list) and the system prompt. Because the API key is excluded from the cache key, cached answers are instantly shared across all keys in the pool.
- **Simulation Isolation**: When the `X-Simulate-Failure` header is present, cache reads are bypassed (`cache={"no-cache": True}`) so test headers genuinely exercise the key pool.
- **Exact Contract Compliance**: On a cache hit, `resolution_source` reports `"LLM_CACHE"`, `key_id` reports `null`, and `fallback_attempts` is `0`. Input and output token counts are preserved from the original generation.

### SQLite Session Storage
- **Zero-ORM, Pure SQLite**: Implemented with Python's standard `sqlite3` driver for speed, zero external dependencies, and minimal memory footprint.
- **Persistent Storage**: Mapped via Docker named volume `chatbot-data` mounted at `/data`, so history survives container rebuilds and restarts.
- **Schema Auto-Creation**: Tables and indices (`messages`, `session_settings`, and `idx_messages_session`) are created automatically on startup.
- **Atomic Exchanges**: User prompt and assistant reply are saved together in a single database transaction, preventing orphaned or desynchronized conversation states.

---

## 4. Verification: how to see failover, cache hits and per-message token usage

### How to Verify Failover
1. **Via UI**: In the Settings or Failover control panel above the chat, click **"key_1 → 429"** (or **"key_1 → 500"**). Send a message.
2. **Observe**:
   - The response succeeds with HTTP 200.
   - The metadata shows `key: key_2` and `fallbacks: 1`.
   - The failover replay chip appears: `key_1 ✗ 429 ➔ key_2 ✓`.
3. **Verify Complete Outage (503)**:
   - Select **"All keys down"** (`*=429`). Send a message.
   - The UI shakes and cleanly displays the error message `All providers are unavailable right now. Please try again in a moment.` with a **Retry** button.
   - Database check: No turn is recorded in session history.

### How to Verify Cache Hits
1. Click the suggested chip **"What is the capital of France?"** in a new session.
   - Response arrives via live inference in ~600 ms with badge `● LIVE_INFERENCE`.
2. Click **"⟳ Ask again"** or open a new session and send the exact same question.
   - Response arrives in < 5 ms with badge `⚡ LLM_CACHE` and an animated gold pulse.
   - The visual latency bar remains a tiny sliver compared to the live green bar.

### How to Verify Per-Message Token Usage
- Every assistant reply displays:
  - `in`: Prompt tokens for that specific request (system prompt + history + user message).
  - `out`: Completion tokens for that response only.
- Notice that as conversation history grows, `in` increases appropriately per turn, but is **never a cumulative conversation total**.

---

## 5. Setup Used: your editor and AI tools

- **Editor & IDE**: Visual Studio Code / Antigravity IDE on Windows 11.
- **Runtime Environment**: Python 3.11, Node.js v26.13, Vite 5, Docker Compose v2.
- **AI Tools & Assistants**:
  - **Antigravity AI Agent**: Used for full-stack scaffolding, automated multi-turn state management, and strict contract verification.
  - **LiteLLM**: Model orchestration, automated retry/failover handling, and local cache management.

---

## 6. Bonus features (if any): what you added beyond the requirements and why

1. **🎤 Voice Input (Speech-to-Text Dictation)**:
   - Built-in browser `SpeechRecognition` mic button.
   - Pulses red while listening and auto-transcribes words directly into the input box with interim feedback.
   - Enables hands-free interactions without extra API keys or cost.
2. **🔊 Text-to-Speech (Read Replies Aloud)**:
   - Speaker button on every assistant bubble reading replies using native `SpeechSynthesis`.
   - Optional setting to automatically read incoming responses aloud.
3. **📎 Multimodal File & Image Attachments with Vision Routing**:
   - Support for `.txt`, `.csv`, `.md`, `.py`, `.json`, `.js`, etc., ingested client-side into the prompt within the 4,000-character limit.
   - Supports images via file picker, drag-and-drop, or clipboard paste (`Ctrl+V`). Images are resized to $\le 1024\text{ px}$.
   - **Vision-Aware Model Routing**: Automatically checks vision support and routes image queries directly to vision-capable models (e.g. Gemini), skipping text-only models without counting as a failure.
4. **📁 Past Sessions History Drawer**:
   - Sidebar drawer displaying previous sessions. Clicking any session retrieves and displays the conversation turns from SQLite via `GET /sessions/{session_id}/messages`.
5. **⚡ Interactive Failover Control Panel**:
   - Segmented buttons (`Normal`, `key_1 → 429`, `key_1 → 500`, `All keys down`) making the resilience demonstration 1-click easy.
6. **Visual Latency Speed Bar & Gold Flash**:
   - Visual speed track underneath each bubble highlighting the dramatic speed improvement between live inference (~600 ms) and cache hits (< 5 ms).
7. **System Prompt Presets**:
   - Quick one-click prompt presets (`Concise`, `Explain like I'm 10`, `Code Expert`, `Pirate`) to showcase how system prompts alter responses and cache signatures.
8. **Live Session Analytics Strip**:
   - Real-time dashboard showing total replies, cache hit ratio (e.g. `33% cached`), cumulative tokens used, and average response times.
