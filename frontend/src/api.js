// ---------- where the backend lives ----------
// The ONE place the production backend address is written down.
export const DEFAULT_BACKEND = "https://chatbot-backend-3k2m.onrender.com";
const OVERRIDE_KEY = "API_URL";

function readOverride() {
  try {
    return (globalThis.localStorage?.getItem(OVERRIDE_KEY) || "").trim();
  } catch {
    return "";   // storage blocked (strict privacy settings): never break the page over it
  }
}

/** Address used when the user hasn't overridden it. "" = same origin (Vercel proxies the API). */
export function defaultApiUrl() {
  const built = (import.meta.env.VITE_API_URL || "").trim();
  if (built) return normalizeApiUrl(built).url ?? "";
  const host = globalThis.location?.hostname || "";
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8000";
  if (host.endsWith(".vercel.app")) return "";   // vercel.json rewrites /chat, /health, /sessions to Render
  return DEFAULT_BACKEND;
}

/** Validate a user-typed address. Returns { url } or { error }. */
export function normalizeApiUrl(raw) {
  let value = (raw || "").trim();
  if (!value) return { url: "" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: "That doesn't look like a web address." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "Use an http:// or https:// address." };
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "http:" && globalThis.location?.protocol === "https:" && !local) {
    return { error: "This page is served over HTTPS, so the browser will block an http:// backend. Use https://." };
  }
  return { url: (parsed.origin + parsed.pathname).replace(/\/+$/, "") };
}

export function getApiUrl() {
  const override = readOverride();
  if (override) {
    const { url } = normalizeApiUrl(override);
    if (url) return url;
  }
  return defaultApiUrl();
}

export function hasApiOverride() {
  return Boolean(readOverride());
}

/** Save (or with "" clear) the override. Returns an error message, or null on success. */
export function setApiUrl(raw) {
  const { url, error } = normalizeApiUrl(raw);
  if (error) return error;
  try {
    if (!url || url === defaultApiUrl()) globalThis.localStorage?.removeItem(OVERRIDE_KEY);
    else globalThis.localStorage?.setItem(OVERRIDE_KEY, url);
    return null;
  } catch {
    return "Your browser is blocking site storage, so the address can't be saved.";
  }
}

/** Human-readable description of where requests go. */
export function describeApiUrl(base = getApiUrl()) {
  if (base) return base;
  const origin = globalThis.location?.origin || "this site";
  return `${origin} (proxied to the backend)`;
}

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
  if (status === 502 || status === 504) {
    return "The backend didn't answer in time (it may be waking up after being idle). Please wait a moment and Retry.";
  }
  if (status === 404 && detail === "session not found") return "This conversation was not found on the server.";
  if (status === 429) {
    return typeof detail === "string" && detail ? `Slow down: ${detail}` : "Too many requests. Please wait a minute and try again.";
  }
  if (typeof detail === "string") return `Error ${status}: ${detail}`;
  return `Error ${status}: something went wrong.`;
}

const unreachable = (base) => new ApiError(
  base
    ? `Cannot reach the backend at ${base}. It may be starting up (this can take up to a minute) — please try again.`
    : "Cannot reach the backend through this site's proxy. It may be starting up (this can take up to a minute) — please try again.",
  0,
);

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
    // No automatic re-send: a POST /chat that failed at the proxy may already have reached
    // the backend, and sending it again would store (and bill) the same turn twice.
    res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Request stopped", "AbortError");
    if (controller.signal.aborted) throw new ApiError("The server took too long to answer. Please try again.", 408);
    throw unreachable(baseUrl);
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
export async function checkHealth({ timeoutMs = 75000 } = {}) {
  try {
    const { res, data } = await request("/health", { timeoutMs });
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
