import { KEYS, scopedGet } from "./storage";
import { severityLabel } from "./severity";

// Shared with HomePage (a compact "what changed" hint near the top of the
// app, where people actually look first) and HistoryPage (the full
// sparkline/bar-chart breakdown) - kept in one place so a result "feeding
// forward" means the same thing, computed the same way, in both spots.
export const LEVEL_ORDER = ["Minimal", "Mild", "Moderate", "Severe", "Critical"];

export function firstLastValid(values) {
  const valid = values.filter((v) => v != null);
  if (valid.length < 2) return null;
  return { first: valid[0], last: valid[valid.length - 1] };
}

// This module is plain JS (no React, no useLang), but its notes are
// fully frontend-owned copy worth translating - so it returns i18n KEYS
// and params rather than baked-in English strings, and this helper (used
// by both HomePage and HistoryPage) does the {placeholder} substitution
// once a component's own t() is available.
export function renderTrendNote(t, note) {
  let text = t(note.textKey);
  for (const [key, value] of Object.entries(note.params || {})) {
    const resolved = note.severityParams?.includes(key) ? severityLabel(t, value) : value;
    text = text.replace(`{${key}}`, resolved);
  }
  return { tone: note.tone, label: t(note.labelKey), text };
}

function buildTrendSummary(series, chronological) {
  const notes = [];
  const hbFl = firstLastValid(series.hb);
  if (hbFl && Math.abs(hbFl.last - hbFl.first) >= 0.3) {
    const improving = hbFl.last > hbFl.first;
    notes.push({
      tone: improving ? "var(--color-good)" : "var(--color-warning)",
      labelKey: improving ? "trends.improving" : "trends.needsAttention",
      textKey: improving ? "trends.hbImproving" : "trends.hbDeclining",
      params: { first: hbFl.first, last: hbFl.last },
    });
  }
  const sbpFl = firstLastValid(series.sbp);
  if (sbpFl && Math.abs(sbpFl.last - sbpFl.first) >= 5) {
    const worsening = sbpFl.last > sbpFl.first;
    notes.push({
      tone: worsening ? "var(--color-warning)" : "var(--color-good)",
      labelKey: worsening ? "trends.needsAttention" : "trends.improving",
      textKey: worsening ? "trends.bpWorsening" : "trends.bpImproving",
      params: { first: sbpFl.first, last: sbpFl.last },
    });
  }
  const weightFl = firstLastValid(series.weight);
  if (weightFl && weightFl.last < weightFl.first) {
    notes.push({
      tone: "var(--color-warning)", labelKey: "trends.needsAttention", textKey: "trends.weightDecreased",
      params: { first: weightFl.first, last: weightFl.last },
    });
  } else if (weightFl && weightFl.last - weightFl.first >= 2) {
    notes.push({
      tone: "var(--color-warning)", labelKey: "trends.needsAttention", textKey: "trends.weightRapidGain",
      params: { first: weightFl.first, last: weightFl.last },
    });
  }
  if (chronological.length >= 2) {
    const prev = chronological[chronological.length - 2];
    const latest = chronological[chronological.length - 1];
    if (prev.severityLevel !== latest.severityLevel) {
      const increased = LEVEL_ORDER.indexOf(latest.severityLevel) > LEVEL_ORDER.indexOf(prev.severityLevel);
      const escalatedBy = latest.result?.severity?.escalatedBy;
      const hasReason = !!escalatedBy;
      notes.push({
        tone: increased ? "var(--color-critical)" : "var(--color-good)",
        labelKey: increased ? "trends.needsAttention" : "trends.improving",
        textKey: increased
          ? (hasReason ? "trends.riskIncreasedReason" : "trends.riskIncreasedNoReason")
          : (hasReason ? "trends.riskDecreasedReason" : "trends.riskDecreasedNoReason"),
        params: { prev: prev.severityLevel, latest: latest.severityLevel, escalatedBy: hasReason ? escalatedBy.replace(/_/g, " ") : "" },
        severityParams: ["prev", "latest"],
      });
    }
  }
  return notes;
}

// history is the newest-first array useHistory()/appendHistoryEntry()
// already produce.
export function computeHealthTrends(history) {
  const reportLog = scopedGet(KEYS.REPORT_VITALS_LOG) || [];
  if (history.length < 2 && reportLog.length < 2) {
    return { tiles: [], bpPoints: [], summaryNotes: [], hasData: false };
  }

  const chronological = [...history].reverse();
  const assessPoints = chronological.map((h) => ({
    t: new Date(h.timestamp).getTime(),
    mri: h.mri,
    sbp: h.result?.vitalsInput ? h.result.vitalsInput.SystolicBP : null,
    bs: h.result?.vitalsInput ? h.result.vitalsInput.BS : null,
    hb: h.result?.hemoglobinAssessment ? h.result.hemoglobinAssessment.hemoglobin : null,
    weight: h.result?.weightInput != null ? h.result.weightInput : null,
  }));
  const reportPoints = reportLog.map((r) => ({
    t: new Date(r.timestamp).getTime(),
    mri: null,
    sbp: r.systolicBP ?? null,
    bs: r.bloodSugar ?? null,
    hb: r.hemoglobin ?? null,
    weight: null,
  }));
  const merged = [...assessPoints, ...reportPoints].sort((a, b) => a.t - b.t);

  const series = {
    mri: merged.map((p) => p.mri),
    sbp: merged.map((p) => p.sbp),
    bs: merged.map((p) => p.bs),
    hb: merged.map((p) => p.hb),
    weight: merged.map((p) => p.weight),
  };

  const bpPoints = merged.filter((p) => p.sbp != null).map((p) => ({ date: new Date(p.t), sbp: p.sbp })).slice(-6);

  return {
    tiles: [
      { labelKey: "trends.tileRiskScore", values: series.mri, color: "#ef6f93", unit: "" },
      { labelKey: "trends.tileBloodSugar", values: series.bs, color: "#f5b942", unit: " mmol/L" },
      { labelKey: "trends.tileHemoglobin", values: series.hb, color: "#4ade80", unit: " g/dL" },
      { labelKey: "trends.tileWeight", values: series.weight, color: "#c99a4a", unit: " kg" },
    ],
    bpPoints,
    summaryNotes: buildTrendSummary(series, chronological),
    hasData: true,
  };
}
