import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useLang } from "../../context/LangContext";
import { useAuth } from "../../context/AuthContext";
import { KEYS, scopedGet, scopedSet } from "../../lib/storage";
import { connectWs } from "../../lib/ws";
import { startLiveStt } from "../../lib/live-stt";
import { createVoiceCall } from "../../lib/voice-call";

// Joins whichever of these text fragments are non-empty with a single
// space - used to compose (already-typed text) + (finalized speech so
// far this listening session) + (the current in-progress partial guess)
// into one live-updating input value.
function joinParts(...parts) {
  return parts.filter(Boolean).join(" ");
}

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

// A live conversation now updates over WebSocket (/ws/live/{id}, see
// src/ws_manager.py) the instant a new message/status change arrives, so
// this is only a slow backstop poll for the rare case a socket drops
// without the browser noticing (a suspended tab, a flaky network).
const LIVE_POLL_MS = 20000;

// How long a still-"waiting" request sits before the widget stops
// assuming a claim is imminent and instead nudges toward 108/102 - covers
// the case where counsellors ARE on duty but all busy, which
// counsellors_on_duty alone can't distinguish from "about to be claimed".
const LIVE_WAIT_WARNING_MS = 90000;

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
  // Decided once at mount (see the effect below) rather than per press: a
  // self-hosted attempt that fails only discovers that AFTER recording and
  // uploading a clip, which would mean silently re-listening for the same
  // thing a second time with no way to explain why. "browser" is the safe
  // starting point every existing install already works with; it only
  // flips to "self-hosted" once /stt/status confirms a model is actually
  // configured there.
  const [sttMode, setSttMode] = useState("browser");
  const [liveConv, setLiveConv] = useState(null);
  const contextRef = useRef("");
  const roundsRef = useRef(0);
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  // Holds the Promise returned by startLiveStt (it's async - awaits
  // getUserMedia) while a self-hosted streaming session is active, so
  // stopping it can await the same promise rather than racing a ref that
  // might not be populated yet if the user taps stop very quickly.
  const liveSttRef = useRef(null);
  const baseInputRef = useRef(""); // whatever was already typed before this listening session started
  const finalizedRef = useRef(""); // speech committed as "final" so far this listening session
  const seenLeaveRef = useRef(new Set());
  // The counsellor actually hearing the patient's voice (see lib/voice-
  // call.js) - a separate feature from the mic button above, which only
  // ever turns speech into chat text. "idle" | "calling" | "ringing" | "connected".
  const [callState, setCallState] = useState("idle");
  const voiceCallRef = useRef(null);
  const remoteAudioRef = useRef(null);

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

  // Self-hosted speech-to-text (Vosk, see src/stt.py) streams the mic to
  // /ws/stt and keeps transcription on this server instead of sending the
  // recording to Google's speech servers the way the browser's own
  // SpeechRecognition does - see the Privacy page's AI disclosure. Only
  // switches to it when the backend confirms a model is actually loaded
  // AND this browser can capture audio at all; otherwise the existing
  // browser recognizer above keeps working exactly as before.
  useEffect(() => {
    if (!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext))) return;
    api.sttStatus().then((status) => {
      if (status.configured) {
        setSttMode("self-hosted");
        setVoiceSupported(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // hinglish speech is phonetically Hindi with English words mixed in, not
    // English with an accent - hi-IN handles that code-switching far better
    // than en-IN. Only pure English mode should ask for en-IN. (Previously
    // this fell through to en-IN for hinglish too, silently mis-recognizing
    // most of what a Hinglish-speaking patient actually says.)
    if (recognitionRef.current) recognitionRef.current.lang = lang === "en" ? "en-IN" : "hi-IN";
  }, [lang]);

  async function toggleListening() {
    if (listening) {
      setListening(false);
      if (sttMode === "self-hosted") {
        const controller = await liveSttRef.current;
        controller?.stop();
      } else {
        recognitionRef.current?.stop();
      }
      return;
    }
    setListening(true);
    if (sttMode === "self-hosted") {
      baseInputRef.current = input;
      finalizedRef.current = "";
      liveSttRef.current = startLiveStt({
        // Partials update the input live, word by word, while still
        // talking - replaced wholesale each time rather than appended,
        // since a partial is Vosk's whole current-utterance guess so far,
        // not an incremental new fragment.
        onPartial: (text) => setInput(joinParts(baseInputRef.current, finalizedRef.current, text)),
        onFinal: (text) => {
          if (text) finalizedRef.current = joinParts(finalizedRef.current, text);
          setInput(joinParts(baseInputRef.current, finalizedRef.current));
        },
        onUnavailable: () => {
          // No model configured server-side, mic access denied, or the
          // socket couldn't connect - fall back to the browser recognizer
          // for the rest of this session, same as the old record-then-
          // upload path's failure handling did.
          setSttMode("browser");
          recognitionRef.current?.start();
        },
      });
    } else {
      recognitionRef.current?.start();
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

  // Refetch the active live conversation the instant something changes
  // (WebSocket push), plus a slow backstop poll in case a socket drops
  // silently. Both call the same api.liveGet the old fixed-interval poll
  // used, so there's one code path either way.
  useEffect(() => {
    if (!liveConv || liveConv.status === "closed") return;
    async function refetch() {
      try {
        setLiveConv(await api.liveGet(liveConv.id));
      } catch {
        /* transient failure - next tick/push tries again */
      }
    }
    const iv = setInterval(refetch, LIVE_POLL_MS);
    const disconnectWs = connectWs(`/ws/live/${liveConv.id}`, {
      onMessage: (msg) => {
        if (msg.type === "webrtc_signal") voiceCallRef.current?.handleSignal(msg);
        else refetch();
      },
    });
    voiceCallRef.current = createVoiceCall({
      wsSend: disconnectWs.send,
      onRemoteStream: (stream) => { if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream; },
      onStateChange: setCallState,
      onIncomingCall: () => {}, // the "ringing" state alone drives the incoming-call UI below
    });
    return () => {
      clearInterval(iv);
      disconnectWs();
      voiceCallRef.current?.hangUp();
      voiceCallRef.current = null;
    };
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

  // The patient's way back to the assistant when no one's claimed the
  // request - see live_chat.py's cancel(), only reachable while still
  // "waiting" (once a counsellor has joined, leaving goes through their
  // resolve/handoff flow instead, since a real person is now involved).
  //
  // Deliberately NOT optimistic: an earlier version cleared local state
  // before the server confirmed the cancel, so a counsellor claiming the
  // request in the same instant (cancel then loses the race server-side,
  // 409) silently dropped the patient back to bot mode while a real
  // person was now waiting on the other end of a conversation nobody was
  // watching anymore. Only commit to bot mode once /cancel actually
  // succeeds; on any failure (already claimed, or just offline) re-sync
  // with the server's real state instead of guessing.
  async function cancelLive() {
    if (!liveConv) return;
    const convId = liveConv.id;
    try {
      await api.liveCancel(convId);
      setLiveConv(null);
      setMessages((m) => {
        const next = [...m, { sender: "bot", text: t("chat.cancelledMessage") }];
        scopedSet(KEYS.CHAT_HISTORY, next.slice(-40));
        return next;
      });
    } catch {
      try {
        setLiveConv(await api.liveGet(convId));
      } catch {
        /* also offline - leave state as-is, the next poll/WS push retries */
      }
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

          {/* Voice call - hearing the counsellor directly, separate from
              the mic button below (which only ever turns speech into chat
              text). Only offered once a counsellor has actually joined. */}
          {liveMode && liveConv.status === "claimed" && callState === "idle" && (
            <button
              type="button"
              onClick={() => voiceCallRef.current?.startCall()}
              className="flex items-center justify-center gap-1.5 border-b border-border bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              <i className="ph ph-phone-call" /> {t("chat.voiceCall")}
            </button>
          )}
          {liveMode && callState === "calling" && (
            <div className="flex items-center justify-center gap-2 border-b border-border bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
              <span className="animate-pulse"><i className="ph ph-phone-outgoing" /></span> {t("chat.callCalling")}
              <button type="button" onClick={() => voiceCallRef.current?.hangUp()} className="ml-2 rounded-full bg-critical px-2 py-0.5 text-white">{t("chat.callHangUp")}</button>
            </div>
          )}
          {liveMode && callState === "ringing" && (
            <div className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
              <i className="ph ph-phone-incoming animate-pulse" /> {t("chat.callIncoming")}
              <button type="button" onClick={() => voiceCallRef.current?.acceptCall()} className="rounded-full bg-primary px-2 py-0.5 text-paper-ink">{t("chat.callAccept")}</button>
              <button type="button" onClick={() => voiceCallRef.current?.declineCall()} className="rounded-full border border-critical/50 px-2 py-0.5 text-critical">{t("chat.callDecline")}</button>
            </div>
          )}
          {liveMode && callState === "connected" && (
            <div className="flex items-center justify-center gap-2 border-b border-border bg-good-soft px-3 py-1.5 text-xs font-semibold text-good">
              <i className="ph ph-phone-call" /> {t("chat.callConnected")}
              <button type="button" onClick={() => voiceCallRef.current?.hangUp()} className="ml-2 rounded-full bg-critical px-2 py-0.5 text-white">{t("chat.callHangUp")}</button>
            </div>
          )}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

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

            {liveMode && liveConv.status === "waiting" && (() => {
              const noOneOnDuty = liveConv.counsellors_on_duty === 0;
              const waitedTooLong = Date.now() - liveConv.created_at * 1000 > LIVE_WAIT_WARNING_MS;
              const waitingText = noOneOnDuty
                ? t("chat.noCounsellorOnDuty")
                : waitedTooLong
                  ? t("chat.waitingTooLong")
                  : t("chat.waitingForCounsellor");
              return (
                <div className="space-y-2">
                  <p className="rounded-xl border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-ink">
                    <i className="ph ph-hourglass-medium" /> {waitingText}
                  </p>
                  <button
                    type="button"
                    onClick={cancelLive}
                    className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-muted hover:border-primary hover:text-primary"
                  >
                    <i className="ph ph-x-circle" /> {t("chat.cancelWaiting")}
                  </button>
                </div>
              );
            })()}

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
                if (m.system_kind === "unclaim") {
                  return (
                    <p key={m.id} className="rounded-xl border border-dashed border-warning/60 bg-warning-soft px-3 py-2 text-center text-xs leading-relaxed text-ink">
                      <i className="ph ph-user-minus" /> {t("chat.counsellorSteppedAway")}
                    </p>
                  );
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
                disabled={callState !== "idle"}
                title={callState !== "idle" ? t("chat.micDisabledDuringCall") : undefined}
                aria-label={listening ? "Stop voice input" : "Speak your message"}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-base transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
