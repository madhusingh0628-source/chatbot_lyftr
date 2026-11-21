import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons.jsx";
import { GROUP_ORDER, copyText, dayGroup, modKey, relativeTime } from "../utils.js";

function SessionItem({ s, active, loading, onSelect, onDelete, onRename, onTogglePin }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(s.title);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  useEffect(() => {
    if (!confirming) return undefined;
    const t = setTimeout(() => setConfirming(false), 4000);   // confirmation quietly expires
    return () => clearTimeout(t);
  }, [confirming]);

  function commit() {
    const title = draft.trim();
    if (title && title !== s.title) onRename(s.id, title);
    setEditing(false);
  }

  return (
    <li className={`session-item ${active ? "active" : ""} ${loading ? "loading" : ""}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="session-rename"
          value={draft}
          maxLength={80}
          aria-label="Chat name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { e.stopPropagation(); setDraft(s.title); setEditing(false); }
          }}
        />
      ) : (
        <button
          type="button"
          className="session-main"
          onClick={() => onSelect(s.id)}
          onDoubleClick={() => { setDraft(s.title); setEditing(true); }}
          aria-current={active ? "page" : undefined}
          title={s.title}
        >
          {s.pinned && <Icon name="pin" size={12} className="pin-mark" />}
          <span className="session-title">{s.title}</span>
          <span className="session-time">{loading ? "Loading…" : relativeTime(s.updatedAt)}</span>
        </button>
      )}
      {!editing && (
        confirming ? (
          <div className="session-confirm">
            <button type="button" className="confirm-yes" onClick={() => { setConfirming(false); onDelete(s.id); }}>Delete</button>
            <button type="button" className="confirm-no" onClick={() => setConfirming(false)} aria-label="Cancel delete">
              <Icon name="x" size={13} />
            </button>
          </div>
        ) : (
          <div className="session-actions">
            <button type="button" onClick={() => onTogglePin(s.id)} title={s.pinned ? "Unpin" : "Pin to top"} aria-label={s.pinned ? `Unpin ${s.title}` : `Pin ${s.title}`}>
              <Icon name="pin" size={14} />
            </button>
            <button type="button" onClick={() => { setDraft(s.title); setEditing(true); }} title="Rename" aria-label={`Rename ${s.title}`}>
              <Icon name="pencil" size={14} />
            </button>
            <button type="button" className="danger" onClick={() => setConfirming(true)} title="Delete" aria-label={`Delete ${s.title}`}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        )
      )}
    </li>
  );
}

function SessionStats({ messages, sessionId, apiUrl, onToast }) {
  const replies = messages.filter((m) => m.role === "assistant" && m.meta);
  const cached = replies.filter((m) => m.meta.resolution_source === "LLM_CACHE");
  const live = replies.filter((m) => m.meta.resolution_source !== "LLM_CACHE");
  const tokens = replies.reduce((s, m) => s + (m.meta.input_tokens || 0) + (m.meta.output_tokens || 0), 0);
  const avg = (list) => (list.length ? Math.round(list.reduce((s, m) => s + (m.meta.latency_ms || 0), 0) / list.length) : null);
  const hitRate = replies.length ? Math.round((cached.length / replies.length) * 100) : 0;

  return (
    <div className="sidebar-stats">
      <div className="stats-title">This chat</div>
      <dl className="stats-grid">
        <div><dt>Replies</dt><dd>{replies.length}</dd></div>
        <div><dt>Cache hits</dt><dd>{cached.length}{replies.length > 0 && <small> ({hitRate}%)</small>}</dd></div>
        <div><dt>Tokens</dt><dd>{tokens.toLocaleString()}</dd></div>
        <div><dt>Avg live</dt><dd>{avg(live) !== null ? `${avg(live)} ms` : "—"}</dd></div>
        <div><dt>Avg cache</dt><dd>{avg(cached) !== null ? `${avg(cached)} ms` : "—"}</dd></div>
      </dl>
      <button
        type="button"
        className="session-id"
        title="Copy session id"
        onClick={async () => onToast((await copyText(sessionId)) ? "Session id copied" : "Couldn't copy", "success")}
      >
        <code>{sessionId}</code>
        <Icon name="copy" size={12} />
      </button>
      <div className="backend-url" title="Backend URL">
        <Icon name="monitor" size={12} /> <code>{apiUrl}</code>
      </div>
    </div>
  );
}

export function Sidebar({
  open, narrow, onClose, sessions, activeId, loadingId, onNew, onSelect, onDelete, onRename, onTogglePin,
  searchRef, messages, sessionId, apiUrl, onToast,
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
    const sorted = [...filtered].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const map = new Map();
    for (const s of sorted) {
      const g = s.pinned ? "Pinned" : dayGroup(s.updatedAt);
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(s);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)]);
  }, [sessions, query]);

  return (
    <>
      {narrow && open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Chat history" aria-hidden={!open || undefined} inert={!open ? "" : undefined}>
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark"><Icon name="sparkles" size={16} /></span>
            <span className="brand-name">LLM Chatbot</span>
            <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close sidebar" title="Close sidebar">
              <Icon name="panel" />
            </button>
          </div>
          <button type="button" className="new-chat-btn" onClick={onNew} title={`New chat (${modKey}+Shift+O)`}>
            <Icon name="plus" size={16} /> New chat
            <kbd className="kbd-hint">{modKey}⇧O</kbd>
          </button>
          <div className="search">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search chats"
              value={query}
              aria-label="Search chats"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.stopPropagation(); setQuery(""); } }}
            />
            {!query && <kbd className="kbd-hint">{modKey}K</kbd>}
          </div>
        </div>

        <nav className="session-list" aria-label="Previous chats">
          {sessions.length === 0 ? (
            <div className="session-empty">
              <Icon name="message" size={22} />
              <p>No chats yet</p>
              <span>Your conversations will appear here.</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="session-empty">
              <p>No matches</p>
              <span>Nothing matches “{query}”.</span>
            </div>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} className="session-group">
                <h3 className="group-label">{label}</h3>
                <ul>
                  {items.map((s) => (
                    <SessionItem
                      key={s.id}
                      s={s}
                      active={s.id === activeId}
                      loading={s.id === loadingId}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      onRename={onRename}
                      onTogglePin={onTogglePin}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </nav>

        <SessionStats messages={messages} sessionId={sessionId} apiUrl={apiUrl} onToast={onToast} />
      </aside>
    </>
  );
}
