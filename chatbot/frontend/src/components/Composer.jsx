import { useLayoutEffect } from "react";
import { Icon } from "../icons.jsx";
import { ACCEPT, MAX_IMAGES, MAX_MESSAGE, formatBytes } from "../attachments.js";
import { modKey } from "../utils.js";

const MAX_HEIGHT = 220;

export function Composer({
  textareaRef, fileRef, value, onChange, attachments, onRemoveAttachment, onAddFiles, onOpenImage,
  onSend, onStop, loading, count, canSend, dictation, simulate, simulationAvailable, onClearSimulate,
  personaLabel, onOpenSettings, enterToSend, onRecallLast, offline, shake,
}) {
  const imageCount = attachments.filter((a) => a.kind === "image").length;
  const tooLong = count > MAX_MESSAGE;
  const showCounter = count >= MAX_MESSAGE * 0.8;

  // grow with the content (also after dictation or "Edit" fill the box programmatically)
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value, textareaRef]);

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      const wantsSend = enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey);
      if (wantsSend) {
        e.preventDefault();
        onSend();
        return;
      }
    }
    if (e.key === "ArrowUp" && !value && !e.shiftKey) {
      if (onRecallLast()) e.preventDefault();
    }
    if (e.key === "Escape" && loading) {
      e.preventDefault();
      onStop();
    }
  }

  return (
    <form
      className={`composer ${simulate ? "simulating" : ""} ${shake ? "shake" : ""}`}
      onSubmit={(e) => { e.preventDefault(); loading ? onStop() : onSend(); }}
    >
      {offline && (
        <div className="composer-banner warn" role="status">
          <Icon name="alert" size={14} /> Backend unreachable — messages can't be sent until it's back.
        </div>
      )}
      {simulate && simulationAvailable && (
        <div className="composer-banner danger" role="status">
          <Icon name="zap" size={14} />
          <span>Failover simulation armed: <code>{simulate}</code> — applies to the next message only.</span>
          <button type="button" className="banner-btn" onClick={onClearSimulate}>Cancel</button>
        </div>
      )}

      <div className="composer-box">
        {attachments.length > 0 && (
          <ul className="pending" aria-label="Attachments">
            {attachments.map((a) => (
              <li key={a.id} className={`pending-item ${a.kind}`}>
                {a.kind === "image" ? (
                  <button type="button" className="pending-thumb" onClick={() => onOpenImage(a)} aria-label={`Preview ${a.name}`}>
                    <img src={a.dataUrl} alt="" />
                  </button>
                ) : (
                  <span className="pending-file-icon"><Icon name="file" size={16} /></span>
                )}
                <span className="pending-info">
                  <span className="pending-name" title={a.name}>{a.name}</span>
                  <span className="pending-size">{a.kind === "image" ? "Image" : "Text"} · {formatBytes(a.size || 0)}</span>
                </span>
                <button type="button" className="pending-remove" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => onRemoveAttachment(a.id)}>
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="chat-input" className="sr-only">Message</label>
        <textarea
          id="chat-input"
          ref={textareaRef}
          data-testid="chat-input"
          rows={1}
          value={value}
          maxLength={MAX_MESSAGE * 4}
          placeholder={dictation.listening ? "Listening… speak now" : "Message the assistant…"}
          aria-describedby="composer-hint"
          aria-invalid={tooLong || undefined}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length) {
              e.preventDefault();
              onAddFiles(files);
            }
          }}
          onKeyDown={onKeyDown}
        />

        <div className="composer-toolbar">
          <div className="toolbar-left">
            <button
              type="button"
              className="tool-btn"
              title={imageCount >= MAX_IMAGES ? `Attach text/code files (image limit of ${MAX_IMAGES} reached)` : "Attach images or text/code files"}
              aria-label="Attach files"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="paperclip" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(e) => {
                onAddFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {dictation.supported && (
              <button
                type="button"
                className={`tool-btn mic ${dictation.listening ? "listening" : ""}`}
                title={dictation.listening ? "Stop listening" : "Speak your message"}
                aria-label={dictation.listening ? "Stop voice input" : "Start voice input"}
                aria-pressed={dictation.listening}
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start(value))}
              >
                <Icon name="mic" />
              </button>
            )}
            <button
              type="button"
              className={`persona-chip ${personaLabel ? "on" : ""}`}
              onClick={onOpenSettings}
              title={personaLabel ? "Custom instructions are active — click to edit" : "Add custom instructions (system prompt)"}
            >
              <Icon name="sliders" size={13} />
              <span>{personaLabel || "Instructions"}</span>
            </button>
          </div>

          <div className="toolbar-right">
            {showCounter && (
              <span className={`counter ${tooLong ? "over" : "near"}`} aria-live="polite">
                {count.toLocaleString()} / {MAX_MESSAGE.toLocaleString()}
              </span>
            )}
            {loading ? (
              <button type="submit" className="send-btn stop" aria-label="Stop generating" title="Stop (Esc)" data-testid="send-button">
                <Icon name="stop" />
              </button>
            ) : (
              <button
                data-testid="send-button"
                type="submit"
                className="send-btn"
                disabled={!canSend}
                aria-label="Send message"
                title={tooLong ? `Message is too long (max ${MAX_MESSAGE.toLocaleString()} characters)` : "Send"}
              >
                <Icon name="send" />
              </button>
            )}
          </div>
        </div>
      </div>
      <p id="composer-hint" className="composer-hint">
        {tooLong
          ? <span className="hint-error">Too long by {(count - MAX_MESSAGE).toLocaleString()} characters (attached files count too).</span>
          : enterToSend
            ? <><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · drop or paste files</>
            : <><kbd>{modKey}</kbd>+<kbd>Enter</kbd> to send · <kbd>Enter</kbd> new line · drop or paste files</>}
      </p>
    </form>
  );
}
