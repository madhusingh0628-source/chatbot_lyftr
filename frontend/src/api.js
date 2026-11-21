// Backend base URL, baked in at build time or overridden at runtime
export function getApiUrl() {
  const custom = (typeof window !== "undefined" && localStorage.getItem("API_URL") || "").trim();
  if (custom) return custom.replace(/\/+$/, "");
  const rawUrl = (import.meta.env.VITE_API_URL || "").trim();
  if (rawUrl) {
    let resolved = rawUrl;
    if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) {
      resolved = `https://${resolved}`;
    }
    return resolved.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "http://localhost:8000";
  }
  return "https://chatbot-backend-3k2m.onrender.com";
}

export function setApiUrl(url) {
  if (typeof window === "undefined") return;
  if (!url || !url.trim()) {
    localStorage.removeItem("API_URL");
  } else {
    let resolved = url.trim();
    if (!resolved.startsWith("http://") && !resolved.startsWith("https://")) {
      resolved = `https://${resolved}`;
    }
    localStorage.setItem("API_URL", resolved.replace(/\/+$/, ""));
  }
}

export const API_URL = getApiUrl();

// New random id on every page load -> new session (spec: "A new session starts on each page load").
export function newSessionId() {
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `s-${rand}`;
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// Turn FastAPI's {"detail": ...} (string, or list of validation errors) into readable text.
function readableError(status, body) {
  const detail = body?.detail;
  if (status === 503) {
    if (typeof detail === "string" && detail.includes("no API keys")) {
      return "The server has no API keys configured. Set LLM_API_KEYS and restart the backend.";
    }
    return "All providers are unavailable right now. Please try again in a moment.";
  }
  if (status === 422 && Array.isArray(detail)) {
    return "Invalid request: " + detail
      .map((d) => {
        const field = (d.loc || []).filter((x) => x !== "body").join(".");
        return field ? `${field} – ${d.msg}` : d.msg;
      })
      .join("; ");
  }
  if (status === 404 && detail === "session not found") return "This conversation was not found on the server.";
  if (status === 429) return "Too many requests. Please slow down and try again.";
  if (typeof detail === "string") return `Error ${status}: ${detail}`;
  return `Error ${status}: something went wrong.`;
}

const unreachable = () => new ApiError(`Cannot reach the backend at ${getApiUrl()}. Is it running?`, 0);

async function request(path, { timeoutMs, signal, ...init } = {}) {
  // combine the caller's signal (Stop button) with an optional timeout
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = timeoutMs ? setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs) : null;

  let res;
  const baseUrl = getApiUrl();
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Request stopped", "AbortError");
    if (controller.signal.aborted) throw new ApiError("The server took too long to answer. Please try again.", 408);
    throw unreachable();
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { /* non-JSON body */ }
  }
  return { res, data };
}

/** GET /health -> { reachable, ok, keys, cache, simulation, database } */
export async function checkHealth() {
  try {
    const { res, data } = await request("/health", { timeoutMs: 6000 });
    return {
      reachable: true,
      ok: res.ok,
      keys: data?.keys_configured ?? null,
      cache: data?.cache_enabled ?? null,
      // older backends don't send this flag: assume the controls may work
      simulation: data?.failure_simulation ?? true,
      database: data?.database_ok ?? res.ok,
    };
  } catch {
    return { reachable: false, ok: false };
  }
}

/** GET /sessions/{session_id}/messages. */
export async function getSessionMessages(sessionId, { signal } = {}) {
  const { res, data } = await request(`/sessions/${encodeURIComponent(sessionId)}/messages`, { signal, timeoutMs: 15000 });
  if (!res.ok) throw new ApiError(readableError(res.status, data), res.status);
  return data;
}

/** DELETE /sessions/{session_id}. A 404 counts as success (already gone). */
export async function deleteSession(sessionId) {
  const { res, data } = await request(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", timeoutMs: 10000 });
  if (!res.ok && res.status !== 404) throw new ApiError(readableError(res.status, data), res.status);
}

/** POST /chat. Returns the JSON body, or throws an Error with a readable message. */
export async function sendChat({ sessionId, message, systemPrompt, simulateFailure, images, signal }) {
  const headers = { "Content-Type": "application/json" };
  if (simulateFailure?.trim()) headers["X-Simulate-Failure"] = simulateFailure.trim();

  const body = { session_id: sessionId, message };
  if (systemPrompt?.trim()) body.system_prompt = systemPrompt.trim();
  if (images?.length) body.images = images;

  // generous timeout: the backend may try several keys, 30 s each
  const { res, data } = await request("/chat", {
    method: "POST", headers, body: JSON.stringify(body), signal, timeoutMs: 180000,
  });
  if (!res.ok) throw new ApiError(readableError(res.status, data), res.status);
  return data;
}
