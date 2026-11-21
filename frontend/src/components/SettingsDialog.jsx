import { useEffect, useState } from "react";
import { Icon } from "../icons.jsx";
import { Modal, ModalHeader } from "./Overlay.jsx";
import { modKey } from "../utils.js";
import { defaultApiUrl, describeApiUrl } from "../api.js";

export const SYSTEM_PROMPT_PRESETS = [
  { label: "Concise", prompt: "You are a helpful assistant. Keep all answers strictly under 2 sentences." },
  { label: "Explain like I'm 10", prompt: "Explain complex concepts simply as if to a 10 year old with relatable analogies." },
  { label: "Code expert", prompt: "You are an expert software engineer. Provide clean, efficient code with brief explanations." },
  { label: "Teacher", prompt: "You are a patient teacher. Explain step by step and end with a one-line summary." },
  { label: "Pirate", prompt: "Speak like a witty 17th-century pirate in every response." },
];

export const MAX_SYSTEM_PROMPT = 4000;

const FAILURE_MODES = [
  { label: "Off", value: "", hint: "Requests go through normally." },
  { label: "key_1 → 429", value: "key_1=429", hint: "First key is rate-limited; watch the fallback to key_2." },
  { label: "key_1 → 500", value: "key_1=500", hint: "First key has a server error; watch the fallback." },
  { label: "All keys down", value: "*=429", hint: "Every key fails; you'll get the 503 error path." },
];

const SHORTCUTS = [
  [`${modKey} + Shift + O`, "New chat"],
  [`${modKey} + K`, "Search chats"],
  [`${modKey} + B`, "Toggle sidebar"],
  ["/", "Focus the message box"],
  ["Esc", "Stop a reply / close panels"],
  ["↑ (empty box)", "Edit your last message"],
];

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="toggle-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-desc">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Edits a draft; nothing is saved (or health-checked) until Save / Enter. */
function BackendField({ apiUrl, overridden, onSave, health, open }) {
  const [draft, setDraft] = useState(apiUrl);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setDraft(apiUrl); setError(null); } }, [open, apiUrl]);

  const dirty = draft.trim() !== apiUrl;
  const save = (value = draft) => setError(onSave(value));
  const status = !health ? ["checking", "Checking…"] : health.reachable ? ["ok", "Connected"] : ["bad", "Unreachable"];

  return (
    <section className="settings-section">
      <h3><Icon name="monitor" size={15} /> Backend connection</h3>
      <p className="section-desc">
        Advanced: where this app sends requests. Leave it on the default unless you run your own backend.
      </p>
      <form className="backend-row" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          className="text-input"
          value={draft}
          aria-label="Backend URL"
          aria-invalid={Boolean(error) || undefined}
          placeholder={`Default — ${describeApiUrl(defaultApiUrl())}`}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty}>Save</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="field-footer">
        <span className={`conn-status ${status[0]}`}>● {status[1]} · {describeApiUrl(apiUrl)}</span>
        {overridden && (
          <button type="button" className="link-btn" onClick={() => { setDraft(""); save(""); }}>
            Reset to default
          </button>
        )}
      </div>
    </section>
  );
}

