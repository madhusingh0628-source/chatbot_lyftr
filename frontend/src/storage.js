// localStorage that never throws (private mode, blocked storage, quota, corrupt JSON).

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch { return raw; }   // older versions stored plain strings
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app keeps working, it just won't remember */
  }
}

export const KEYS = {
  sessions: "chatbot_sessions",
  theme: "chatbot_theme",
  prefs: "chatbot_prefs",
};

export const MAX_SAVED_SESSIONS = 50;

/** Session list entries: { id, title, timestamp (created), updatedAt, count, pinned } */
export function loadSessions() {
  const list = load(KEYS.sessions, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.id === "string")
    .map((s) => ({ ...s, title: s.title || "Untitled chat", updatedAt: s.updatedAt || s.timestamp }));
}
