import { memo, useEffect, useState } from "react";
import { Icon } from "../icons.jsx";
import { MarkdownView } from "../markdown.jsx";
import { formatBytes } from "../attachments.js";
import { clockTime, copyText, fullTime } from "../utils.js";

export const SUGGESTIONS = [
  { icon: "globe", title: "Quick fact", prompt: "What is the capital of France?" },
  { icon: "zap", title: "Explain a concept", prompt: "Explain response caching in one sentence." },
  { icon: "code", title: "Coding help", prompt: "Give me 3 tips for writing clean Python." },
  { icon: "bulb", title: "Brainstorm", prompt: "Suggest 5 creative names for a coffee shop run by robots." },
];

function useCopy(text) {
  const [state, setState] = useState("idle");
  async function copy() {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1500);
  }
  return [state, copy];
}

function ActionButton({ icon, label, onClick, active, disabled }) {
  return (
    <button
      type="button"
      className={`msg-action ${active ? "active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/* ---------- empty state ---------- */

export function EmptyState({ onPick, disabled, backendDown }) {
  return (
    <div className="empty">
      <div className="empty-logo"><Icon name="sparkles" size={30} /></div>
      <h2 className="empty-title">How can I help you today?</h2>
      <p className="empty-sub">
        Ask anything. Replies show which model answered, how long it took and whether it came from the cache.
      </p>
      {backendDown && (
        <p className="empty-warning" role="alert">
          <Icon name="alert" size={16} /> The backend isn't reachable right now, so messages will fail until it's back.
        </p>
      )}
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button type="button" key={s.prompt} className="suggestion" disabled={disabled} onClick={() => onPick(s.prompt)}>
            <span className="suggestion-icon"><Icon name={s.icon} size={18} /></span>
            <span className="suggestion-title">{s.title}</span>
            <span className="suggestion-prompt">{s.prompt}</span>
          </button>
        ))}
      </div>
      <ul className="capabilities" aria-label="What you can do">
        <li><Icon name="mic" size={14} /> Voice input</li>
        <li><Icon name="paperclip" size={14} /> Text &amp; code files</li>
        <li><Icon name="image" size={14} /> Images (vision models)</li>
        <li><Icon name="volume" size={14} /> Read replies aloud</li>
      </ul>
    </div>
  );
}

/* ---------- assistant ---------- */

function FailoverPath({ meta }) {
  if (!meta.key_id || !meta.fallback_attempts) return null;
  const winner = Number(String(meta.key_id).split("_")[1]);
  if (!Number.isFinite(winner)) return null;
  const failed = Array.from({ length: meta.fallback_attempts }, (_, i) => winner - meta.fallback_attempts + i)
    .filter((n) => n >= 1);
  return (
    <div className="failover" aria-label={`Failover: ${meta.fallback_attempts} key(s) failed before ${meta.key_id} answered`}>
      <span className="failover-label">Failover</span>
      {failed.map((n, i) => (
        <span key={n} className="hop-step" style={{ animationDelay: `${i * 220}ms` }}>
          <span className="hop fail">key_{n}</span>
          <span className="hop-arrow" aria-hidden="true">→</span>
        </span>
      ))}
      <span className="hop ok" style={{ animationDelay: `${failed.length * 220}ms` }}>
        <Icon name="check" size={12} /> {meta.key_id}
      </span>
    </div>
  );
}

function MetaRow({ meta }) {
  const cached = meta.resolution_source === "LLM_CACHE";
  const barWidth = Math.max(3, Math.min(100, ((meta.latency_ms || 0) / 5000) * 100));
  const speed = meta.latency_ms < 1000 ? "fast" : meta.latency_ms < 3000 ? "ok" : "slow";
  return (
    <div className="meta-wrap">
      <div className="meta">
        <span className={`badge ${cached ? "cache" : "live"}`} title={cached ? "Served from the response cache — no provider call" : "Answered live by the provider"}>
          <Icon name={cached ? "zap" : "sparkles"} size={11} />
          <span data-testid="meta-source">{meta.resolution_source}</span>
        </span>
        <span className="meta-item" title="Model"><span data-testid="meta-model">{meta.model}</span></span>
        <span className={`meta-item latency ${speed}`} title="Round-trip latency">
          <span data-testid="meta-latency">{meta.latency_ms} ms</span>
          <span className="latency-bar" aria-hidden="true"><span style={{ width: `${barWidth}%` }} /></span>
        </span>
        <span className="meta-item" title="Input tokens → output tokens">
          <span data-testid="meta-input-tokens">{meta.input_tokens}</span>
          <span className="meta-arrow" aria-hidden="true">→</span>
          <span data-testid="meta-output-tokens">{meta.output_tokens}</span>
          <span className="meta-unit"> tokens</span>
        </span>
        <span className="meta-item" title="API key that answered">key {meta.key_id ?? "—"}</span>
        <span className="meta-item" title="Keys that failed before one answered">
          {meta.fallback_attempts} fallback{meta.fallback_attempts === 1 ? "" : "s"}
        </span>
      </div>
      <FailoverPath meta={meta} />
    </div>
  );
}

export const AssistantMessage = memo(function AssistantMessage({ msg, speaking, canSpeak, onSpeak, showMeta, onAskAgain }) {
  const { meta } = msg;
  const cached = meta?.resolution_source === "LLM_CACHE";
  const [copyState, copy] = useCopy(msg.text);

  return (
    <article className={`msg assistant ${msg.fresh ? "enter" : ""} ${cached && msg.fresh ? "is-cached" : ""}`} data-testid="assistant-message">
      <div className="avatar" aria-hidden="true"><Icon name="sparkles" size={16} /></div>
      <div className="msg-body">
        <div className="bubble"><MarkdownView content={msg.text} /></div>
        {showMeta && meta && <MetaRow meta={meta} />}
        <div className="msg-actions">
          <ActionButton icon={copyState === "copied" ? "check" : "copy"} label={copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy reply"} onClick={copy} />
          {canSpeak && (
            <ActionButton icon={speaking ? "stop" : "volume"} label={speaking ? "Stop reading" : "Read aloud"} onClick={onSpeak} active={speaking} />
          )}
          {onAskAgain && <ActionButton icon="refresh" label="Ask again (may be served from cache)" onClick={onAskAgain} />}
          {msg.createdAt && <time className="msg-time" dateTime={msg.createdAt} title={fullTime(msg.createdAt)}>{clockTime(msg.createdAt)}</time>}
        </div>
      </div>
    </article>
  );
});

/* ---------- user ---------- */

function FileChip({ file }) {
  return (
    <details className="file-chip">
      <summary title="Show file contents">
        <Icon name="file" size={14} />
        <span className="file-name">{file.name}</span>
        <span className="file-size">{formatBytes(file.size || 0)}</span>
      </summary>
      <pre className="file-preview">{file.text.length > 4000 ? file.text.slice(0, 4000) + "\n…" : file.text}</pre>
    </details>
  );
}

export const UserMessage = memo(function UserMessage({ msg, onAskAgain, onEdit, onOpenImage, busy }) {
  const [copyState, copy] = useCopy(msg.text || msg.payload?.message || "");
  const images = msg.images || [];
  const files = msg.files || [];
  return (
    <article className={`msg user ${msg.fresh ? "enter" : ""}`}>
      <div className="msg-body">
        {(images.length > 0 || files.length > 0 || msg.imageCount > 0) && (
          <div className="sent-attachments">
            {images.map((a) => (
              <button type="button" key={a.id} className="sent-image" onClick={() => onOpenImage(a)} aria-label={`View ${a.name}`}>
                <img src={a.dataUrl} alt={a.name} />
              </button>
            ))}
            {msg.imageCount > 0 && !images.length && (
              <span className="image-placeholder" title="Images aren't stored in the history database">
                <Icon name="image" size={14} /> {msg.imageCount} image{msg.imageCount > 1 ? "s" : ""} (not stored)
              </span>
            )}
            {files.map((f) => <FileChip key={f.id} file={f} />)}
          </div>
        )}
        {msg.text && <div className="bubble">{msg.text}</div>}
        <div className="msg-actions">
          {msg.createdAt && <time className="msg-time" dateTime={msg.createdAt} title={fullTime(msg.createdAt)}>{clockTime(msg.createdAt)}</time>}
          {msg.text && <ActionButton icon={copyState === "copied" ? "check" : "copy"} label={copyState === "copied" ? "Copied" : "Copy message"} onClick={copy} />}
          {msg.text && <ActionButton icon="pencil" label="Edit in composer" onClick={onEdit} />}
          <button
            type="button"
            className="ask-again-btn"
            title="Resend this exact message — a repeat is usually served from the cache"
            onClick={onAskAgain}
            disabled={busy}
          >
            <Icon name="refresh" size={13} /> Ask again
          </button>
        </div>
      </div>
    </article>
  );
});

/* ---------- system rows ---------- */

export function ErrorMessage({ msg, onRetry, onDismiss, busy }) {
  return (
    <div className={`msg error ${msg.fresh ? "enter shake" : ""}`} role="alert">
      <div className="avatar error-avatar" aria-hidden="true"><Icon name="alert" size={16} /></div>
      <div className="msg-body">
        <div className="bubble">
          <span className="error-text">{msg.text}</span>
          <div className="error-actions">
            {msg.retry && (
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onRetry}>
                <Icon name="refresh" size={13} /> Retry
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss}>Dismiss</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NoticeMessage({ msg }) {
  return (
    <div className="notice" role="note">
      <Icon name="info" size={14} /> {msg.text}
    </div>
  );
}

export function Typing({ startedAt, simulating }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [startedAt]);
  return (
    <div className="msg assistant enter" aria-live="polite">
      <div className="avatar thinking" aria-hidden="true"><Icon name="sparkles" size={16} /></div>
      <div className="msg-body">
        <div className="bubble typing">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="typing-label">
            {simulating ? "Simulating failover" : "Thinking"}
            {elapsed >= 2 && <span className="typing-elapsed"> · {elapsed}s</span>}
          </span>
        </div>
        {elapsed >= 15 && <p className="typing-hint">Still working — the server may be trying another key. Press Esc or Stop to cancel.</p>}
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading conversation">
      <div className="sk sk-user" />
      <div className="sk sk-assistant" />
      <div className="sk sk-user short" />
      <div className="sk sk-assistant tall" />
    </div>
  );
}
