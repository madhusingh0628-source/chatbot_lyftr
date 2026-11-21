import { useCallback, useEffect, useRef, useState } from "react";

// Voice IN: browser speech recognition (Chrome, Edge, Safari). Hidden where unsupported.
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

const DICTATION_ERRORS = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser's site settings.",
  "service-not-allowed": "Speech recognition is not allowed in this browser.",
  "no-speech": "No speech was detected. Try again and speak a little louder.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs an internet connection.",
};

export function useDictation(onText, onError) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const handlers = useRef({ onText, onError });
  handlers.current = { onText, onError };
  const supported = Boolean(Recognition);

  const start = useCallback((baseText) => {
    if (!supported || recRef.current) return;
    const rec = new Recognition();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;              // show words while you speak
    rec.continuous = false;                 // stop after a pause
    rec.onresult = (e) => {
      const spoken = Array.from(e.results).map((r) => r[0].transcript).join("");
      handlers.current.onText((baseText?.trim() ? baseText.trimEnd() + " " : "") + spoken);
    };
    rec.onend = () => { recRef.current = null; setListening(false); };
    rec.onerror = (e) => {
      if (e.error !== "aborted") handlers.current.onError?.(DICTATION_ERRORS[e.error] || "Voice input stopped unexpectedly.");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      handlers.current.onError?.("Could not start voice input.");
    }
  }, [supported]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  useEffect(() => () => recRef.current?.abort(), []);
  return { supported, listening, start, stop };
}

/** Markdown -> something pleasant to hear (no asterisks, hashes or code read out). */
export function speakableText(text) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " (code block omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Voice OUT: read replies aloud with the browser's built-in voices.
export function useSpeaker() {
  const supported = "speechSynthesis" in globalThis;
  const [speakingId, setSpeakingId] = useState(null);
  const speakingRef = useRef(null);

  const stop = useCallback(() => {
    if (!supported) return;
    speechSynthesis.cancel();
    speakingRef.current = null;
    setSpeakingId(null);
  }, [supported]);

  const speak = useCallback((id, text) => {
    if (!supported) return;
    const wasSpeaking = speakingRef.current === id;
    speechSynthesis.cancel();
    if (wasSpeaking) { speakingRef.current = null; setSpeakingId(null); return; }   // second click = stop
    const u = new SpeechSynthesisUtterance(speakableText(text));
    u.lang = navigator.language || "en-US";
    u.onend = u.onerror = () => {
      if (speakingRef.current === id) { speakingRef.current = null; setSpeakingId(null); }
    };
    speakingRef.current = id;
    setSpeakingId(id);
    speechSynthesis.speak(u);
  }, [supported]);

  useEffect(() => () => { if (supported) speechSynthesis.cancel(); }, [supported]);
  return { supported, speakingId, speak, stop };
}
