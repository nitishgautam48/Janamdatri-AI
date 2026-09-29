import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import { api } from "../lib/api";
import { severityLabel } from "../lib/severity";

const SEVERITY_TONE = {
  Critical: { bg: "var(--color-critical-soft)", fg: "var(--color-critical)" },
  Severe: { bg: "var(--color-critical-soft)", fg: "var(--color-critical)" },
  Moderate: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)" },
  Mild: { bg: "var(--color-good-soft)", fg: "var(--color-good)" },
  Minimal: { bg: "var(--color-good-soft)", fg: "var(--color-good)" },
};
const SEVERITY_RANK = { Critical: 4, Severe: 3, Moderate: 2, Mild: 1, Minimal: 0 };

function SeverityTag({ level, style }) {
  const { t } = useLang();
  const tone = SEVERITY_TONE[level] || { bg: "var(--color-neutral-800)", fg: "var(--color-neutral-100)" };
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, padding: "3px 10px", borderRadius: 8, background: tone.bg, color: tone.fg, ...style }}>{severityLabel(t, level)}</span>;
}
const OUTCOMES = [
  { id: "care", labelKey: "counsellor.outcomeCare", icon: "ph-hospital" },
  { id: "chat", labelKey: "counsellor.outcomeChat", icon: "ph-chat-circle-text" },
  { id: "emer", labelKey: "counsellor.outcomeEmergency", icon: "ph-ambulance" },
  { id: "doc", labelKey: "counsellor.outcomeDoctor", icon: "ph-stethoscope" },
];
const QUEUE_POLL_MS = 4000;
const CONV_POLL_MS = 3000;

function timeAgo(ts) {
  const sec = Math.max(0, Math.floor((Date.now() / 1000 - ts)));
  const m = Math.floor(sec / 60);
  if (m < 1) return `${sec}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ReasonIcon({ source }) {
  const icon = source === "self_harm" ? "ph-heart-break" : source === "danger_sign" ? "ph-drop" : "ph-user-sound";
  return <i className={`ph ${icon}`} />;
}

function EmergencyDialog({ onClose }) {
  const { t } = useLang();
  const nums = [
    { num: "108", desc: t("counsellor.ambulanceDesc") },
    { num: "102", desc: t("counsellor.transportDesc") },
    { num: "1800-599-0019", desc: t("counsellor.kiranDesc") },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16, background: "rgba(16,18,28,0.72)", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(400px,100%)", display: "grid", gap: 12, padding: 20, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ fontSize: 18, fontWeight: 500 }}>{t("counsellor.emergencyNumbersTitle")}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-muted)" }}>{t("counsellor.emergencyNumbersBody")}</div>
        {nums.map((n) => (
          <a key={n.num} href={`tel:${n.num.replace(/\D/g, "")}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, border: "1px solid var(--color-critical)", textDecoration: "none", color: "var(--color-ink)" }}>
            <i className="ph ph-phone-call" style={{ fontSize: 22, color: "var(--color-critical)" }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 16, fontWeight: 500 }}>{n.num}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-muted)" }}>{n.desc}</span>
            </span>
          </a>
        ))}
        <button type="button" onClick={onClose} className="btn btn-secondary">{t("counsellor.close")}</button>
      </div>
    </div>
  );
}