export function SettingsDialog({
  open, onClose, systemPrompt, onSystemPrompt, simulate, onSimulate, simulationAvailable,
  prefs, onPref, speechSupported, theme, onTheme, onClearHistory, sessionCount,
  apiUrl, apiOverridden, onApiUrl, healthStatus,
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => { if (!open) setConfirmClear(false); }, [open]);

  const activeMode = FAILURE_MODES.find((m) => m.value === simulate);
  const promptLen = systemPrompt.length;

  return (
    <Modal open={open} onClose={onClose} title="Settings" className="settings-modal">
      <ModalHeader title="Settings" subtitle="Changes apply to your next message." onClose={onClose} />
      <div className="modal-body">
        <section className="settings-section">
          <h3><Icon name="sliders" size={15} /> Custom instructions</h3>
          <p className="section-desc">
            A system prompt that shapes every reply. It's saved with the chat on the server, so later messages keep it.
          </p>
          <div className="presets" role="group" aria-label="Instruction presets">
            {SYSTEM_PROMPT_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={`chip ${systemPrompt === p.prompt ? "on" : ""}`}
                aria-pressed={systemPrompt === p.prompt}
                onClick={() => onSystemPrompt(systemPrompt === p.prompt ? "" : p.prompt)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="field">
            <textarea
              data-testid="system-prompt-input"
              data-autofocus
              rows={4}
              value={systemPrompt}
              maxLength={MAX_SYSTEM_PROMPT}
              aria-label="System prompt"
              placeholder="e.g. You are a concise assistant who answers in bullet points."
              onChange={(e) => onSystemPrompt(e.target.value)}
            />
            <div className="field-footer">
              <span className={promptLen > MAX_SYSTEM_PROMPT * 0.9 ? "warn" : ""}>{promptLen} / {MAX_SYSTEM_PROMPT}</span>
              {systemPrompt && <button type="button" className="link-btn" onClick={() => onSystemPrompt("")}>Clear</button>}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h3><Icon name="zap" size={15} /> Failover simulation</h3>
          {simulationAvailable ? (
            <>
              <p className="section-desc">
                Sends the <code>X-Simulate-Failure</code> header with your next message to show how the key pool fails over. Resets automatically.
              </p>
              <div className="segmented" role="radiogroup" aria-label="Failure mode">
                {FAILURE_MODES.map((m) => (
                  <button
                    type="button"
                    key={m.label}
                    role="radio"
                    aria-checked={simulate === m.value}
                    className={`${simulate === m.value ? "on" : ""} ${m.value ? "danger" : ""}`}
                    onClick={() => onSimulate(m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="section-hint">{activeMode ? activeMode.hint : "Custom failure pattern."}</p>
              <input
                className="text-input"
                value={simulate}
                aria-label="Custom failure pattern"
                placeholder="Custom, e.g. key_1=429,key_2=500"
                onChange={(e) => onSimulate(e.target.value)}
              />
            </>
          ) : (
            <p className="section-desc muted-box">
              <Icon name="info" size={14} /> Disabled on this server. Set <code>ENABLE_FAILURE_SIMULATION=true</code> on the backend to use it.
            </p>
          )}
        </section>

        <section className="settings-section">
          <h3><Icon name="monitor" size={15} /> Appearance &amp; behaviour</h3>
          <div className="theme-picker" role="radiogroup" aria-label="Theme">
            {[["system", "monitor", "System"], ["light", "sun", "Light"], ["dark", "moon", "Dark"]].map(([value, icon, label]) => (
              <button key={value} type="button" role="radio" aria-checked={theme === value} className={theme === value ? "on" : ""} onClick={() => onTheme(value)}>
                <Icon name={icon} size={15} /> {label}
              </button>
            ))}
          </div>
          <Toggle
            label="Show response details"
            description="Source (live / cache), model, latency, tokens and key under each reply."
            checked={prefs.showMeta}
            onChange={(v) => onPref("showMeta", v)}
          />
          <Toggle
            label="Enter sends the message"
            description={`Off: use ${modKey}+Enter to send, Enter for a new line.`}
            checked={prefs.enterToSend}
            onChange={(v) => onPref("enterToSend", v)}
          />
          {speechSupported && (
            <Toggle
              label="Read replies aloud"
              description="Speaks each new reply with your browser's voice."
              checked={prefs.autoRead}
              onChange={(v) => onPref("autoRead", v)}
            />
          )}
        </section>

        <section className="settings-section">
          <h3><Icon name="keyboard" size={15} /> Keyboard shortcuts</h3>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={what}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>
            ))}
          </dl>
        </section>

        <BackendField apiUrl={apiUrl} overridden={apiOverridden} onSave={onApiUrl} health={healthStatus} open={open} />

        <section className="settings-section danger-zone">
          <h3><Icon name="trash" size={15} /> Data</h3>
          <p className="section-desc">Delete every chat in this browser's history ({sessionCount}) from the list and from the server database.</p>
          <button
            type="button"
            className={`btn ${confirmClear ? "btn-danger" : "btn-outline-danger"}`}
            disabled={!sessionCount}
            onClick={() => {
              if (!confirmClear) { setConfirmClear(true); return; }
              setConfirmClear(false);
              onClearHistory();
            }}
          >
            {confirmClear ? "Click again to delete everything" : "Delete all chats"}
          </button>
        </section>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
