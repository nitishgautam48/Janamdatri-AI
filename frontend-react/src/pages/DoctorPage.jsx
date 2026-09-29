import { useEffect, useState } from "react";
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
const URGENCY_LABEL_KEY = { hour: "counsellor.urgencyHour", today: "counsellor.urgencyToday", routine: "counsellor.urgencyRoutine" };
const QUEUE_POLL_MS = 6000;

function SeverityTag({ level }) {
  const { t } = useLang();
  const tone = SEVERITY_TONE[level] || { bg: "var(--color-neutral-800)", fg: "var(--color-neutral-100)" };
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, padding: "3px 10px", borderRadius: 8, background: tone.bg, color: tone.fg }}>{severityLabel(t, level)}</span>;
}

function timeAgo(ts) {
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const m = Math.floor(sec / 60);
  if (m < 1) return `${sec}s ago`;
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function TranscriptDrawer({ conv, onClose, onAdvice }) {
  const { t } = useLang();
  const [advice, setAdvice] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,18,28,0.7)", zIndex: 30, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px,100%)", height: "100%", background: "var(--color-surface)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--color-neutral-800)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{conv.patient_name} <span style={{ fontSize: 12, color: "var(--color-faint)", fontWeight: 400 }}>{conv.id.slice(0, 8)}</span></div>
            <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{t("doctor.fullTranscriptFromCounsellor")}</div>
          </div>
          <SeverityTag level={conv.severity_level} />
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" aria-label={t("doctor.closeAriaLabel")}><i className="ph ph-x" /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ padding: 12, borderRadius: 10, background: "var(--color-neutral-900)", display: "grid", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{t("counsellor.handoffNoteLabel")}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{conv.handoff_note}</div>
          </div>
          {(conv.messages || []).filter((m) => m.sender_kind !== "system").map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: m.sender_kind === "patient" || m.sender_kind === "bot" ? "flex-start" : "flex-end" }}>
              <div style={{ maxWidth: "84%", display: "grid", gap: 3 }}>
                <span style={{ fontSize: 11, color: "var(--color-faint)" }}>{m.sender_kind === "patient" ? t("counsellor.senderPatient") : m.sender_kind === "bot" ? t("doctor.senderAssistant") : m.sender_kind === "doctor" ? t("counsellor.senderDoctor") : t("chat.counsellorLabel")}</span>
                <div style={{ padding: "8px 11px", borderRadius: 12, fontSize: 13, lineHeight: 1.45, background: m.sender_kind === "patient" ? "#2a2d3d" : m.sender_kind === "bot" ? "transparent" : "var(--color-primary-soft)", border: m.sender_kind === "bot" ? "1px dashed var(--color-border-strong)" : "1px solid transparent" }}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid var(--color-neutral-800)", padding: 16, display: "grid", gap: 8 }}>
          {conv.advice ? (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--color-primary-soft)", fontSize: 14, lineHeight: 1.5 }}>
              <div style={{ fontSize: 11, color: "var(--color-primary)" }}>{t("doctor.reviewed")}</div>
              {conv.advice}
            </div>
          ) : (
            <>
              <div className="field">
                <label>{t("doctor.yourAdviceLabel")}</label>
                <textarea className="input" rows={3} placeholder={t("doctor.advicePlaceholder")} value={advice} onChange={(e) => setAdvice(e.target.value)} style={{ resize: "vertical", minHeight: 72, padding: 10 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={onClose} className="btn btn-secondary">{t("counsellor.cancel")}</button>
                <button type="button" onClick={() => onAdvice(advice)} className="btn btn-primary"><i className="ph ph-paper-plane-tilt" /> {t("doctor.sendToCounsellor")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DoctorPage() {
  const { t } = useLang();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("new");
  const [cases, setCases] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [openConv, setOpenConv] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const data = await api.doctorQueue(filter === "reviewed");
      setCases(data.cases);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, QUEUE_POLL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function openCase(id) {
    try {
      const data = await api.doctorConversation(id);
      setOpenId(id);
      setOpenConv(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitAdvice(advice) {
    if (!advice.trim()) return;
    try {
      await api.doctorAdvice(openId, advice);
      setOpenId(null);
      setOpenConv(null);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--color-bg)", color: "var(--color-ink)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--color-neutral-900)" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)" }}><i className="ph ph-heartbeat" /></span>
        <div style={{ fontWeight: 500 }}>{t("doctor.headerTitle")}</div>
        <div style={{ flex: 1 }} />
        <span title={user?.name} style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-surface)", boxShadow: "0 0 0 1px var(--color-border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>
          {(user?.name || "D").slice(0, 2).toUpperCase()}
        </span>
        <button type="button" onClick={() => { logout(); navigate("/"); }} className="btn btn-ghost" style={{ fontSize: 12 }}>{t("common.logout")}</button>
      </header>

      {error && <div style={{ padding: "8px 24px", background: "var(--color-critical-soft)", color: "var(--color-critical)", fontSize: 13 }}>{error}</div>}

      <main style={{ flex: 1, overflowY: "auto", padding: "28px 32px 48px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 500 }}>{t("doctor.forwardedCasesTitle")}</div>
            <div style={{ fontSize: 13, color: "var(--color-muted)" }}>{t("doctor.forwardedCasesSubtitle")}</div>
          </div>
          <div style={{ display: "flex", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
            <button type="button" onClick={() => setFilter("new")} style={{ padding: "6px 12px", border: 0, cursor: "pointer", fontSize: 13, background: filter === "new" ? "var(--color-primary-soft)" : "transparent", color: filter === "new" ? "var(--color-primary)" : "var(--color-muted)" }}>{t("doctor.filterNew")}</button>
            <button type="button" onClick={() => setFilter("reviewed")} style={{ padding: "6px 12px", border: 0, cursor: "pointer", fontSize: 13, background: filter === "reviewed" ? "var(--color-primary-soft)" : "transparent", color: filter === "reviewed" ? "var(--color-primary)" : "var(--color-muted)" }}>{t("doctor.filterReviewed")}</button>
          </div>
        </div>

        {cases.length === 0 ? (
          <div style={{ padding: 28, borderRadius: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", color: "var(--color-muted)", fontSize: 14, textAlign: "center" }}>
            {t("doctor.emptyCases")}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {cases.map((c) => (
              <div key={c.id} style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 10, boxShadow: c.handoff_urgency === "hour" && !c.advice ? "0 0 0 1px var(--color-critical)" : "0 0 0 1px var(--color-border-strong)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <SeverityTag level={c.severity_level} />
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{c.patient_name}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 12, border: "1px solid var(--color-border-strong)", color: "var(--color-muted)" }}>{URGENCY_LABEL_KEY[c.handoff_urgency] ? t(URGENCY_LABEL_KEY[c.handoff_urgency]) : c.handoff_urgency}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{timeAgo(c.created_at)}</div>
                <div style={{ padding: 12, borderRadius: 10, background: "var(--color-neutral-900)", fontSize: 14, lineHeight: 1.5 }}>{c.handoff_note}</div>
                {c.advice && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--color-primary-soft)", fontSize: 14, lineHeight: 1.5 }}>
                    <div style={{ fontSize: 11, color: "var(--color-primary)" }}>{t("doctor.reviewed")}</div>{c.advice}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => openCase(c.id)} className="btn btn-secondary" style={{ fontSize: 13 }}><i className="ph ph-article" /> {t("doctor.openTranscript")}</button>
                  {!c.advice && <button type="button" onClick={() => openCase(c.id)} className="btn btn-primary" style={{ fontSize: 13 }}><i className="ph ph-pencil-simple" /> {t("doctor.writeAdvice")}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {openConv && <TranscriptDrawer conv={openConv} onClose={() => { setOpenId(null); setOpenConv(null); }} onAdvice={submitAdvice} />}
    </div>
  );
}