function ResolveDialog({ conv, onClose, onResolve }) {
  const { t } = useLang();
  const [outcome, setOutcome] = useState("care");
  const [note, setNote] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16, background: "rgba(16,18,28,0.72)", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px,100%)", display: "grid", gap: 14, padding: 20, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ fontSize: 18, fontWeight: 500 }}>{t("counsellor.resolveTitle")}<div style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 400 }}>{conv.patient_name} · {conv.id.slice(0, 8)}</div></div>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.outcomeLabel")}</div>
          {OUTCOMES.map((o) => (
            <button
              key={o.id} type="button" onClick={() => setOutcome(o.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, border: `1px solid ${outcome === o.id ? "var(--color-primary)" : "var(--color-border)"}`, background: outcome === o.id ? "var(--color-primary-soft)" : "none", cursor: "pointer", textAlign: "left", width: "100%" }}
            >
              <i className={`ph ${o.icon}`} style={{ color: "var(--color-muted)" }} />
              <span style={{ fontSize: 14 }}>{t(o.labelKey)}</span>
            </button>
          ))}
        </div>
        <div className="field"><label>{t("counsellor.noteOptionalLabel")}</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5, color: "var(--color-muted)" }}>
          <i className="ph ph-info" style={{ marginTop: 2 }} />{t("counsellor.resolveInfo")}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">{t("counsellor.cancel")}</button>
          <button type="button" onClick={() => onResolve(outcome, note)} className="btn btn-primary"><i className="ph ph-check" /> {t("counsellor.resolveButton")}</button>
        </div>
      </div>
    </div>
  );
}

