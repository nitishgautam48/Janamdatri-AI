import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import { api } from "../lib/api";
import { severityLabel } from "../lib/severity";
import { connectWs } from "../lib/ws";
import { getToken } from "../lib/storage";
import { createVoiceCall } from "../lib/voice-call";
import { startLiveStt } from "../lib/live-stt";

const SEVERITY_TONE = {
  Critical: { bg: "var(--color-critical-soft)", fg: "var(--color-critical)" },
  Severe: { bg: "var(--color-critical-soft)", fg: "var(--color-critical)" },
  Moderate: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)" },
  Mild: { bg: "var(--color-good-soft)", fg: "var(--color-good)" },
  Minimal: { bg: "var(--color-good-soft)", fg: "var(--color-good)" },
};
const SEVERITY_RANK = { Critical: 4, Severe: 3, Moderate: 2, Mild: 1, Minimal: 0 };
const OUTCOMES = [
  { id: "care", labelKey: "counsellor.outcomeCare", icon: "ph-hospital" },
  { id: "chat", labelKey: "counsellor.outcomeChat", icon: "ph-chat-circle-text" },
  { id: "emer", labelKey: "counsellor.outcomeEmergency", icon: "ph-ambulance" },
  { id: "doc", labelKey: "counsellor.outcomeDoctor", icon: "ph-stethoscope" },
];
const LANG_CHIPS = [
  { code: "en", label: "EN" },
  { code: "hi", label: "हिं" },
  { code: "hinglish", label: "Hg" },
];

// Always sent in Hinglish (her language) regardless of the counsellor's own
// UI language - matches the source design's own choice (only the button
// label is translated, the message text isn't).
const QUICK_REPLIES = [
  { labelKey: "counsellor.quickCall108", text: "Abhi 108 pe call kariye, ambulance free hai. Main yahin hoon." },
  { labelKey: "counsellor.quickSomeoneWithYou", text: "Kya aapke saath abhi koi hai?" },
  { labelKey: "counsellor.quickLieLeftSide", text: "Baayi karwat lait jaiye aur aaram kariye." },
  { labelKey: "counsellor.quickImHere", text: "Main yahin hoon, aap akeli nahi hain." },
  { labelKey: "counsellor.quickHowAreYou", text: "Abhi aap kaisa mehsoos kar rahi hain?" },
];
const HANDOFF_SUGGESTIONS = ["Needs review tonight.", "Can she travel tomorrow instead?", "Medication question."];
const SEND_NUMBERS_TEXT = "Emergency numbers: 108 (free ambulance), 102 (hospital gaadi), KIRAN 1800-599-0019 (mann ki baat, 24 ghante).";

// The queue, active conversation, and forwarded-cases list all now update
// over WebSocket (/ws/staff and /ws/live/{id}, see src/ws_manager.py) the
// instant something changes - these are just a slow backstop poll in case
// a socket drops without the browser noticing.
const QUEUE_POLL_MS = 20000;
const CONV_POLL_MS = 20000;
const DOC_POLL_MS = 20000;

