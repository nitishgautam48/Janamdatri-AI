import { useState } from "react";
import { useLang } from "../../context/LangContext";
import { loadCriticalFollowup, acknowledgeCriticalFollowup } from "../../lib/storage";

// Shared between HomePage (its full inline card) and GlobalEmergencyBanner
// (a compact strip on every OTHER page) so a Critical/Severe result's
// "did you get care?" follow-up is a genuine cross-page reminder, not
// something only visible to someone who happens to land back on Home -
// and so the wording ESCALATES the longer a "not yet" sits unanswered,
// rather than showing the same static line forever until someone gets
// around to reopening the app.
const LONG_WAIT_HOURS = 24;

export default function CriticalFollowUp({ assessmentTimestamp, severityLevel, compact = false }) {
  const { t } = useLang();
  const [record, setRecord] = useState(() => loadCriticalFollowup());
  const alreadyAnswered = record?.assessmentTimestamp === assessmentTimestamp;

  function respond(soughtCare) {
    setRecord(acknowledgeCriticalFollowup(assessmentTimestamp, soughtCare));
  }

  if (alreadyAnswered && record.soughtCare) {
    // Resolved - nothing left to remind about. Home still shows a small
    // confirmation note; the compact banner strip just disappears rather
    // than cluttering every other page with a "you're fine" message.
    if (compact) return null;
    return (
      <p style={{ marginTop: 10, fontSize: "0.8125rem", color: "var(--color-good)" }}>
        ✓ {t("home.followupConfirmedPrefix")}{new Date(record.respondedAt).toLocaleDateString()}{t("home.followupConfirmedSuffix")}
      </p>
    );
  }

  const hoursSinceAnswer = alreadyAnswered ? (Date.now() - new Date(record.respondedAt).getTime()) / 36e5 : 0;
  const longWait = alreadyAnswered && !record.soughtCare && hoursSinceAnswer >= LONG_WAIT_HOURS;

  const questionText = alreadyAnswered && !record.soughtCare
    ? (longWait
        ? <>{t("home.followupUrgentLongPrefix")}{severityLevel}{t("home.followupUrgentLongSuffix")}</>
        : <>{t("home.followupUrgentPrefix")}{severityLevel}{t("home.followupUrgentSuffix")}</>)
    : t("home.followupQuestion");

  if (compact) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, width: "100%", paddingTop: 6, marginTop: 6, borderTop: "1px solid rgba(255,255,255,0.25)" }}>
        <p style={{ flex: 1, minWidth: 200, fontSize: "0.8125rem", fontWeight: longWait ? 700 : 500 }}>{questionText}</p>
        <button type="button" onClick={() => respond(true)} className="whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-bold text-critical">
          ✓ {t("home.followupYes")}
        </button>
        <button type="button" onClick={() => respond(false)} style={{ whiteSpace: "nowrap", borderRadius: 99, border: "1px solid rgba(255,255,255,0.6)", background: "none", color: "#fff", padding: "6px 12px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
          {t("home.followupNotYet")}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, borderRadius: 10, border: "1px solid var(--color-critical)", padding: 12, display: "grid", gap: 8 }}>
      <p style={{ fontSize: "0.8125rem", fontWeight: longWait || (alreadyAnswered && !record.soughtCare) ? 600 : 400, color: alreadyAnswered && !record.soughtCare ? "var(--color-critical)" : "var(--color-text)" }}>
        {questionText}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => respond(true)} className="btn btn-primary" style={{ fontSize: "0.75rem" }}>
          ✓ {t("home.followupYes")}
        </button>
        <button type="button" onClick={() => respond(false)} className="btn btn-secondary" style={{ fontSize: "0.75rem" }}>
          {t("home.followupNotYet")}
        </button>
      </div>
    </div>
  );
}
