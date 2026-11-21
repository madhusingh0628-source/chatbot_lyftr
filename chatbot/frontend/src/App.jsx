import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL, checkHealth, deleteSession, getSessionMessages, newSessionId, sendChat } from "./api.js";
import {
  MAX_IMAGES, MAX_MESSAGE, charCount, composeMessage, isImage, isTextFile, parseStoredUserMessage,
  readImageFile, readTextFile,
} from "./attachments.js";
import { useDictation, useSpeaker } from "./useSpeech.js";
import { KEYS, MAX_SAVED_SESSIONS, load, loadSessions, save } from "./storage.js";
import { downloadText, modKey, slug, titleFrom } from "./utils.js";
import { Icon } from "./icons.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { Composer } from "./components/Composer.jsx";
import { SettingsDialog, SYSTEM_PROMPT_PRESETS } from "./components/SettingsDialog.jsx";
import { Lightbox, Toasts, useToasts } from "./components/Overlay.jsx";
import {
  AssistantMessage, ChatSkeleton, EmptyState, ErrorMessage, NoticeMessage, Typing, UserMessage,
} from "./components/Messages.jsx";

let nextId = 1;
const uid = () => nextId++;
const now = () => new Date().toISOString();

const DEFAULT_PREFS = { autoRead: false, showMeta: true, enterToSend: true, sidebarOpen: true };
const NARROW_QUERY = "(max-width: 900px)";
const isTouch = () => globalThis.matchMedia?.("(hover: none)").matches;

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => globalThis.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}

function HealthPill({ health }) {
  let state = "checking";
  let label = "Connecting…";
  let detail = `Checking ${API_URL}`;
  if (health) {
    if (!health.reachable) { state = "down"; label = "Offline"; detail = `Can't reach ${API_URL}`; }
    else if (!health.ok) {
      state = "degraded"; label = "Degraded";
      detail = health.keys === 0 ? "Backend is up but has no API keys configured" : "Backend is up but its database is unavailable";
    } else {
      state = "up"; label = "Online";
      detail = `${health.keys} API key${health.keys === 1 ? "" : "s"} · cache ${health.cache ? "on" : "off"}`;
    }
  }
  return (
    <span className={`health ${state}`} title={detail} role="status" aria-label={`Backend ${label}: ${detail}`}>
      <i aria-hidden="true" /> <span className="health-label">{label}</span>
    </span>
  );
}