function waitLabel(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  if (m < 1) return `${sec}s`;
  if (m < 10) return `${m}m ${String(sec % 60).padStart(2, "0")}s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function agoLabel(t, sinceSec) {
  return `${waitLabel(Date.now() - sinceSec * 1000)} ${t("counsellor.ago")}`;
}

function SeverityTag({ level, style }) {
  const { t } = useLang();
  const tone = SEVERITY_TONE[level] || { bg: "var(--color-neutral-800)", fg: "var(--color-neutral-100)" };
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "3px 10px", borderRadius: 8, background: tone.bg, color: tone.fg, ...style }}>{severityLabel(t, level)}</span>;
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
        <div style={{ fontSize: 18, fontWeight: 500 }}>{t("counsellor.resolveTitle")}<div style={{ fontSize: 13, color: "var(--color-muted)", fontWeight: 400 }}>{conv.patient_name} · {conv.patient_code}</div></div>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.outcomeLabel")}</div>
          {OUTCOMES.map((o) => (
            <button
              key={o.id} type="button" onClick={() => setOutcome(o.id)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 10, border: `1px solid ${outcome === o.id ? "var(--color-primary)" : "var(--color-border)"}`, background: outcome === o.id ? "var(--color-primary-soft)" : "none", cursor: "pointer", textAlign: "left", width: "100%" }}
            >
              <span style={{ width: 16, height: 16, borderRadius: "50%", border: `1.5px solid ${outcome === o.id ? "var(--color-primary)" : "var(--color-border-strong)"}`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                {outcome === o.id && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-primary)" }} />}
              </span>
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

function HandoffDialog({ conv, messageCount, onClose, onSend }) {
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
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {HANDOFF_SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setNote((n) => `${n.trim()} ${s}`.trim())} style={{ padding: "4px 10px", borderRadius: 99, border: "1px dashed var(--color-border-strong)", background: "none", fontSize: 12, color: "var(--color-muted)", cursor: "pointer" }}>
              <i className="ph ph-plus" /> {s}
            </button>
          ))}
        </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: "var(--color-neutral-900)", fontSize: 13 }}>
          <i className="ph ph-paperclip" style={{ color: "var(--color-primary)" }} />
          <span style={{ flex: 1 }}>{t("counsellor.transcriptAttachedLabel")} · {messageCount} {t("counsellor.msgsCountLabel")}</span>
          <i className="ph ph-lock-simple" style={{ color: "var(--color-faint)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">{t("counsellor.cancel")}</button>
          <button type="button" onClick={() => onSend(note, urgency)} className="btn btn-primary"><i className="ph ph-paper-plane-tilt" /> {t("counsellor.send")}</button>
        </div>
      </div>
    </div>
  );
}

function VitalsGrid({ vitals }) {
  const { t } = useLang();
  const items = [
    { l: "BP", v: vitals.bp, flag: vitals.bpFlag },
    { l: "Pulse", v: vitals.pulse, flag: vitals.pulseFlag },
    { l: "Hb", v: vitals.hb != null ? `${vitals.hb} g/dL` : null, flag: vitals.hbFlag },
    { l: t("guide.weekLabel"), v: vitals.week, flag: false },
  ].filter((it) => it.v != null);
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {items.map((it) => (
        <div key={it.l} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--color-neutral-900)" }}>
          <div style={{ fontSize: 11, color: "var(--color-muted)" }}>{it.l}</div>
          <div style={{ fontSize: 15, color: it.flag ? "var(--color-critical)" : "var(--color-ink)" }}>{it.v}</div>
        </div>
      ))}
    </div>
  );
}

function MriTrend({ trend }) {
  const { t } = useLang();
  if (!trend.length) return null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 70 }}>
        {trend.map((p, i) => {
          const isLast = i === trend.length - 1;
          const tone = SEVERITY_TONE[p.severity_level] || SEVERITY_TONE.Minimal;
          const daysAgo = Math.floor((Date.now() / 1000 - p.created_at) / 86400);
          return (
            <div key={p.created_at} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 3, height: "100%" }}>
              <span style={{ fontSize: 11, color: "var(--color-faint)" }}>{p.mri}</span>
              <div style={{ width: "100%", maxWidth: 30, height: `${Math.max(6, p.mri)}%`, borderRadius: "5px 5px 2px 2px", background: isLast ? tone.bg : "var(--color-neutral-800)", border: `1px solid ${isLast ? tone.fg : "var(--color-border-strong)"}` }} />
              <span style={{ fontSize: 10, color: "var(--color-faint)" }}>{daysAgo === 0 ? t("counsellor.nowLabel") : `${daysAgo}d`}</span>
            </div>
          );
        })}
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
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{t("counsellor.escalatedAgo").replace("{time}", waitLabel(Date.now() - conv.created_at * 1000))}</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.patientLabel")}</div>
        <div style={{ fontSize: 14 }}>{conv.patient_name}</div>
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{t("counsellor.languageLabel").replace("{lang}", conv.lang)}</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.vitalsLabel")}</div>
        {conv.vitals ? <VitalsGrid vitals={conv.vitals} /> : <div style={{ fontSize: 13, color: "var(--color-faint)" }}>{t("counsellor.noVitalsData")}</div>}
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.warningSignsLabel")}</div>
        {conv.warning_signs?.length ? conv.warning_signs.map((sg) => (
          <div key={sg} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.45 }}><i className="ph ph-warning" style={{ color: "var(--color-warning)", marginTop: 3 }} />{sg}</div>
        )) : <div style={{ fontSize: 13, color: "var(--color-faint)" }}>{t("counsellor.noSignsReported")}</div>}
      </div>
      {conv.mri_trend?.length > 0 && (
        <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.assessmentHistoryLabel")}</div>
          <MriTrend trend={conv.mri_trend} />
        </div>
      )}
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("counsellor.doctorLabel")}</div>
        <div style={{ fontSize: 13, color: conv.forwarded ? "var(--color-primary)" : "var(--color-faint)" }}>
          {conv.advice ? t("counsellor.doctorReplied") : conv.forwarded ? t("counsellor.forwardedAwaiting") : t("counsellor.noDoctorYet")}
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, convId }) {
  const { t } = useLang();
  if (m.sender_kind === "system") {
    const map = {
      esc: t("counsellor.sysEscalated"), join: t("counsellor.sysJoined"),
      leave: `${t("counsellor.sysResolved")}${m.text ? " · " + t(OUTCOMES.find((o) => o.id === m.text)?.labelKey) : ""}`,
      fwd: t("counsellor.sysForwarded"),
      unclaim: t("counsellor.sysUnclaimed"),
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
          padding: "9px 12px", borderRadius: 12, fontSize: 14, lineHeight: 1.45, overflowWrap: "anywhere",
          background: mine ? "var(--color-primary-soft)" : isDoc ? "var(--color-primary-soft)" : m.sender_kind === "bot" ? "transparent" : "var(--color-surface-hover)",
          border: m.sender_kind === "bot" ? "1px dashed var(--color-border-strong)" : "1px solid transparent",
          color: "var(--color-ink)",
        }}>
          {m.message_kind === "voice" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, opacity: 0.85 }}>
                <i className="ph ph-microphone" /> {t("chat.voiceNoteLabel")}
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={`/live/${convId}/voice-note/${m.audio_note_id}`} style={{ height: 32, maxWidth: 260 }} />
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text || t("chat.voiceNoteNoTranscript")}</div>
            </div>
          ) : m.message_kind === "call" ? (
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, opacity: 0.7 }}>
                <i className="ph ph-phone-call" /> {t("chat.callTranscriptLabel")}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            </div>
          ) : (
            <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ t, section, setSection, queueCount, urgentWaiting, mineCount, docNewCount, roleLabel, initials }) {
  const groups = [
    { label: t("chat.counsellorLabel"), items: [
      { id: "queue", icon: "ph-tray", label: t("counsellor.queueTitle"), badge: queueCount, hot: urgentWaiting },
      { id: "conv", icon: "ph-chats-circle", label: t("counsellor.conversationsGroupLabel"), badge: mineCount, hot: false },
    ] },
    { label: t("careTeam.doctorRole"), items: [
      { id: "docq", icon: "ph-stethoscope", label: t("doctor.forwardedCasesTitle"), badge: docNewCount, hot: false },
    ] },
    { label: t("family.groupLabel"), items: [
      { id: "caregiver", icon: "ph-users-three", label: t("family.navLabel"), badge: 0, hot: false },
    ] },
  ];
  return (
    <aside style={{ width: 232, flex: "none", borderRight: "1px solid var(--color-neutral-900)", display: "flex", flexDirection: "column", overflowY: "auto", padding: "16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 10px 18px" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)" }}><i className="ph ph-heartbeat" /></span>
        <span style={{ lineHeight: 1.2 }}><span style={{ display: "block", fontWeight: 500, fontSize: 15 }}>Janamdatri AI</span><span style={{ display: "block", fontSize: 12, color: "var(--color-faint)" }}>जन्मदात्री</span></span>
      </div>
      <nav style={{ display: "grid", gap: 12 }}>
        {groups.map((g) => (
          <div key={g.label} style={{ display: "grid", gap: 1 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-faint)", padding: "0 10px 3px" }}>{g.label}</div>
            {g.items.map((it) => {
              const active = section === it.id;
              return (
                <button key={it.id} type="button" onClick={() => setSection(it.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, border: 0, cursor: "pointer", fontSize: 14, textAlign: "left", width: "100%", background: active ? "var(--color-primary-soft)" : "transparent", color: active ? "var(--color-primary)" : "var(--color-muted)" }}>
                  <i className={`ph ${it.icon}`} style={{ fontSize: 17 }} />
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.badge > 0 && <span style={{ minWidth: 20, padding: "1px 6px", borderRadius: 99, fontSize: 11, textAlign: "center", background: it.hot ? "var(--color-critical-soft)" : "var(--color-neutral-800)", color: it.hot ? "var(--color-critical)" : "var(--color-neutral-300)" }}>{it.badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ flex: 1, minHeight: 16 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 10, boxShadow: "0 0 0 1px var(--color-border-strong)" }}>
        <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flex: "none" }}>{initials}</span>
        <span style={{ minWidth: 0, fontSize: 12, lineHeight: 1.35, color: "var(--color-muted)" }}>{roleLabel}</span>
      </div>
    </aside>
  );
}

function TopBar({ t, title, onDuty, toggleDuty, showDuty, lang, setLangDirect, onEmergency, user }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", borderBottom: "1px solid var(--color-neutral-900)", flex: "none" }}>
      <div style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{title}</div>
      {showDuty && (
        <button type="button" onClick={toggleDuty} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px 4px 5px", borderRadius: 99, border: `1px solid ${onDuty ? "var(--color-good)" : "var(--color-neutral-700)"}`, background: onDuty ? "var(--color-good-soft)" : "transparent", cursor: "pointer", flex: "none" }}>
          <span style={{ width: 34, height: 20, borderRadius: 10, background: onDuty ? "var(--color-good)" : "var(--color-neutral-800)", position: "relative" }}>
            <span style={{ position: "absolute", top: 2, left: onDuty ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>{onDuty ? t("counsellor.onDuty") : t("counsellor.offDuty")}</span>
        </button>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", flex: "none", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
        {LANG_CHIPS.map((l) => (
          <button key={l.code} type="button" onClick={() => setLangDirect(l.code)} style={{ padding: "5px 9px", border: 0, cursor: "pointer", fontSize: 12, background: lang === l.code ? "var(--color-primary-soft)" : "transparent", color: lang === l.code ? "var(--color-primary)" : "var(--color-muted)" }}>{l.label}</button>
        ))}
      </div>
      <button type="button" onClick={onEmergency} className="btn" style={{ border: "1px solid var(--color-critical)", color: "var(--color-critical)", fontSize: 13, whiteSpace: "nowrap" }}>
        <i className="ph ph-phone-call" /> {t("common.call108")}
      </button>
      <span title={user?.name} style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-surface)", boxShadow: "0 0 0 1px var(--color-border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flex: "none" }}>
        {(user?.name || "S").slice(0, 2).toUpperCase()}
      </span>
    </header>
  );
}

function FamilySection() {
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    setData(null);
    try {
      setData(await api.providerSummary(code.trim()));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sev = data?.latestAssessment;
  const rank = sev ? SEVERITY_RANK[sev.severityLevel] ?? 0 : 0;
  const tier = rank >= 3 ? "urgent" : rank === 2 ? "watch" : "ok";
  const tierMap = {
    urgent: { title: t("family.urgentTitle"), sub: t("family.urgentSub"), tone: SEVERITY_TONE.Critical, icon: "ph-warning-octagon" },
    watch: { title: t("family.watchTitle"), sub: t("family.watchSub"), tone: SEVERITY_TONE.Moderate, icon: "ph-warning-circle" },
    ok: { title: t("family.okTitle"), sub: t("family.okSub"), tone: SEVERITY_TONE.Minimal, icon: "ph-check-circle" },
  };
  const p = tierMap[tier];

  return (
    <div style={{ display: "grid", gap: 18, maxWidth: 600 }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.015em" }}>{t("family.title")}</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--color-muted)", marginTop: 4 }}>{t("family.subtitle")}</div>
      </div>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 10 }}>
        <form onSubmit={lookup} className="field">
          <label>{t("family.codeLabel")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" placeholder="JD-4821" value={code} onChange={(e) => setCode(e.target.value)} style={{ flex: 1, minWidth: 0, height: 44, fontSize: 16, letterSpacing: "0.04em" }} />
            <button type="submit" disabled={busy} className="btn btn-primary" style={{ height: 44 }}>{busy ? "…" : t("family.checkButton")}</button>
          </div>
        </form>
        {error && <div style={{ fontSize: 13, color: "var(--color-critical)" }}>{error}</div>}
      </div>
      {data && (
        <div style={{ borderRadius: 16, padding: 20, display: "grid", gap: 14, boxShadow: `0 0 0 1px ${p.tone.fg}`, background: p.tone.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 52, height: 52, borderRadius: "50%", background: p.tone.bg, color: p.tone.fg, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><i className={`ph ${p.icon}`} style={{ fontSize: 26 }} /></span>
            <div>
              <div style={{ fontSize: 13, color: "var(--color-muted)" }}>{data.patientName}</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: p.tone.fg }}>{p.title}</div>
            </div>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.55 }}>{p.sub}</div>
          {tier === "urgent" && (
            <div style={{ display: "grid", gap: 6 }}>
              <a href="tel:108" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, height: 54, borderRadius: 10, background: "var(--color-critical)", color: "#fff", fontSize: 17, fontWeight: 500, textDecoration: "none" }}>
                <i className="ph ph-phone-call" style={{ fontSize: 20 }} /> {t("common.call108")}
              </a>
              <div style={{ fontSize: 13, color: "var(--color-muted)", textAlign: "center" }}>{t("family.tellAsha")}</div>
            </div>
          )}
          {sev && <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{t("family.updated")} {agoLabel(t, sev.createdAt)}</div>}
        </div>
      )}
    </div>
  );
}

function TranscriptDrawer({ conv, onClose, onAdvice }) {
  const { t } = useLang();
  const [advice, setAdvice] = useState("");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,18,28,0.7)", zIndex: 30, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px,100%)", height: "100%", background: "var(--color-surface)", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--color-neutral-800)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{conv.patient_name} <span style={{ fontSize: 12, color: "var(--color-faint)", fontWeight: 400 }}>{conv.patient_code}</span></div>
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

export default function StaffWorkspace({ initialSection = "queue" }) {
  const { t, lang, setLangDirect } = useLang();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState(initialSection);
  const [onDuty, setOnDuty] = useState(!!user?.on_duty);
  const [queue, setQueue] = useState([]);
  const [mine, setMine] = useState([]);
  const [resolvedToday, setResolvedToday] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState("");
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState("");
  const [docCases, setDocCases] = useState([]);
  const [docNewCount, setDocNewCount] = useState(0);
  const [docFilter, setDocFilter] = useState("new");
  const [openDocId, setOpenDocId] = useState(null);
  const [openDocConv, setOpenDocConv] = useState(null);
  const chatRef = useRef(null);
  // The counsellor actually hearing the patient's voice (see lib/voice-
  // call.js) - "idle" | "calling" | "ringing" | "connected".
  const [callState, setCallState] = useState("idle");
  const voiceCallRef = useRef(null);
  const remoteAudioRef = useRef(null);
  // Transcribing the call itself (Phase 2) - see the matching comment in
  // ChatWidget.jsx. The counsellor's own mic gets streamed to the same
  // self-hosted STT pipeline in parallel with the call, tagged "call" in
  // the transcript.
  const callSttRef = useRef(null);
  const callConsentGivenRef = useRef(false);

  async function refreshLists() {
    try {
      const [q, m, d] = await Promise.all([api.counsellorQueue(), api.counsellorMine(), api.doctorQueue(false)]);
      setQueue(q.queue);
      setMine(m.conversations);
      setResolvedToday(m.resolvedToday);
      setDocNewCount(d.cases.length);
    } catch (err) {
      setError(err.message);
    }
  }

  async function refreshDocCases() {
    try {
      const d = await api.doctorQueue(docFilter === "reviewed");
      setDocCases(d.cases);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refreshLists();
    const iv = setInterval(refreshLists, QUEUE_POLL_MS);
    api.me().then((data) => setOnDuty(!!data.user.on_duty)).catch(() => {});
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One /ws/staff socket for the whole shell, open regardless of which
  // section is showing - a "queue_changed" push means someone escalated,
  // claimed, or resolved a case; "doc_changed" means a case was forwarded
  // or a doctor answered. sectionRef/docFilterRef exist because this
  // effect's own closure is set up once on mount and would otherwise keep
  // seeing whichever section/filter was active at that moment.
  const sectionRef = useRef(section);
  const docFilterRef = useRef(docFilter);
  useEffect(() => { sectionRef.current = section; }, [section]);
  useEffect(() => { docFilterRef.current = docFilter; }, [docFilter]);
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const disconnect = connectWs(`/ws/staff?token=${encodeURIComponent(token)}`, {
      onMessage: (msg) => {
        if (msg.type === "queue_changed") refreshLists();
        if (msg.type === "doc_changed") {
          refreshLists();
          if (sectionRef.current === "docq") {
            api.doctorQueue(docFilterRef.current === "reviewed").then((d) => setDocCases(d.cases)).catch(() => {});
          }
        }
      },
    });
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (section !== "docq") return;
    refreshDocCases();
    const iv = setInterval(refreshDocCases, DOC_POLL_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, docFilter]);

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
    // token as a query param, not a header - the backend uses it to
    // attribute any call_transcript_segment on this socket to this real,
    // authenticated counsellor rather than trusting a client-claimed
    // "speaker" field (see /ws/live/{conv_id} in src/api/main.py).
    const disconnectWs = connectWs(`/ws/live/${activeId}?token=${encodeURIComponent(getToken() || "")}`, {
      onMessage: (msg) => {
        if (msg.type === "webrtc_signal") voiceCallRef.current?.handleSignal(msg);
        else poll();
      },
    });

    async function startCallTranscription() {
      if (!callConsentGivenRef.current) {
        if (!window.confirm(t("chat.callTranscriptConsent"))) return;
        callConsentGivenRef.current = true;
      }
      callSttRef.current = startLiveStt({
        onFinal: (text) => {
          if (text.trim()) disconnectWs.send({ type: "call_transcript_segment", text: text.trim() });
        },
        onUnavailable: () => {
          // No self-hosted model, mic denied, or the socket couldn't
          // connect - this side's speech just won't be transcribed.
        },
      });
    }
    async function stopCallTranscription() {
      const controller = await callSttRef.current;
      controller?.stop();
      callSttRef.current = null;
    }

    voiceCallRef.current = createVoiceCall({
      wsSend: disconnectWs.send,
      onRemoteStream: (stream) => { if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream; },
      onStateChange: (state) => {
        setCallState(state);
        if (state === "connected") startCallTranscription();
        else stopCallTranscription();
      },
    });
    return () => {
      cancelled = true;
      clearInterval(iv);
      disconnectWs();
      voiceCallRef.current?.hangUp();
      voiceCallRef.current = null;
      stopCallTranscription();
    };
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
      setSection("conv");
      refreshLists();
    } catch (err) {
      setError(err.message);
      refreshLists();
    }
  }

  async function sendText(text) {
    if (!text.trim() || !activeId) return;
    try {
      await api.counsellorSend(activeId, text);
      setActive(await api.counsellorConversation(activeId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendMessage() {
    const text = draft;
    setDraft("");
    await sendText(text);
  }

  async function doResolve(outcome, note) {
    try {
      await api.counsellorResolve(activeId, outcome, note);
      setDialog(null);
      setActiveId(null);
      setSection("queue");
      refreshLists();
    } catch (err) {
      setError(err.message);
    }
  }

  async function doHandoff(note, urgency) {
    try {
      await api.counsellorHandoff(activeId, note, urgency);
      setDialog(null);
      setActive(await api.counsellorConversation(activeId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function openDocCase(id) {
    try {
      const data = await api.doctorConversation(id);
      setOpenDocId(id);
      setOpenDocConv(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitAdvice(advice) {
    if (!advice.trim()) return;
    try {
      await api.doctorAdvice(openDocId, advice);
      setOpenDocId(null);
      setOpenDocConv(null);
      refreshDocCases();
    } catch (err) {
      setError(err.message);
    }
  }

  const urgentCount = [...queue, ...mine].filter((c) => SEVERITY_RANK[c.severity_level] >= 3).length;
  const sortedQueue = [...queue].sort((a, b) => SEVERITY_RANK[b.severity_level] - SEVERITY_RANK[a.severity_level] || a.created_at - b.created_at);
  const initials = (user?.name || "S").slice(0, 2).toUpperCase();
  const sectionTitle = {
    queue: t("counsellor.queueTitle"),
    conv: t("counsellor.conversationsGroupLabel"),
    docq: t("doctor.forwardedCasesTitle"),
    caregiver: t("family.navLabel"),
  }[section];

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--color-bg)", color: "var(--color-ink)" }}>
      <Sidebar
        t={t} section={section} setSection={setSection}
        queueCount={onDuty ? queue.length : 0} urgentWaiting={urgentCount > 0} mineCount={mine.length} docNewCount={docNewCount}
        roleLabel={user?.name || ""} initials={initials}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <TopBar
          t={t} title={sectionTitle} onDuty={onDuty} toggleDuty={toggleDuty} showDuty={section === "queue"}
          lang={lang} setLangDirect={setLangDirect} onEmergency={() => setDialog("em")} user={user}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 24px 0" }}>
          <button type="button" onClick={() => { logout(); navigate("/"); }} className="btn btn-ghost" style={{ fontSize: 12 }}>{t("common.logout")}</button>
        </div>

        {error && <div style={{ padding: "8px 24px", background: "var(--color-critical-soft)", color: "var(--color-critical)", fontSize: 13 }}>{error}</div>}

        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {section === "queue" && (
            <div style={{ padding: "20px 32px 48px", maxWidth: 1080, margin: "0 auto", width: "100%", overflowY: "auto" }}>
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
                          <span style={{ fontSize: 12, color: "var(--color-faint)" }}>{c.patient_code}{c.vitals?.week ? ` · ${t("guide.weekLabel")} ${c.vitals.week}` : ""} · {c.lang}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "var(--color-muted)", marginTop: 2 }}><ReasonIcon source={c.reason_source} />{c.reason}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 15 }}>{waitLabel(Date.now() - c.created_at * 1000)}</div>
                        <div style={{ fontSize: 11, color: "var(--color-faint)" }}>{t("counsellor.waiting")}</div>
                      </div>
                      <button type="button" onClick={() => claim(c.id)} className="btn btn-primary" style={{ fontSize: 13, whiteSpace: "nowrap" }}><i className="ph ph-hand-grabbing" /> {t("counsellor.claim")}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === "conv" && !active && (
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
                  <button type="button" onClick={() => setSection("queue")} className="btn btn-primary">{t("counsellor.goToQueue")} <i className="ph ph-arrow-right" /></button>
                </>
              )}
            </div>
          )}

          {section === "conv" && active && (
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px" }}>
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--color-neutral-900)" }}>
                {mine.length > 1 && (
                  <div style={{ display: "flex", gap: 6, padding: "10px 16px 0", overflowX: "auto" }}>
                    {mine.map((c) => (
                      <button key={c.id} type="button" onClick={() => setActiveId(c.id)} style={{ padding: "5px 10px", borderRadius: 99, border: `1px solid ${c.id === activeId ? "var(--color-primary)" : "var(--color-border-strong)"}`, background: c.id === activeId ? "var(--color-primary-soft)" : "transparent", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>{c.patient_name}</button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 12, rowGap: 8, flexWrap: "wrap", padding: "12px 16px" }}>
                  <span style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-neutral-900)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500 }}>{active.patient_name.charAt(0)}</span>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 16, fontWeight: 500 }}>{active.patient_name}</span>
                      <SeverityTag level={active.severity_level} />
                    </div>
                    <div style={{ fontSize: 12, color: "var(--color-faint)" }}>
                      {active.patient_code}{active.vitals?.week ? ` · ${t("guide.weekLabel")} ${active.vitals.week}` : ""}{active.age ? ` · ${Math.round(active.age)}y` : ""} · {active.lang}
                    </div>
                  </div>
                  {callState === "idle" && (
                    <button type="button" onClick={() => voiceCallRef.current?.startCall()} className="btn btn-secondary" style={{ fontSize: 13 }}>
                      <i className="ph ph-phone-call" /> {t("chat.voiceCall")}
                    </button>
                  )}
                  {callState === "calling" && (
                    <button type="button" onClick={() => voiceCallRef.current?.hangUp()} className="btn btn-secondary" style={{ fontSize: 13, color: "var(--color-primary)" }}>
                      <i className="ph ph-phone-outgoing animate-pulse" /> {t("chat.callCalling")}
                    </button>
                  )}
                  {callState === "ringing" && (
                    <>
                      <button type="button" onClick={() => voiceCallRef.current?.acceptCall()} className="btn btn-primary" style={{ fontSize: 13 }}>
                        <i className="ph ph-phone-incoming animate-pulse" /> {t("chat.callAccept")}
                      </button>
                      <button type="button" onClick={() => voiceCallRef.current?.declineCall()} className="btn btn-secondary" style={{ fontSize: 13, color: "var(--color-critical)" }}>
                        {t("chat.callDecline")}
                      </button>
                    </>
                  )}
                  {callState === "connected" && (
                    <button type="button" onClick={() => voiceCallRef.current?.hangUp()} className="btn btn-secondary" style={{ fontSize: 13, color: "var(--color-good)" }}>
                      <i className="ph ph-phone-call" /> {t("chat.callConnected")} · {t("chat.callHangUp")}
                    </button>
                  )}
                  <button type="button" onClick={() => setDialog("handoff")} disabled={!!active.forwarded} className="btn btn-secondary" style={{ fontSize: 13 }}>
                    <i className={`ph ${active.forwarded ? "ph-check" : "ph-stethoscope"}`} /> {active.forwarded ? t("counsellor.loopedIn") : t("counsellor.loopInDoctor")}
                  </button>
                  <button type="button" onClick={() => setDialog("resolve")} className="btn btn-primary" style={{ fontSize: 13 }}><i className="ph ph-check-circle" /> {t("counsellor.resolve")}</button>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 16px", background: "oklch(0.22 0.03 25)", borderTop: "1px solid oklch(0.3 0.05 25)", borderBottom: "1px solid oklch(0.3 0.05 25)" }}>
                  <span style={{ fontSize: 12, color: "oklch(0.87 0.07 25)" }}>{t("counsellor.emergencyStayOn")}</span>
                  <a href="tel:108" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>108</b> {t("counsellor.ambulanceLabel")}</a>
                  <a href="tel:102" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>102</b> {t("counsellor.transportLabel")}</a>
                  <a href="tel:18005990019" style={{ padding: "3px 9px", borderRadius: 99, border: "1px solid oklch(0.45 0.08 25)", fontSize: 12, color: "oklch(0.9 0.05 25)", textDecoration: "none" }}><b>KIRAN</b></a>
                  <div style={{ flex: 1 }} />
                  <button type="button" onClick={() => sendText(SEND_NUMBERS_TEXT)} className="btn btn-ghost" style={{ fontSize: 12, padding: "3px 8px", color: "oklch(0.87 0.07 25)" }}><i className="ph ph-paper-plane-tilt" /> {t("counsellor.sendNumbers")}</button>
                </div>
                <div ref={chatRef} style={{ flex: 1, minHeight: 220, overflowY: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
                  {active.messages.map((m) => <Bubble key={m.id} m={m} convId={activeId} />)}
                </div>
                <div style={{ borderTop: "1px solid var(--color-neutral-900)", padding: "10px 16px 14px", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                    {QUICK_REPLIES.map((q) => (
                      <button key={q.labelKey} type="button" onClick={() => sendText(q.text)} style={{ padding: "5px 10px", borderRadius: 99, border: "1px solid var(--color-neutral-800)", background: "none", fontSize: 12, color: "var(--color-muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                        {t(q.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="input" placeholder={t("counsellor.writeMessage")} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } }} style={{ flex: 1, minWidth: 0, height: 44 }} />
                    <button type="button" onClick={sendMessage} className="btn btn-primary btn-icon" style={{ width: 44, height: 44 }} aria-label={t("counsellor.sendAriaLabel")}><i className="ph ph-paper-plane-right" style={{ fontSize: 18 }} /></button>
                  </div>
                </div>
              </div>
              <ContextRail conv={active} />
            </div>
          )}

          {section === "docq" && (
            <div style={{ padding: "20px 32px 48px", maxWidth: 900, margin: "0 auto", width: "100%", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 500 }}>{t("doctor.forwardedCasesTitle")}</div>
                  <div style={{ fontSize: 13, color: "var(--color-muted)" }}>{t("doctor.forwardedCasesSubtitle")}</div>
                </div>
                <div style={{ display: "flex", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
                  <button type="button" onClick={() => setDocFilter("new")} style={{ padding: "6px 12px", border: 0, cursor: "pointer", fontSize: 13, background: docFilter === "new" ? "var(--color-primary-soft)" : "transparent", color: docFilter === "new" ? "var(--color-primary)" : "var(--color-muted)" }}>{t("doctor.filterNew")}</button>
                  <button type="button" onClick={() => setDocFilter("reviewed")} style={{ padding: "6px 12px", border: 0, cursor: "pointer", fontSize: 13, background: docFilter === "reviewed" ? "var(--color-primary-soft)" : "transparent", color: docFilter === "reviewed" ? "var(--color-primary)" : "var(--color-muted)" }}>{t("doctor.filterReviewed")}</button>
                </div>
              </div>

              {docCases.length === 0 ? (
                <div style={{ padding: 28, borderRadius: 14, boxShadow: "0 0 0 1px var(--color-border-strong)", color: "var(--color-muted)", fontSize: 14, textAlign: "center" }}>
                  {t("doctor.emptyCases")}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {docCases.map((c) => (
                    <div key={c.id} style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 10, boxShadow: c.handoff_urgency === "hour" && !c.advice ? "0 0 0 1px var(--color-critical)" : "0 0 0 1px var(--color-border-strong)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <SeverityTag level={c.severity_level} />
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{c.patient_name}</span>
                        <span style={{ fontSize: 12, color: "var(--color-faint)" }}>{c.patient_code}{c.vitals?.week ? ` · ${t("guide.weekLabel")} ${c.vitals.week}` : ""}</span>
                        <div style={{ flex: 1 }} />
                        <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 12, border: "1px solid var(--color-border-strong)", color: "var(--color-muted)" }}>
                          {c.handoff_urgency === "hour" ? t("counsellor.urgencyHour") : c.handoff_urgency === "today" ? t("counsellor.urgencyToday") : t("counsellor.urgencyRoutine")}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{agoLabel(t, c.created_at)}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div style={{ padding: 12, borderRadius: 10, background: "var(--color-neutral-900)", display: "grid", gap: 6, alignContent: "start" }}>
                          <div style={{ fontSize: 11, color: "var(--color-muted)", display: "flex", gap: 5, alignItems: "center" }}><i className="ph ph-note" />{t("counsellor.handoffNoteLabel")}</div>
                          <div style={{ fontSize: 14, lineHeight: 1.5 }}>{c.handoff_note}</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 10, boxShadow: "0 0 0 1px var(--color-border-strong)", display: "grid", gap: 6, alignContent: "start" }}>
                          <div style={{ fontSize: 11, color: "var(--color-muted)", display: "flex", gap: 5, alignItems: "center" }}><i className="ph ph-chat-text" />{t("counsellor.transcriptAttachedLabel")} · {c.message_count} {t("counsellor.msgsCountLabel")}</div>
                          {(c.preview || []).map((pv, i) => (
                            <div key={i} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--color-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              <span style={{ color: pv.sender_kind === "counsellor" ? "var(--color-primary)" : "var(--color-faint)" }}>
                                {(pv.sender_kind === "patient" ? t("counsellor.senderPatient") : pv.sender_kind === "bot" ? t("doctor.senderAssistant") : t("chat.counsellorLabel"))}:
                              </span> {pv.text}
                            </div>
                          ))}
                        </div>
                      </div>
                      {c.advice && (
                        <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--color-primary-soft)", fontSize: 14, lineHeight: 1.5 }}>
                          <div style={{ fontSize: 11, color: "var(--color-primary)" }}>{t("doctor.reviewed")}</div>{c.advice}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => openDocCase(c.id)} className="btn btn-secondary" style={{ fontSize: 13 }}><i className="ph ph-article" /> {t("doctor.openTranscript")}</button>
                        {!c.advice && <button type="button" onClick={() => openDocCase(c.id)} className="btn btn-primary" style={{ fontSize: 13 }}><i className="ph ph-pencil-simple" /> {t("doctor.writeAdvice")}</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === "caregiver" && (
            <div style={{ padding: "20px 32px 48px", maxWidth: 1080, margin: "0 auto", width: "100%", overflowY: "auto" }}>
              <FamilySection />
            </div>
          )}
        </main>
      </div>

      {dialog === "em" && <EmergencyDialog onClose={() => setDialog(null)} />}
      {dialog === "resolve" && active && <ResolveDialog conv={active} onClose={() => setDialog(null)} onResolve={doResolve} />}
      {dialog === "handoff" && active && <HandoffDialog conv={active} messageCount={active.messages.filter((m) => m.sender_kind !== "system").length} onClose={() => setDialog(null)} onSend={doHandoff} />}
      {openDocConv && <TranscriptDrawer conv={openDocConv} onClose={() => { setOpenDocId(null); setOpenDocConv(null); }} onAdvice={submitAdvice} />}
    </div>
  );
}
