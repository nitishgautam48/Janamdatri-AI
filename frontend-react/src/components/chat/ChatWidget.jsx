import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useLang } from "../../context/LangContext";
import { useAuth } from "../../context/AuthContext";
import { KEYS, scopedGet, scopedSet } from "../../lib/storage";

// Same set the backend uses to decide a reply was a clarifying question or
// generic fallback rather than a real answer - mirrors the vanilla-JS
// widget's UNRESOLVED_CHAT_INTENTS so the follow-up-context behavior is
// identical, just re-hosted in a corner panel instead of a full-viewport
// one (see the comment below on why that's the actual bug fix).
const UNRESOLVED_INTENTS = new Set(["clarify_symptom", "fallback"]);

const GREETING = { sender: "bot", text: "Hi! Ask me about ANC visits, nutrition, anemia, mental health, or describe a symptom and I'll check for danger signs." };

// Anchored bottom-right with a top offset and z-30 (TopNav is z-40), so
// the header can never end up hidden behind it. The bug in the old
// vanilla-JS widget was a full-viewport panel starting at top:0 that sat
// on top of the nav bar; a corner widget (Intercom/Zendesk-style) is
// structurally incapable of doing that.
export default function ChatWidget() {
  const { t } = useLang();
  const { identityKey } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const contextRef = useRef("");
  const roundsRef = useRef(0);
  const scrollRef = useRef(null);

  // Reload this identity's own chat history whenever the logged-in
  // account/guest identity changes (login, logout, switching accounts).
  useEffect(() => {
    const saved = scopedGet(KEYS.CHAT_HISTORY);
    setMessages(saved && saved.length ? saved : [GREETING]);
    contextRef.current = "";
    roundsRef.current = 0;
  }, [identityKey]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    const withUser = [...messages, { sender: "user", text: message }];
    setMessages(withUser);
    setInput("");
    setSending(true);
    try {
      const data = await api.chat({
        message,
        contextMessage: contextRef.current || undefined,
        unresolvedRounds: roundsRef.current,
      });
      const withReply = [...withUser, { sender: "bot", text: data.reply, isEmergency: data.isEmergency }];
      setMessages(withReply);
      scopedSet(KEYS.CHAT_HISTORY, withReply.slice(-40));
      if (UNRESOLVED_INTENTS.has(data.intent)) {
        contextRef.current = contextRef.current ? `${contextRef.current}. ${message}` : message;
        roundsRef.current += 1;
      } else {
        contextRef.current = "";
        roundsRef.current = 0;
      }
    } catch {
      setMessages((m) => [...m, { sender: "bot", text: "Sorry, something went wrong reaching the assistant. Please try again." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("chat.title")}
          className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-paper-ink shadow-lg shadow-black/40 hover:bg-primary-dark"
        >
          💬
        </button>
      )}

      {open && (
        <div
          style={{ top: "calc(var(--app-header-h, 5rem) + 0.75rem)" }}
          className="fixed bottom-5 right-5 z-30 flex w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-border bg-bg-soft px-4 py-3">
            <span className="text-sm font-semibold text-ink">💬 {t("chat.title")}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-ink">
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    m.sender === "user"
                      ? "bg-primary text-paper-ink"
                      : m.isEmergency
                      ? "border border-critical/40 bg-critical-soft text-ink"
                      : "bg-surface-hover text-ink"
                  }`}
                >
                  {m.text}
                </p>
              </div>
            ))}
            {sending && <p className="text-xs text-muted">…</p>}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("chat.placeholder")}
              className="flex-1 rounded-full border border-border-strong bg-bg px-4 py-2 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-paper-ink disabled:opacity-40"
              aria-label="Send"
            >
              ➤
            </button>
          </form>
        </div>
      )}
    </>
  );
}
