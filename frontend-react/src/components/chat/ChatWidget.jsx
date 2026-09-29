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
const UNRESOLVED_INTENTS = new Set(["clarify_symptom", "fallback", "danger_sign_followup", "mild_symptom_followup"]);

const GREETING = { sender: "bot", text: "Hi! Ask me about ANC visits, nutrition, anemia, mental health, or describe a symptom and I'll check for danger signs." };

const SUGGESTED_PROMPTS = [
  "What foods help with anemia?",
  "What danger signs should I watch for?",
  "How often should I have ANC checkups?",
  "I've been feeling low lately",
];

// How often to poll a live conversation for new messages/status while
// this widget is open - a deliberate polling tradeoff (not a websocket)
// matching ProviderPage's own precedent elsewhere in this app: close
// enough to "live" for a triage/support chat without new push
// infrastructure. See src/live_chat.py's module docstring for the fuller
// design rationale.
const LIVE_POLL_MS = 3000;

// Anchored bottom-right with a top offset and z-30 (TopBar is z-40), so
// the header can never end up hidden behind it. The bug in the old
// vanilla-JS widget was a full-viewport panel starting at top:0 that sat
// on top of the nav bar; a corner widget (Intercom/Zendesk-style) is
// structurally incapable of doing that.
export default function ChatWidget() {
  const { t, lang } = useLang();
  const { identityKey } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [liveConv, setLiveConv] = useState(null);
  const contextRef = useRef("");
  const roundsRef = useRef(0);
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const seenLeaveRef = useRef(new Set());

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setVoiceSupported(true);
    return () => recognition.stop();
  }, []);

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = lang === "hi" ? "hi-IN" : "en-IN";
  }, [lang]);

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
    } else {
      setListening(true);
      recognition.start();
    }
  }

  // Reload this identity's own chat history whenever the logged-in
  // account/guest identity changes (login, logout, switching accounts).
  useEffect(() => {
    const saved = scopedGet(KEYS.CHAT_HISTORY);
    setMessages(saved && saved.length ? saved : [GREETING]);
    contextRef.current = "";
    roundsRef.current = 0;
    api.liveMine().then((conv) => setLiveConv(conv)).catch(() => {});
  }, [identityKey]);

  // Poll the active live conversation while one exists - the closest
  // thing to "live" this widget does, short of a websocket.
  useEffect(() => {
    if (!liveConv || liveConv.status === "closed") return;
    const iv = setInterval(async () => {
      try {
        const fresh = await api.liveGet(liveConv.id);
        setLiveConv(fresh);
      } catch {
        /* transient poll failure - next tick tries again */
      }
    }, LIVE_POLL_MS);
    return () => clearInterval(iv);
  }, [liveConv?.id, liveConv?.status]);

  // Once a live conversation closes, fold its transcript into the
  // widget's own local history (so the record isn't lost) and drop back
  // to bot-only mode for whatever the patient types next.
  useEffect(() => {
    if (!liveConv || liveConv.status !== "closed" || seenLeaveRef.current.has(liveConv.id)) return;
    seenLeaveRef.current.add(liveConv.id);
    setMessages((m) => {
      const next = [...m, { sender: "bot", text: t("chat.chatEnded") }];
      scopedSet(KEYS.CHAT_HISTORY, next.slice(-40));
      return next;
    });
    setLiveConv(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveConv?.status]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, liveConv?.messages?.length, open]);

  async function startLive(reason) {
    try {
      const conv = await api.liveStart({ reason, lang });
      setLiveConv(conv);
    } catch {
      setMessages((m) => [...m, { sender: "bot", text: "Couldn't reach a counsellor right now - please call 108/102 if this is urgent." }]);
    }
  }

  async function sendLive(text) {
    if (!liveConv) return;
    try {
      await api.liveSend(liveConv.id, text);
      const fresh = await api.liveGet(liveConv.id);
      setLiveConv(fresh);
    } catch {
      /* the next poll will resync; a single failed send isn't fatal here */
    }
  }

  async function send(overrideText) {
    const message = (overrideText ?? input).trim();
    if (!message || sending) return;
    setInput("");

    if (liveConv && liveConv.status !== "closed") {
      setSending(true);
      await sendLive(message);
      setSending(false);
      return;
    }

    const withUser = [...messages, { sender: "user", text: message }];
    setMessages(withUser);
    setSending(true);
    try {
      const data = await api.chat({
        message,
        contextMessage: contextRef.current || undefined,
        unresolvedRounds: roundsRef.current,
      });
      const withReply = [...withUser, { sender: "bot", text: data.reply, isEmergency: data.isEmergency, relatedPrompts: data.relatedPrompts, offerHuman: data.offerHuman }];
      setMessages(withReply);
      scopedSet(KEYS.CHAT_HISTORY, withReply.slice(-40));
      if (UNRESOLVED_INTENTS.has(data.intent)) {
        contextRef.current = contextRef.current ? `${contextRef.current}. ${message}` : message;
        roundsRef.current += 1;
      } else {
        contextRef.current = "";
        roundsRef.current = 0;
      }
      if (data.escalatedToLive && data.liveConversationId) {
        const conv = await api.liveGet(data.liveConversationId).catch(() => null);
        if (conv) setLiveConv(conv);
      }
    } catch {
      setMessages((m) => [...m, { sender: "bot", text: "Sorry, something went wrong reaching the assistant. Please try again." }]);
    } finally {
      setSending(false);
    }
  }

  const liveMode = !!liveConv && liveConv.status !== "closed";

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("chat.title")}
          data-print-hide
          className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-paper-ink shadow-lg shadow-black/40 hover:bg-primary-dark lg:bottom-5"
        >
          💬
        </button>
      )}

      {open && (
        <div
          style={{ top: "calc(var(--app-header-h, 5rem) + 0.75rem)" }}
          data-print-hide
          className="fixed bottom-24 right-5 z-30 flex w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2xl shadow-black/50 lg:bottom-5">
          <div className="flex items-center justify-between border-b border-border bg-bg-soft px-4 py-3">
            <span className="text-sm font-semibold text-ink">✨ {t("chat.title")}</span>
            <div className="flex items-center gap-3">
              {!liveMode && (
                <button type="button" onClick={() => startLive("Asked to talk to a person")} className="text-xs font-semibold text-primary hover:underline">
                  <i className="ph ph-headset" /> {t("chat.talkToSomeone")}
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-ink">✕</button>
            </div>
          </div>

          {liveMode && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-critical/30 bg-critical-soft px-3 py-1.5 text-xs text-critical">
              <span className="flex-1">{t("chat.emergencyStrip")}</span>
              <a href="tel:108" className="rounded-full bg-critical px-2 py-0.5 font-bold text-white">108</a>
              <a href="tel:102" className="rounded-full border border-critical/50 px-2 py-0.5">102</a>
              <a href="tel:18005990019" className="rounded-full border border-critical/50 px-2 py-0.5">KIRAN</a>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {!liveMode && messages.map((m, i) => (
              <div key={i}>
                <div className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
                  <p
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.sender === "user"
                        ? "bg-primary text-paper-ink"
                        : m.isEmergency
                        ? "border-2 border-critical bg-critical-soft font-medium text-ink"
                        : "bg-surface-hover text-ink"
                    }`}
                  >
                    {m.text}
                  </p>
                </div>
                {i === messages.length - 1 && m.sender === "bot" && !sending && m.offerHuman && (
                  <div className="mt-2">
                    <button type="button" onClick={() => startLive("Asked for a person after a symptom question")} className="rounded-full border border-primary px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary-soft">
                      <i className="ph ph-headset" /> {t("chat.talkToSomeone")}
                    </button>
                  </div>
                )}
                {i === messages.length - 1 && m.sender === "bot" && !sending && m.relatedPrompts?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.relatedPrompts.map((p) => (
                      <button key={p} type="button" onClick={() => send(p)} className="rounded-full border border-border-strong px-3 py-1.5 text-xs text-muted hover:border-primary hover:text-primary">
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {liveMode && liveConv.status === "waiting" && (
              <p className="rounded-xl border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-ink">
                <i className="ph ph-hourglass-medium" /> {t("chat.waitingForCounsellor")}
              </p>
            )}

            {liveMode && liveConv.messages.map((m) => {
              if (m.sender_kind === "system") {
                if (m.system_kind === "join") {
                  return (
                    <div key={m.id} className="rounded-2xl border border-primary bg-primary-soft p-3 text-sm text-ink">
                      <div className="mb-1 flex items-center gap-2 font-semibold text-primary"><i className="ph ph-user-check" /> {t("chat.connectedWith")}</div>
                    </div>
                  );
                }
                if (m.system_kind === "fwd") {
                  return <p key={m.id} className="text-center text-xs text-muted">{t("chat.forwardedToDoctor")}</p>;
                }
                return null;
              }
              const mine = m.sender_kind === "patient";
              const isBot = m.sender_kind === "bot";
              const isCounsellor = m.sender_kind === "counsellor";
              return (
                <div key={m.id}>
                  {isCounsellor && <div className="mb-0.5 text-[11px] font-medium text-primary">{t("chat.counsellorLabel")}</div>}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      mine ? "bg-primary text-paper-ink" : isCounsellor ? "bg-surface-hover text-ink ring-1 ring-primary/40" : isBot ? "border border-dashed border-border-strong text-muted" : "bg-surface-hover text-ink"
                    }`}>
                      {m.text}
                    </p>
                  </div>
                </div>
              );
            })}

            {sending && (
              <p className="flex items-center gap-1 text-xs text-muted" aria-live="polite">
                <span className="animate-pulse">●</span>
                <span className="animate-pulse [animation-delay:150ms]">●</span>
                <span className="animate-pulse [animation-delay:300ms]">●</span>
              </p>
            )}

            {!liveMode && messages.length === 1 && !sending && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button key={p} type="button" onClick={() => send(p)} className="rounded-full border border-border-strong px-3 py-1.5 text-xs text-muted hover:border-primary hover:text-primary">
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              aria-label={t("chat.placeholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : t("chat.placeholder")}
              className="h-11 flex-1 rounded-full border border-border-strong bg-bg px-4 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleListening}
                aria-label={listening ? "Stop voice input" : "Speak your message"}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-base transition-colors ${
                  listening ? "animate-pulse border-critical bg-critical-soft text-critical" : "border-border-strong text-muted hover:text-ink"
                }`}
              >
                🎤
              </button>
            )}
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-base text-paper-ink disabled:opacity-40"
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
