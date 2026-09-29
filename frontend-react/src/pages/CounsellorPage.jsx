import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

// Staff-facing workspace - English only for now, matching the existing
// Provider/Caregiver pages' own precedent (neither of those is
// translated either). A real gap, same as theirs - see the project
// report's "gaps" section - not addressed in this pass to keep an
// already large feature bounded.

const SEVERITY_TONE = {
  Critical: { bg: "var(--color-critical-soft)", fg: "var(--color-critical)" },
  Severe: { bg: "var(--color-critical-soft)", fg: "var(--color-critical)" },
  Moderate: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)" },
  Mild: { bg: "var(--color-good-soft)", fg: "var(--color-good)" },
  Minimal: { bg: "var(--color-good-soft)", fg: "var(--color-good)" },
};
const SEVERITY_RANK = { Critical: 4, Severe: 3, Moderate: 2, Mild: 1, Minimal: 0 };

function SeverityTag({ level, style }) {
  const tone = SEVERITY_TONE[level] || { bg: "var(--color-neutral-800)", fg: "var(--color-neutral-100)" };
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, padding: "3px 10px", borderRadius: 8, background: tone.bg, color: tone.fg, ...style }}>{level}</span>;
}
const OUTCOMES = [
  { id: "care", label: "Advised to seek care", icon: "ph-hospital" },
  { id: "chat", label: "Resolved by chat", icon: "ph-chat-circle-text" },
  { id: "emer", label: "Escalated to emergency services", icon: "ph-ambulance" },
  { id: "doc", label: "Referred to doctor", icon: "ph-stethoscope" },
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
  const nums = [
    { num: "108", desc: "Free ambulance, 24 hours" },
    { num: "102", desc: "Free ride to a government hospital" },
    { num: "1800-599-0019", desc: "KIRAN mental health helpline, 24 hours" },
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16, background: "rgba(16,18,28,0.72)", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(400px,100%)", display: "grid", gap: 12, padding: 20, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ fontSize: 18, fontWeight: 500 }}>Emergency numbers</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-muted)" }}>These stay on for every patient at all times, with or without a counsellor in the chat.</div>
        {nums.map((n) => (
          <a key={n.num} href={`tel:${n.num.replace(/\D/g, "")}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 10, border: "1px solid var(--color-critical)", textDecoration: "none", color: "var(--color-ink)" }}>
            <i className="ph ph-phone-call" style={{ fontSize: 22, color: "var(--color-critical)" }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 16, fontWeight: 500 }}>{n.num}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-muted)" }}>{n.desc}</span>
            </span>
          </a>
        ))}
        <button type="button" onClick={onClose} className="btn btn-secondary">Close</button>
      </div>
    </div>
  );
}

function ResolveDialog({ conv, onClose, onResolve }) {
  const [outcome, setOutcome] = useState("care");
  const [note, setNote] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16, background: "rgba(16,18,28,0.72)", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px,100%)", display: "grid", gap: 14, padding: 20, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ fontSize: 18, fontWeight: 500 }}>Resolve conversation<div style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 400 }}>{conv.patient_name} · {conv.id.slice(0, 8)}</div></div>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Outcome</div>
          {OUTCOMES.map((o) => (
            <button
              key={o.id} type="button" onClick={() => setOutcome(o.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, border: `1px solid ${outcome === o.id ? "var(--color-primary)" : "var(--color-border)"}`, background: outcome === o.id ? "var(--color-primary-soft)" : "none", cursor: "pointer", textAlign: "left", width: "100%" }}
            >
              <i className={`ph ${o.icon}`} style={{ color: "var(--color-muted)" }} />
              <span style={{ fontSize: 14 }}>{o.label}</span>
            </button>
          ))}
        </div>
        <div className="field"><label>Note (optional)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5, color: "var(--color-muted)" }}>
          <i className="ph ph-info" style={{ marginTop: 2 }} />She will see that the chat has ended, and can still reach 108 and the assistant anytime.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="button" onClick={() => onResolve(outcome, note)} className="btn btn-primary"><i className="ph ph-check" /> Resolve</button>
        </div>
      </div>
    </div>
  );
}

function HandoffDialog({ conv, onClose, onSend }) {
  const [note, setNote] = useState(`${conv.patient_name}, ${conv.severity_level} (${conv.reason}).`);
  const [urgency, setUrgency] = useState(SEVERITY_RANK[conv.severity_level] >= 3 ? "hour" : "today");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", padding: 16, background: "rgba(16,18,28,0.72)", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px,100%)", display: "grid", gap: 14, padding: 20, borderRadius: 16, background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ph ph-stethoscope" style={{ fontSize: 20 }} /></span>
          <div><div style={{ fontSize: 18, fontWeight: 500 }}>Loop in a doctor</div><div style={{ fontSize: 12, color: "var(--color-muted)" }}>Reviewed when they're free</div></div>
        </div>
        <div className="field"><label>Handoff note</label><textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: "vertical", minHeight: 96, padding: 10, lineHeight: 1.5 }} /></div>
        <div className="field">
          <label>Review needed</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
            {["hour", "today", "routine"].map((u) => (
              <button key={u} type="button" onClick={() => setUrgency(u)} style={{ padding: "8px 4px", border: 0, cursor: "pointer", fontSize: 13, background: urgency === u ? "var(--color-primary-soft)" : "transparent", color: urgency === u ? "var(--color-primary)" : "var(--color-muted)" }}>
                {u === "hour" ? "Within 1 hour" : u === "today" ? "Today" : "Routine"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="button" onClick={() => onSend(note, urgency)} className="btn btn-primary"><i className="ph ph-paper-plane-tilt" /> Send</button>
        </div>
      </div>
    </div>
  );
}

function ContextRail({ conv }) {
  return (
    <div style={{ overflowY: "auto", minHeight: 0, padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Severity</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SeverityTag level={conv.severity_level} style={{ fontSize: 13 }} />
          {conv.mri != null && <span style={{ fontSize: 12, color: "var(--color-muted)" }}>MRI {conv.mri}/100</span>}
        </div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Why it escalated</div>
        <div style={{ display: "flex", gap: 8, fontSize: 14 }}><ReasonIcon source={conv.reason_source} />{conv.reason}</div>
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>Escalated {timeAgo(conv.created_at)} ago</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Patient</div>
        <div style={{ fontSize: 14 }}>{conv.patient_name}</div>
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>Language: {conv.lang}</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Doctor</div>
        <div style={{ fontSize: 13, color: conv.forwarded ? "var(--color-primary)" : "var(--color-faint)" }}>
          {conv.advice ? "Doctor replied - see chat" : conv.forwarded ? "Forwarded, awaiting review" : "No doctor involved yet"}
        </div>
      </div>
    </div>
  );
}

function Bubble({ m }) {
  if (m.sender_kind === "system") {
    const map = {
      esc: "Escalated", join: "Counsellor joined - patient was told a real person is here",
      leave: `Resolved${m.text ? " · " + OUTCOMES.find((o) => o.id === m.text)?.label : ""}`,
      fwd: "Forwarded to doctor with transcript",
    };
    return <div style={{ textAlign: "center", fontSize: 12, color: "var(--color-faint)", padding: "2px 0" }}>{map[m.system_kind] || m.system_kind}</div>;
  }
  const mine = m.sender_kind === "counsellor";
  const isDoc = m.sender_kind === "doctor";
  const label = mine ? "You" : isDoc ? "Doctor" : m.sender_kind === "bot" ? "Assistant · automated" : "Patient";
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
        <div style={{ fontWeight: 500 }}>Janamdatri AI · Counsellor</div>
        <nav style={{ display: "flex", gap: 4, marginLeft: 16 }}>
          <button type="button" onClick={() => setPage("queue")} className="btn btn-ghost" style={{ fontSize: 13, color: page === "queue" ? "var(--color-primary)" : "var(--color-muted)" }}>
            Queue {queue.length > 0 && <span style={{ marginLeft: 4 }}>({queue.length})</span>}
          </button>
          <button type="button" onClick={() => setPage("conv")} className="btn btn-ghost" style={{ fontSize: 13, color: page === "conv" ? "var(--color-primary)" : "var(--color-muted)" }}>
            My conversations {mine.length > 0 && <span style={{ marginLeft: 4 }}>({mine.length})</span>}
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
          <span style={{ fontSize: 13, fontWeight: 500 }}>{onDuty ? "On duty" : "Off duty"}</span>
        </button>
        <button type="button" onClick={() => setDialog("em")} className="btn" style={{ border: "1px solid var(--color-critical)", color: "var(--color-critical)", fontSize: 13 }}>
          <i className="ph ph-phone-call" /> 108
        </button>
        <span title={user?.name} style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-surface)", boxShadow: "0 0 0 1px var(--color-border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>
          {(user?.name || "C").slice(0, 2).toUpperCase()}
        </span>
        <button type="button" onClick={() => { logout(); navigate("/"); }} className="btn btn-ghost" style={{ fontSize: 12 }}>Log out</button>
      </header>

      {error && <div style={{ padding: "8px 24px", background: "var(--color-critical-soft)", color: "var(--color-critical)", fontSize: 13 }}>{error}</div>}

      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {page === "queue" && (
          <div style={{ padding: "28px 32px 48px", maxWidth: 1080, margin: "0 auto", width: "100%", overflowY: "auto" }}>
            <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 2 }}>Incoming queue</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--color-muted)", marginBottom: 18 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: onDuty ? "var(--color-good)" : "var(--color-neutral-600)" }} />
              {onDuty ? "Live · cases appear the moment they escalate" : "Paused · you're off duty"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 18 }}>
              {[
                { label: "Active now", value: queue.length + mine.length, icon: "ph-pulse" },
                { label: "Urgent", value: urgentCount, icon: "ph-warning-octagon", danger: true },
                { label: "Claimed by you", value: mine.length, icon: "ph-hand-grabbing" },
                { label: "Resolved today", value: resolvedToday, icon: "ph-check-circle" },
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
                <div style={{ fontSize: 20, fontWeight: 500 }}>You're off duty</div>
                <div style={{ fontSize: 14, color: "var(--color-muted)", maxWidth: 520 }}>New cases go to counsellors who are on duty. No patient waits on you: the assistant sends 108 guidance on every danger sign, around the clock.</div>
                <button type="button" onClick={toggleDuty} className="btn btn-primary" style={{ justifySelf: "start" }}><i className="ph ph-power" /> Go on duty</button>
              </div>
            ) : sortedQueue.length === 0 ? (
              <div style={{ borderRadius: 16, padding: "40px 24px", display: "grid", gap: 14, justifyItems: "center", textAlign: "center", boxShadow: "0 0 0 1px var(--color-border-strong)" }}>
                <span style={{ width: 56, height: 56, borderRadius: "50%", border: "1px solid var(--color-primary)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><i className="ph ph-leaf" style={{ fontSize: 26 }} /></span>
                <div style={{ fontSize: 20, fontWeight: 500 }}>No one's waiting right now</div>
                <div style={{ fontSize: 14, color: "var(--color-muted)", maxWidth: 440 }}>New escalations appear here the moment they happen. Until then, the assistant keeps answering and gives 108 guidance on every danger sign.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 13, color: "var(--color-muted)" }}>Waiting · most severe first</div>
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
                      <div style={{ fontSize: 11, color: "var(--color-faint)" }}>waiting</div>
                    </div>
                    <button type="button" onClick={() => claim(c.id)} className="btn btn-primary" style={{ fontSize: 13, whiteSpace: "nowrap" }}><i className="ph ph-hand-grabbing" /> Claim</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {page === "conv" && !active && (
          <div style={{ margin: "auto", textAlign: "center", display: "grid", gap: 12, justifyItems: "center", padding: 24 }}>
            <i className="ph ph-chats-circle" style={{ fontSize: 32, color: "var(--color-primary)" }} />
            <div style={{ fontSize: 18, fontWeight: 500 }}>{mine.length ? "Pick a conversation" : "No open conversations"}</div>
            {mine.length > 0 ? (
              <div style={{ display: "grid", gap: 6, width: 280 }}>
                {mine.map((c) => (
                  <button key={c.id} type="button" onClick={() => setActiveId(c.id)} className="btn btn-secondary">{c.patient_name} · {c.severity_level}</button>
                ))}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 14, color: "var(--color-muted)" }}>Claim someone from the incoming queue to start a live chat.</div>
                <button type="button" onClick={() => setPage("queue")} className="btn btn-primary">Go to queue <i className="ph ph-arrow-right" /></button>
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
                  <i className={`ph ${active.forwarded ? "ph-check" : "ph-stethoscope"}`} /> {active.forwarded ? "Looped in" : "Loop in a doctor"}
                </button>
                <button type="button" onClick={() => setDialog("resolve")} className="btn btn-primary" style={{ fontSize: 13 }}><i className="ph ph-check-circle" /> Resolve</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 16px", background: "oklch(0.22 0.03 25)", borderTop: "1px solid oklch(0.3 0.05 25)", borderBottom: "1px solid oklch(0.3 0.05 25)" }}>
                <span style={{ fontSize: 12, color: "oklch(0.87 0.07 25)" }}>Emergency options stay on for her</span>
                <a href="tel:108" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>108</b> Ambulance</a>
                <a href="tel:102" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>102</b> Transport</a>
                <a href="tel:18005990019" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>KIRAN</b></a>
              </div>
              <div ref={chatRef} style={{ flex: 1, minHeight: 220, overflowY: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
                {active.messages.map((m) => <Bubble key={m.id} m={m} />)}
              </div>
              <div style={{ borderTop: "1px solid var(--color-neutral-900)", padding: "10px 16px 14px", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="input" placeholder="Write a message…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }} style={{ flex: 1, minWidth: 0, height: 44 }} />
                  <button type="button" onClick={sendMessage} className="btn btn-primary btn-icon" style={{ width: 44, height: 44 }} aria-label="Send"><i className="ph ph-paper-plane-right" style={{ fontSize: 18 }} /></button>
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
