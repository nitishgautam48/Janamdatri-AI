import { useState } from "react";
import { useLang } from "../../context/LangContext";

// Browser-native text-to-speech (window.speechSynthesis) - the output-side
// complement to ChatWidget's voice input, and genuinely useful for a
// low-literacy user or anyone who'd rather listen to a result than read
// it. No backend/API involved; renders nothing where the API is missing.
export default function ReadAloudButton({ text, className = "" }) {
  const { lang } = useLang();
  const [speaking, setSpeaking] = useState(false);

  if (typeof window === "undefined" || !window.speechSynthesis || !text) return null;

  function toggle() {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "hi" ? "hi-IN" : "en-IN";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border-strong px-2.5 py-1 text-xs font-medium text-muted hover:border-primary hover:text-primary ${className}`}
    >
      {speaking ? "⏹ Stop" : "🔊 Read aloud"}
    </button>
  );
}
