import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons.jsx";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible modal: Escape closes, focus moves in and is trapped, then restored on close. */
export function Modal({ open, onClose, title, className = "", children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const node = ref.current;
    const previous = document.activeElement;
    const items = () => Array.from(node.querySelectorAll(FOCUSABLE));
    (node.querySelector("[data-autofocus]") || items()[0] || node).focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        const f = items();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    node.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      node.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${className}`} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div className="modal-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
        <Icon name="x" />
      </button>
    </div>
  );
}

/** Full-size image viewer. */
export function Lightbox({ image, onClose }) {
  return (
    <Modal open={Boolean(image)} onClose={onClose} title={image?.name || "Image"} className="lightbox">
      {image && (
        <>
          <button type="button" className="icon-btn lightbox-close" onClick={onClose} aria-label="Close image" data-autofocus>
            <Icon name="x" />
          </button>
          <img src={image.dataUrl} alt={image.name} />
          <p className="lightbox-caption">{image.name}</p>
        </>
      )}
    </Modal>
  );
}

/* ---------- toasts ---------- */

let toastId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback((text, kind = "info", { duration, action } = {}) => {
    const id = toastId++;
    setToasts((list) => {
      // don't stack the same message twice
      const rest = list.filter((t) => t.text !== text);
      return [...rest.slice(-3), { id, text, kind, action }];
    });
    const ms = duration ?? (kind === "error" ? 6000 : 3500);
    timers.current.set(id, setTimeout(() => dismiss(id), ms));
    return id;
  }, [dismiss]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === "error" ? "alert" : t.kind === "success" ? "check" : "info"} size={16} />
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button type="button" className="toast-action" onClick={() => { t.action.onClick(); onDismiss(t.id); }}>
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