function HandoffDialog({ conv, onClose, onSend }) {
  const { t } = useLang();
  const [note, setNote] = useState(`${conv.patient_name}, ${conv.severity_level} (${conv.reason}).`);
  const [urgency, setUrgency] = useState(SEVERITY_RANK[conv.severity_level] >= 3 ? "hour" : "today");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16, background: "rgba(16,18,28,0.72)", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px,100%)", display: "grid", gap: 14, padding: 20, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ph ph-stethoscope" style={{ fontSize: 20 }} /></span>
          <div><div style={{ fontSize: 18, fontWeight: 500 }}>{t("counsellor.loopInDoctor")}</div><div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.reviewedWhenFree")}</div></div>
        </div>
        <div className="field"><label>{t("counsellor.handoffNoteLabel")}</label><textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: "vertical", minHeight: 96, padding: 10, lineHeight: 1.5 }} /></div>
        <div className="field">
          <label>{t("counsellor.reviewNeededLabel")}</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
            {["hour", "today", "routine"].map((u) => (
              <button key={u} type="button" onClick={() => setUrgency(u)} style={{ padding: "8px 4px", border: 0, cursor: "pointer", fontSize: 13, background: urgency === u ? "var(--color-primary-soft)" : "transparent", color: urgency === u ? "var(--color-primary)" : "var(--color-muted)" }}>
                {u === "hour" ? t("counsellor.urgencyHour") : u === "today" ? t("counsellor.urgencyToday") : t("counsellor.urgencyRoutine")}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">{t("counsellor.cancel")}</button>
          <button type="button" onClick={() => onSend(note, urgency)} className="btn btn-primary"><i className="ph ph-paper-plane-tilt" /> {t("counsellor.send")}</button>
        </div>
      </div>
    </div>
  );
}

function ContextRail({ conv }) {
  const { t } = useLang();
  return (
    <div style={{ overflowY: "auto", minHeight: 0, padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.severityLabel")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SeverityTag level={conv.severity_level} style={{ fontSize: 13 }} />
          {conv.mri != null && <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.mri").replace("{n}", conv.mri)}</span>}
        </div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.whyEscalated")}</div>
        <div style={{ display: "flex", gap: 8, fontSize: 14 }}><ReasonIcon source={conv.reason_source} />{conv.reason}</div>
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{t("counsellor.escalatedAgo").replace("{time}", timeAgo(conv.created_at))}</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.patientLabel")}</div>
        <div style={{ fontSize: 14 }}>{conv.patient_name}</div>
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{t("counsellor.languageLabel").replace("{lang}", conv.lang)}</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.doctorLabel")}</div>
        <div style={{ fontSize: 13, color: conv.forwarded ? "var(--color-primary)" : "var(--color-faint)" }}>
          {conv.advice ? t("counsellor.doctorReplied") : conv.forwarded ? t("counsellor.forwardedAwaiting") : t("counsellor.noDoctorYet")}
        </div>
      </div>
    </div>
  );
}

function Bubble({ m }) {
  const { t } = useLang();
  if (m.sender_kind === "system") {
    const map = {
      esc: t("counsellor.sysEscalated"), join: t("counsellor.sysJoined"),
      leave: `${t("counsellor.sysResolved")}${m.text ? " · " + t(OUTCOMES.find((o) => o.id === m.text)?.labelKey) : ""}`,
      fwd: t("counsellor.sysForwarded"),
    };
    return <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-faint)", padding: "2px 0" }}>{map[m.system_kind] || m.system_kind}</div>;
  }
  const mine = m.sender_kind === "counsellor";
  const isDoc = m.sender_kind === "doctor";
  const label = mine ? t("counsellor.senderYou") : isDoc ? t("counsellor.senderDoctor") : m.sender_kind === "bot" ? t("counsellor.senderAssistant") : t("counsellor.senderPatient");
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div style={{ maxWidth: "80%", display: "grid", gap: 3, justifyItems: mine ? "end" : "start" }}>
        <span style={{ fontSize: 11, color: "var(--color-faint)" }}>{label} · {new Date(m.created_at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        <div style={{
          padding: "9px 12px", borderRadius: 12, fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          background: mine ? "var(--color-primary-soft)" : isDoc ? "var(--color-primary-soft)" : m.sender_kind === "bot" ? "transparent" : "var(--color-surface-hover)",
          border: m.sender_kind === "bot" ? "1px dashed var(--color-border-strong)" : "1px solid transparent",
          color: "var(--color-ink)",
        }}>
          {m.text}
        </div>
      </div>
    </div>
  );
}

export default function CounsellorPage() {
  const { t } = useLang();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [onDuty, setOnDuty] = useState(!!user?.on_duty);
  const [queue, setQueue] = useState([]);
  const [mine, setMine] = useState([]);
  const [resolvedToday, setResolvedToday] = useState(0);
  const [page, setPage] = useState("queue");
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState("");
  const chatRef = useRef(null);

  async function refreshLists() {
    try {
      const [q, m] = await Promise.all([api.counsellorQueue(), api.counsellorMine()]);
      setQueue(q.queue);
      setMine(m.conversations);
      setResolvedToday(m.resolvedToday);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refreshLists();
    const iv = setInterval(refreshLists, QUEUE_POLL_MS);
    // The AuthContext user object is a snapshot from login/register time -
    // duty toggles afterward never update it, so a plain page reload would
    // otherwise show "off duty" from stale cached state even when the
    // server-side duty flag is still correctly on.
    api.me().then((data) => setOnDuty(!!data.user.on_duty)).catch(() => {});
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!activeId) { setActive(null); return; }
    let cancelled = false;
    async function poll() {
      try {
        const data = await api.counsellorConversation(activeId);
        if (!cancelled) setActive(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    poll();
    const iv = setInterval(poll, CONV_POLL_MS);
    return () => { cancelled = true; clearInterval(iv); };
  }, [activeId]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [active?.messages?.length]);

  async function toggleDuty() {
    const next = !onDuty;
    setOnDuty(next);
    try {
      await api.counsellorDuty(next);
    } catch (err) {
      setOnDuty(!next);
      setError(err.message);
    }
  }

  async function claim(id) {
    try {
      await api.counsellorClaim(id);
      setActiveId(id);
      setPage("conv");
      refreshLists();
    } catch (err) {
      setError(err.message);
      refreshLists();
    }
  }

  async function sendMessage() {
    if (!draft.trim() || !activeId) return;
    const text = draft;
    setDraft("");
    try {
      await api.counsellorSend(activeId, text);
      const data = await api.counsellorConversation(activeId);
      setActive(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function doResolve(outcome, note) {
    try {
      await api.counsellorResolve(activeId, outcome, note);
      setDialog(null);
      setActiveId(null);
      setPage("queue");
      refreshLists();
    } catch (err) {
      setError(err.message);
    }
  }

  async function doHandoff(note, urgency) {
    try {
      await api.counsellorHandoff(activeId, note, urgency);
      setDialog(null);
      const data = await api.counsellorConversation(activeId);
      setActive(data);
    } catch (err) {
      setError(err.message);
    }
  }

  const urgentCount = [...queue, ...mine].filter((c) => SEVERITY_RANK[c.severity_level] >= 3).length;
  const sortedQueue = [...queue].sort((a, b) => SEVERITY_RANK[b.severity_level] - SEVERITY_RANK[a.severity_level] || a.created_at - b.created_at);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--color-bg)", color: "var(--color-ink)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--color-neutral-900)" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)" }}><i className="ph ph-heartbeat" /></span>
        <div style={{ fontWeight: 500 }}>{t("counsellor.headerTitle")}</div>
        <nav style={{ display: "flex", gap: 4, marginLeft: 16 }}>
          <button type="button" onClick={() => setPage("queue")} className="btn btn-ghost" style={{ fontSize: 13, color: page === "queue" ? "var(--color-primary)" : "var(--color-muted)" }}>
            {t("counsellor.navQueue")} {queue.length > 0 && <span style={{ marginLeft: 4 }}>({queue.length})</span>}
          </button>
          <button type="button" onClick={() => setPage("conv")} className="btn btn-ghost" style={{ fontSize: 13, color: page === "conv" ? "var(--color-primary)" : "var(--color-muted)" }}>
            {t("counsellor.navMyConversations")} {mine.length > 0 && <span style={{ marginLeft: 4 }}>({mine.length})</span>}
          </button>
        </nav>
        <div style={{ flex: 1 }} />
        <button
          type="button" onClick={toggleDuty}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 4px 5px", borderRadius: 99, border: `1px solid ${onDuty ? "var(--color-good)" : "var(--color-neutral-700)"}`, background: onDuty ? "var(--color-good-soft)" : "transparent", cursor: "pointer" }}
        >
          <span style={{ width: 34, height: 20, borderRadius: 10, background: onDuty ? "var(--color-good)" : "var(--color-neutral-800)", position: "relative" }}>
            <span style={{ position: "absolute", top: 2, left: onDuty ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{onDuty ? t("counsellor.onDuty") : t("counsellor.offDuty")}</span>
        </button>
        <button type="button" onClick={() => setDialog("em")} className="btn" style={{ border: "1px solid var(--color-critical)", color: "var(--color-critical)", fontSize: 13 }}>
          <i className="ph ph-phone-call" /> 108
        </button>
        <span title={user?.name} style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-surface)", boxShadow: "0 0 0 1px var(--color-border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>
          {(user?.name || "C").slice(0, 2).toUpperCase()}
        </span>
        <button type="button" onClick={() => { logout(); navigate("/"); }} className="btn btn-ghost" style={{ fontSize: 12 }}>{t("common.logout")}</button>
      </header>

      {error && <div style={{ padding: "8px 24px", background: "var(--color-critical-soft)", color: "var(--color-critical)", fontSize: 13 }}>{error}</div>}

      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {page === "queue" && (
          <div style={{ padding: "28px 32px 48px", maxWidth: 1080, margin: "0 auto", width: "100%", overflowY: "auto" }}>
            <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 2 }}>{t("counsellor.queueTitle")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--color-muted)", marginBottom: 18 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: onDuty ? "var(--color-good)" : "var(--color-neutral-600)" }} />
              {onDuty ? t("counsellor.queueLive") : t("counsellor.queuePaused")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 18 }}>
              {[
                { label: t("counsellor.statActiveNow"), value: queue.length + mine.length, icon: "ph-pulse" },
                { label: t("counsellor.statUrgent"), value: urgentCount, icon: "ph-warning-octagon", danger: true },
                { label: t("counsellor.statClaimedByYou"), value: mine.length, icon: "ph-hand-grabbing" },
                { label: t("counsellor.statResolvedToday"), value: resolvedToday, icon: "ph-check-circle" },
              ].map((s) => (
                <div key={s.label} style={{ background: "var(--color-surface)", borderRadius: 12, padding: "12px 14px", boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 4 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-muted)" }}><i className={`ph ${s.icon}`} style={{ color: s.danger && s.value > 0 ? "var(--color-critical)" : "var(--color-primary)" }} />{s.label}</span>
                  <span style={{ fontSize: 26, fontWeight: 500, color: s.danger && s.value > 0 ? "var(--color-critical)" : "var(--color-ink)" }}>{s.value}</span>
                </div>
              ))}
            </div>

            {!onDuty ? (
              <div style={{ borderRadius: 16, padding: "32px 24px", display: "grid", gap: 14, boxShadow: "0 0 0 1px var(--color-border-strong)" }}>
                <span style={{ width: 48, height: 48, borderRadius: 14, background: "var(--color-neutral-900)", color: "var(--color-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ph ph-moon-stars" style={{ fontSize: 24 }} /></span>
                <div style={{ fontSize: 20, fontWeight: 500 }}>{t("counsellor.offDutyTitle")}</div>
                <div style={{ fontSize: 14, color: "var(--color-muted)", maxWidth: 520 }}>{t("counsellor.offDutyBody")}</div>
                <button type="button" onClick={toggleDuty} className="btn btn-primary" style={{ justifySelf: "start" }}><i className="ph ph-power" /> {t("counsellor.goOnDuty")}</button>
              </div>
            ) : sortedQueue.length === 0 ? (
              <div style={{ borderRadius: 16, padding: "40px 24px", display: "grid", gap: 14, justifyItems: "center", textAlign: "center", boxShadow: "0 0 0 1px var(--color-border-strong)" }}>
                <span style={{ width: 56, height: 56, borderRadius: "50%", border: "1px solid var(--color-primary)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ph ph-leaf" style={{ fontSize: 26 }} /></span>
                <div style={{ fontSize: 20, fontWeight: 500 }}>{t("counsellor.emptyQueueTitle")}</div>
                <div style={{ fontSize: 14, color: "var(--color-muted)", maxWidth: 440 }}>{t("counsellor.emptyQueueBody")}</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 13, color: "var(--color-muted)" }}>{t("counsellor.waitingMostSevere")}</div>
                {sortedQueue.map((c) => (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: "116px minmax(0,1fr) 84px auto", gap: 16, alignItems: "center", background: "var(--color-surface)", borderRadius: 12, padding: "12px 14px", boxShadow: `0 0 0 1px ${SEVERITY_RANK[c.severity_level] >= 3 ? "var(--color-critical)" : "var(--color-border-strong)"}` }}>
                    <SeverityTag level={c.severity_level} style={{ justifySelf: "start" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{c.patient_name}</span>
                        <span style={{ fontSize: 12, color: "var(--color-faint)" }}>{c.lang}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "var(--color-muted)", marginTop: 2 }}><ReasonIcon source={c.reason_source} />{c.reason}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15 }}>{timeAgo(c.created_at)}</div>
                      <div style={{ fontSize: 11, color: "var(--color-faint)" }}>{t("counsellor.waiting")}</div>
                    </div>
                    <button type="button" onClick={() => claim(c.id)} className="btn btn-primary" style={{ fontSize: 13, whiteSpace: "nowrap" }}><i className="ph ph-hand-grabbing" /> {t("counsellor.claim")}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {page === "conv" && !active && (
          <div style={{ margin: "auto", textAlign: "center", display: "grid", gap: 12, justifyItems: "center", padding: 24 }}>
            <i className="ph ph-chats-circle" style={{ fontSize: 32, color: "var(--color-primary)" }} />
            <div style={{ fontSize: 18, fontWeight: 500 }}>{mine.length ? t("counsellor.pickConversation") : t("counsellor.noOpenConversations")}</div>
            {mine.length > 0 ? (
              <div style={{ display: "grid", gap: 6, width: 280 }}>
                {mine.map((c) => (
                  <button key={c.id} type="button" onClick={() => setActiveId(c.id)} className="btn btn-secondary">{c.patient_name} · {severityLabel(t, c.severity_level)}</button>
                ))}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 14, color: "var(--color-muted)" }}>{t("counsellor.claimSomeone")}</div>
                <button type="button" onClick={() => setPage("queue")} className="btn btn-primary">{t("counsellor.goToQueue")} <i className="ph ph-arrow-right" /></button>
              </>
            )}
          </div>
        )}

        {page === "conv" && active && (
          <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px" }}>
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--color-neutral-900)" }}>
              {mine.length > 1 && (
                <div style={{ display: "flex", gap: 6, padding: "10px 16px 0", overflowX: "auto" }}>
                  {mine.map((c) => (
                    <button key={c.id} type="button" onClick={() => setActiveId(c.id)} style={{ padding: "5px 10px", borderRadius: 99, border: `1px solid ${c.id === activeId ? "var(--color-primary)" : "var(--color-border-strong)"}`, background: c.id === activeId ? "var(--color-primary-soft)" : "transparent", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>{c.patient_name}</button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-neutral-900)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500 }}>{active.patient_name.charAt(0)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 500 }}>{active.patient_name}</span>
                    <SeverityTag level={active.severity_level} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{active.lang} · {active.status}</div>
                </div>
                <button type="button" onClick={() => setDialog("handoff")} disabled={!!active.forwarded} className="btn btn-secondary" style={{ fontSize: 13 }}>
                  <i className={`ph ${active.forwarded ? "ph-check" : "ph-stethoscope"}`} /> {active.forwarded ? t("counsellor.loopedIn") : t("counsellor.loopInDoctor")}
                </button>
                <button type="button" onClick={() => setDialog("resolve")} className="btn btn-primary" style={{ fontSize: 13 }}><i className="ph ph-check-circle" /> {t("counsellor.resolve")}</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 16px", background: "oklch(0.22 0.03 25)", borderTop: "1px solid oklch(0.3 0.05 25)", borderBottom: "1px solid oklch(0.3 0.05 25)" }}>
                <span style={{ fontSize: 12, color: "oklch(0.87 0.07 25)" }}>{t("counsellor.emergencyStayOn")}</span>
                <a href="tel:108" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>108</b> {t("counsellor.ambulanceLabel")}</a>
                <a href="tel:102" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>102</b> {t("counsellor.transportLabel")}</a>
                <a href="tel:18005990019" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>KIRAN</b></a>
              </div>
              <div ref={chatRef} style={{ flex: 1, minHeight: 220, overflowY: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
                {active.messages.map((m) => <Bubble key={m.id} m={m} />)}
              </div>
              <div style={{ borderTop: "1px solid var(--color-neutral-900)", padding: "10px 16px 14px", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" placeholder={t("counsellor.writeMessage")} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }} style={{ flex: 1, minWidth: 0, height: 44 }} />
                  <button type="button" onClick={sendMessage} className="btn btn-primary btn-icon" style={{ width: 44, height: 44 }} aria-label={t("counsellor.sendAriaLabel")}><i className="ph ph-paper-plane-right" style={{ fontSize: 18 }} /></button>
                </div>
              </div>
            </div>
            <ContextRail conv={active} />
          </div>
        )}
      </main>

      {dialog === "em" && <EmergencyDialog onClose={() => setDialog(null)} />}
      {dialog === "resolve" && active && <ResolveDialog conv={active} onClose={() => setDialog(null)} onResolve={doResolve} />}
      {dialog === "handoff" && active && <HandoffDialog conv={active} onClose={() => setDialog(null)} onSend={doHandoff} />}
    </div>
  );
}