export default function App() {
  const narrow = useMediaQuery(NARROW_QUERY);
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_PREFS, ...(load(KEYS.prefs, {}) || {}) }));
  const [theme, setTheme] = useState(() => {
    const t = load(KEYS.theme, "system");
    return ["light", "dark", "system"].includes(t) ? t : "system";
  });

  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [simulate, setSimulate] = useState("");
  const [pending, setPending] = useState(null);          // { startedAt } while a reply is on its way
  const [loadingSession, setLoadingSession] = useState(null);
  const [health, setHealth] = useState(null);
  const [sessions, setSessions] = useState(loadSessions);
  const [sidebarOpen, setSidebarOpen] = useState(() => prefs.sidebarOpen && !globalThis.matchMedia?.(NARROW_QUERY).matches);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [shake, setShake] = useState(false);

  const loading = Boolean(pending);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  const searchRef = useRef(null);
  const abortRef = useRef(null);
  const dragDepth = useRef(0);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const { toasts, push: toast, dismiss: dismissToast } = useToasts();
  const speaker = useSpeaker();
  const dictation = useDictation(setInput, (msg) => toast(msg, "error"));

  const focusComposer = useCallback(() => {
    if (!isTouch()) requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  /* ---------- persistence ---------- */
  useEffect(() => save(KEYS.prefs, prefs), [prefs]);
  useEffect(() => save(KEYS.sessions, sessions), [sessions]);
  const setPref = useCallback((key, value) => setPrefs((p) => ({ ...p, [key]: value })), []);

  /* ---------- theme ---------- */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    save(KEYS.theme, theme);
    const dark = theme === "dark" || (theme === "system" && globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f1115" : "#ffffff");
  }, [theme]);
  const cycleTheme = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));

  /* ---------- health: poll while visible, re-check on focus / network change ---------- */
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      if (document.visibilityState === "hidden") return;
      const h = await checkHealth();
      if (alive) setHealth(h);
    };
    ping();
    const t = setInterval(ping, 15000);
    const onVisible = () => document.visibilityState === "visible" && ping();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", ping);
    window.addEventListener("offline", ping);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", ping);
      window.removeEventListener("offline", ping);
    };
  }, []);
  const simulationAvailable = health?.simulation !== false;
  const offline = health ? !health.reachable : false;

  /* ---------- sidebar ---------- */
  useEffect(() => { if (narrow) setSidebarOpen(false); }, [narrow]);
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      if (!globalThis.matchMedia?.(NARROW_QUERY).matches) setPref("sidebarOpen", !o);
      return !o;
    });
  }, [setPref]);
  const closeSidebarIfNarrow = useCallback(() => { if (narrow) setSidebarOpen(false); }, [narrow]);

  /* ---------- derived ---------- */
  const outgoing = composeMessage(input, attachments);
  const images = attachments.filter((a) => a.kind === "image");
  const count = charCount(outgoing.trim());
  const canSend = !loading && count <= MAX_MESSAGE && (input.trim().length > 0 || attachments.length > 0);
  const activeSession = sessions.find((s) => s.id === sessionId);
  const firstUserText = messages.find((m) => m.role === "user")?.text;
  const chatTitle = activeSession?.title || (messages.length ? titleFrom(firstUserText || "Untitled chat") : "New chat");
  const persona = systemPrompt.trim()
    ? SYSTEM_PROMPT_PRESETS.find((p) => p.prompt === systemPrompt)?.label || "Custom instructions"
    : "";
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") return i;
    return -1;
  }, [messages]);

  useEffect(() => {
    document.title = messages.length ? `${chatTitle} · LLM Chatbot` : "LLM Chatbot";
  }, [chatTitle, messages.length]);

  /* ---------- scrolling: follow new messages only if the user is at the bottom ---------- */
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);
  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [messages, pending, scrollToBottom]);
  function onScroll() {
    const el = scrollRef.current;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = bottom;
    setAtBottom(bottom);
  }

  /* ---------- messages ---------- */
  const addMessage = useCallback((m) => {
    setMessages((list) => [...list, { id: uid(), createdAt: now(), fresh: true, ...m }]);
  }, []);
  const removeMessage = useCallback((id) => setMessages((list) => list.filter((m) => m.id !== id)), []);

  function rememberSession(id, titleHint) {
    setSessions((list) => {
      const existing = list.find((s) => s.id === id);
      const stamp = now();
      if (existing) {
        return list.map((s) => (s.id === id ? { ...s, updatedAt: stamp, count: (s.count || 0) + 1 } : s));
      }
      const entry = { id, title: titleFrom(titleHint, "Untitled chat"), timestamp: stamp, updatedAt: stamp, count: 1, pinned: false };
      // keep pinned chats, drop the oldest unpinned ones beyond the limit
      const next = [entry, ...list];
      if (next.length <= MAX_SAVED_SESSIONS) return next;
      const unpinned = next.filter((s) => !s.pinned).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      const keep = new Set([...next.filter((s) => s.pinned), ...unpinned.slice(0, MAX_SAVED_SESSIONS)].map((s) => s.id));
      return next.filter((s) => keep.has(s.id));
    });
  }

  async function run(payload, titleHint) {
    const forSession = sessionIdRef.current;
    const activeSimulate = simulationAvailable ? simulate : "";
    const controller = new AbortController();
    abortRef.current = controller;
    setPending({ startedAt: Date.now() });
    stickRef.current = true;
    try {
      const data = await sendChat({
        sessionId: forSession, ...payload, systemPrompt, simulateFailure: activeSimulate, signal: controller.signal,
      });
      if (sessionIdRef.current !== forSession) return;   // user switched chats meanwhile
      const id = uid();
      setMessages((list) => [...list, { id, role: "assistant", text: data.reply, meta: data.metadata, createdAt: now(), fresh: true }]);
      rememberSession(forSession, titleHint);
      if (prefs.autoRead) speaker.speak(id, data.reply);
    } catch (err) {
      if (sessionIdRef.current !== forSession) return;
      if (err.name === "AbortError") {
        addMessage({ role: "notice", text: "Stopped. The server may still finish this reply — reopen the chat from the sidebar to see it." });
      } else {
        addMessage({ role: "error", text: err.message, retry: { payload, titleHint } });
        if (err.status === 0) checkHealth().then(setHealth);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (activeSimulate) setSimulate("");   // simulation applies to one message only
      setPending(null);
      focusComposer();
    }
  }

  function dispatch(payload, userMsg) {
    if (loading) return;
    if (dictation.listening) dictation.stop();
    addMessage({ role: "user", ...userMsg, payload });
    run(payload, userMsg.text || userMsg.files?.[0]?.name || (userMsg.images?.length ? "Image question" : payload.message));
  }

  function nudge(text) {
    setShake(true);
    setTimeout(() => setShake(false), 450);
    if (text) toast(text, "error");
  }

  function sendFromComposer() {
    if (loading) return;
    if (count > MAX_MESSAGE) { nudge(`Message is too long (max ${MAX_MESSAGE.toLocaleString()} characters).`); return; }
    let message = outgoing.trim();
    if (!message && images.length) message = "Describe this image.";
    if (!message) { nudge(); return; }
    const sentImages = images;
    const files = attachments.filter((a) => a.kind === "text");
    setInput("");
    setAttachments([]);
    dispatch(
      { message, images: sentImages.map((a) => a.dataUrl) },
      { text: input.trim(), images: sentImages, files },
    );
  }

  function askAgain(userMsg) {
    const payload = userMsg.payload || { message: userMsg.text };
    if (!payload.message) return;
    if (userMsg.imageCount && !payload.images?.length) toast("Images aren't stored in history, so only the text is resent.");
    dispatch(payload, {
      text: userMsg.text, images: userMsg.images, files: userMsg.files, imageCount: userMsg.imageCount,
    });
  }

  function editInComposer(userMsg) {
    setInput(userMsg.text || "");
    if (userMsg.files?.length || userMsg.images?.length) {
      setAttachments([...(userMsg.files || []), ...(userMsg.images || [])].slice(0, 10));
    }
    focusComposer();
  }

  function recallLast() {
    const last = [...messages].reverse().find((m) => m.role === "user" && m.text);
    if (!last) return false;
    setInput(last.text);
    return true;
  }

  function retry(errorMsg) {
    removeMessage(errorMsg.id);
    run(errorMsg.retry.payload, errorMsg.retry.titleHint);
  }

  function stop() {
    abortRef.current?.abort();
  }

  /* ---------- attachments ---------- */
  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    let imageCount = attachmentsRef.current.filter((a) => a.kind === "image").length;
    for (const file of files) {
      try {
        if (isImage(file)) {
          if (imageCount >= MAX_IMAGES) {
            toast(`Up to ${MAX_IMAGES} images per message — skipped ${file.name}.`, "error");
            continue;
          }
          imageCount++;
          try {
            const a = await readImageFile(file);
            setAttachments((l) => [...l, a]);
          } catch (err) {
            imageCount--;
            throw err;
          }
        } else if (isTextFile(file)) {
          if (attachmentsRef.current.some((a) => a.kind === "text" && a.name === file.name && a.size === file.size)) {
            toast(`${file.name} is already attached.`);
            continue;
          }
          const a = await readTextFile(file);
          setAttachments((l) => [...l, a]);
        } else {
          toast(`${file.name}: only images (PNG, JPEG, GIF, WebP) and text/code files are supported.`, "error");
        }
      } catch (err) {
        toast(err.message, "error");
      }
    }
    focusComposer();
  }

  /* ---------- sessions ---------- */
  const resetChat = useCallback(() => {
    const id = newSessionId();
    sessionIdRef.current = id;   // before aborting, so the aborted request's handler ignores itself
    abortRef.current?.abort();
    speaker.stop();
    if (dictation.listening) dictation.stop();
    setSessionId(id);
    setMessages([]);
    setAttachments([]);
    setInput("");
    setSimulate("");
    stickRef.current = true;
    setAtBottom(true);
  }, [speaker, dictation]);

  const newChat = useCallback(() => {
    resetChat();
    closeSidebarIfNarrow();
    focusComposer();
  }, [resetChat, closeSidebarIfNarrow, focusComposer]);

  async function openSession(id) {
    if (id === sessionId) { closeSidebarIfNarrow(); return; }
    if (loading) { toast("Wait for the current reply (or stop it) before switching chats."); return; }
    setLoadingSession(id);
    try {
      const data = await getSessionMessages(id);
      const converted = (data.messages || []).map((m) => {
        if (m.role === "user") {
          const parsed = parseStoredUserMessage(m.content);
          return {
            id: uid(), role: "user", text: parsed.text, files: parsed.files, imageCount: parsed.imageCount,
            payload: { message: parsed.resend }, createdAt: m.created_at,
          };
        }
        return { id: uid(), role: m.role, text: m.content, meta: m.metadata || null, createdAt: m.created_at };
      });
      speaker.stop();
      setSessionId(id);
      setMessages(converted);
      setSystemPrompt(data.system_prompt || "");
      setAttachments([]);
      setInput("");
      stickRef.current = true;
      requestAnimationFrame(() => scrollToBottom(false));
      closeSidebarIfNarrow();
      focusComposer();
    } catch (err) {
      if (err.status === 404) {
        setSessions((list) => list.filter((s) => s.id !== id));
        toast("That chat no longer exists on the server, so it was removed from your history.", "error");
      } else {
        toast(`Couldn't open the chat: ${err.message}`, "error");
      }
    } finally {
      setLoadingSession(null);
    }
  }

  async function removeSession(id) {
    try {
      await deleteSession(id);
    } catch (err) {
      toast(`Couldn't delete the chat: ${err.message}`, "error");
      return;
    }
    setSessions((list) => list.filter((s) => s.id !== id));
    if (id === sessionId) resetChat();
    toast("Chat deleted", "success");
  }

  async function clearHistory() {
    const ids = sessions.map((s) => s.id);
    const results = await Promise.allSettled(ids.map((id) => deleteSession(id)));
    const failed = new Set(ids.filter((_, i) => results[i].status === "rejected"));
    setSessions((list) => list.filter((s) => failed.has(s.id)));
    if (!failed.has(sessionId)) resetChat();
    setSettingsOpen(false);
    toast(failed.size ? `Deleted ${ids.length - failed.size} chats; ${failed.size} couldn't be reached.` : "All chats deleted", failed.size ? "error" : "success");
  }

  const renameSession = (id, title) => setSessions((list) => list.map((s) => (s.id === id ? { ...s, title } : s)));
  const togglePin = (id) => setSessions((list) => list.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s)));

  function exportChat() {
    const lines = [`# ${chatTitle}`, "", `_Exported ${new Date().toLocaleString()} · session ${sessionId}_`, ""];
    if (systemPrompt.trim()) lines.push(`> **System prompt:** ${systemPrompt.trim()}`, "");
    for (const m of messages) {
      if (m.role === "user") {
        lines.push("## You", "");
        (m.files || []).forEach((f) => lines.push(`*Attached file: ${f.name}*`, ""));
        if (m.images?.length || m.imageCount) lines.push(`*${m.images?.length || m.imageCount} image(s) attached*`, "");
        lines.push(m.text || "", "");
      } else if (m.role === "assistant") {
        lines.push("## Assistant", "", m.text, "");
        if (m.meta) lines.push(`<sub>${m.meta.resolution_source} · ${m.meta.model} · ${m.meta.latency_ms} ms · ${m.meta.input_tokens}→${m.meta.output_tokens} tokens</sub>`, "");
      }
    }
    downloadText(`${slug(chatTitle)}.md`, lines.join("\n"));
    toast("Conversation exported as Markdown", "success");
  }

  /* ---------- global keyboard shortcuts ---------- */
  const shortcutRef = useRef();
  shortcutRef.current = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (settingsOpen || lightbox) return;   // the open dialog handles its own keys
    if (mod && e.shiftKey && key === "o") { e.preventDefault(); newChat(); }
    else if (mod && key === "k") {
      e.preventDefault();
      setSidebarOpen(true);
      setTimeout(() => searchRef.current?.focus(), 50);
    } else if (mod && key === "b") { e.preventDefault(); toggleSidebar(); }
    else if (e.key === "/" && !typing && !mod) { e.preventDefault(); textareaRef.current?.focus(); }
    else if (e.key === "Escape") {
      if (loading) { e.preventDefault(); stop(); }
      else if (narrow && sidebarOpen) setSidebarOpen(false);
    }
  };
  useEffect(() => {
    const onKey = (e) => shortcutRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { focusComposer(); }, [focusComposer]);

  /* ---------- render ---------- */
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <a href="#chat-input" className="skip-link">Skip to message box</a>

      <Sidebar
        open={sidebarOpen}
        narrow={narrow}
        onClose={() => (narrow ? setSidebarOpen(false) : toggleSidebar())}
        sessions={sessions}
        activeId={sessionId}
        loadingId={loadingSession}
        onNew={newChat}
        onSelect={openSession}
        onDelete={removeSession}
        onRename={renameSession}
        onTogglePin={togglePin}
        searchRef={searchRef}
        messages={messages}
        sessionId={sessionId}
        apiUrl={API_URL}
        onToast={toast}
      />

      <div className="main">
        <header className="topbar">
          {!sidebarOpen && (
            <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Open sidebar" title={`Open sidebar (${modKey}+B)`}>
              <Icon name="panel" />
            </button>
          )}
          <h1 className="chat-title" title={chatTitle}>{chatTitle}</h1>
          <HealthPill health={health} />
          <div className="topbar-actions">
            {messages.length > 0 && (
              <button type="button" className="icon-btn" onClick={exportChat} aria-label="Export conversation" title="Export as Markdown">
                <Icon name="download" />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={cycleTheme}
              aria-label={`Theme: ${theme}. Click to change.`}
              title={`Theme: ${theme} (click to change)`}
            >
              <Icon name={theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"} />
            </button>
            <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
              <Icon name="sliders" />
            </button>
            {(!sidebarOpen || narrow) && (
              <button type="button" className="icon-btn" onClick={newChat} aria-label="New chat" title={`New chat (${modKey}+Shift+O)`}>
                <Icon name="plus" />
              </button>
            )}
          </div>
        </header>

        <main className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chat-inner" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
            {loadingSession && !messages.length ? (
              <ChatSkeleton />
            ) : messages.length === 0 ? (
              <EmptyState
                disabled={loading}
                backendDown={offline}
                onPick={(prompt) => dispatch({ message: prompt }, { text: prompt })}
              />
            ) : (
              messages.map((m, i) => {
                if (m.role === "assistant") {
                  return (
                    <AssistantMessage
                      key={m.id}
                      msg={m}
                      showMeta={prefs.showMeta}
                      canSpeak={speaker.supported}
                      speaking={speaker.speakingId === m.id}
                      onSpeak={() => speaker.speak(m.id, m.text)}
                      onAskAgain={i === lastAssistantIndex && !loading && messages[i - 1]?.role === "user"
                        ? () => askAgain(messages[i - 1]) : undefined}
                    />
                  );
                }
                if (m.role === "user") {
                  return (
                    <UserMessage
                      key={m.id}
                      msg={m}
                      busy={loading}
                      onAskAgain={() => askAgain(m)}
                      onEdit={() => editInComposer(m)}
                      onOpenImage={setLightbox}
                    />
                  );
                }
                if (m.role === "notice") return <NoticeMessage key={m.id} msg={m} />;
                return (
                  <ErrorMessage key={m.id} msg={m} busy={loading} onRetry={() => retry(m)} onDismiss={() => removeMessage(m.id)} />
                );
              })
            )}
            {pending && <Typing startedAt={pending.startedAt} simulating={Boolean(simulate && simulationAvailable)} />}
          </div>
        </main>

        {!atBottom && messages.length > 0 && (
          <button type="button" className="jump-btn" onClick={() => { stickRef.current = true; scrollToBottom(); }} aria-label="Jump to latest message">
            <Icon name="arrowDown" size={16} />
          </button>
        )}

        <div className="composer-wrap">
          <Composer
            textareaRef={textareaRef}
            fileRef={fileRef}
            value={input}
            onChange={setInput}
            attachments={attachments}
            onRemoveAttachment={(id) => setAttachments((l) => l.filter((a) => a.id !== id))}
            onAddFiles={addFiles}
            onOpenImage={setLightbox}
            onSend={sendFromComposer}
            onStop={stop}
            loading={loading}
            count={count}
            canSend={canSend}
            dictation={dictation}
            simulate={simulate}
            simulationAvailable={simulationAvailable}
            onClearSimulate={() => setSimulate("")}
            personaLabel={persona}
            onOpenSettings={() => setSettingsOpen(true)}
            enterToSend={prefs.enterToSend}
            onRecallLast={recallLast}
            offline={offline}
            shake={shake}
          />
        </div>
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <Icon name="paperclip" size={28} />
            <strong>Drop to attach</strong>
            <span>Images (up to {MAX_IMAGES}) or text &amp; code files</span>
          </div>
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); focusComposer(); }}
        systemPrompt={systemPrompt}
        onSystemPrompt={setSystemPrompt}
        simulate={simulate}
        onSimulate={setSimulate}
        simulationAvailable={simulationAvailable}
        prefs={prefs}
        onPref={setPref}
        speechSupported={speaker.supported}
        theme={theme}
        onTheme={setTheme}
        onClearHistory={clearHistory}
        sessionCount={sessions.length}
      />
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
