import { KEYS, scopedGet } from "./storage";

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

function buildTrendSummary(series, chronological) {
  const notes = [];
  const hbFl = firstLastValid(series.hb);
  if (hbFl && Math.abs(hbFl.last - hbFl.first) >= 0.3) {
    const improving = hbFl.last > hbFl.first;
    notes.push({
      tone: improving ? "var(--color-good)" : "var(--color-warning)",
      label: improving ? "Improving" : "Needs Attention",
      text: improving
        ? `Your hemoglobin has improved across your recent checks (${hbFl.first} → ${hbFl.last} g/dL).`
        : `Your hemoglobin has been declining across your recent checks (${hbFl.first} → ${hbFl.last} g/dL) - worth mentioning at your next visit.`,
    });
  }
  const sbpFl = firstLastValid(series.sbp);
  if (sbpFl && Math.abs(sbpFl.last - sbpFl.first) >= 5) {
    const worsening = sbpFl.last > sbpFl.first;
    notes.push({
      tone: worsening ? "var(--color-warning)" : "var(--color-good)",
      label: worsening ? "Needs Attention" : "Improving",
      text: worsening
        ? `Your blood pressure has been trending up (${sbpFl.first} → ${sbpFl.last} mmHg systolic) - worth watching closely.`
        : `Your blood pressure has improved (${sbpFl.first} → ${sbpFl.last} mmHg systolic).`,
    });
  }
  const weightFl = firstLastValid(series.weight);
  if (weightFl && weightFl.last < weightFl.first) {
    notes.push({ tone: "var(--color-warning)", label: "Needs Attention", text: `Your weight has decreased across your recent checks (${weightFl.first} → ${weightFl.last} kg) - worth mentioning at your next visit.` });
  } else if (weightFl && weightFl.last - weightFl.first >= 2) {
    notes.push({ tone: "var(--color-warning)", label: "Needs Attention", text: `Your weight has risen quickly across your recent checks (${weightFl.first} → ${weightFl.last} kg) - worth watching for fluid retention.` });
  }
  if (chronological.length >= 2) {
    const prev = chronological[chronological.length - 2];
    const latest = chronological[chronological.length - 1];
    if (prev.severityLevel !== latest.severityLevel) {
      const increased = LEVEL_ORDER.indexOf(latest.severityLevel) > LEVEL_ORDER.indexOf(prev.severityLevel);
      const escalatedBy = latest.result?.severity?.escalatedBy;
      const reason = escalatedBy ? ` because of ${escalatedBy.replace(/_/g, " ")}` : "";
      notes.push({
        tone: increased ? "var(--color-critical)" : "var(--color-good)",
        label: increased ? "Needs Attention" : "Improving",
        text: `Your risk level ${increased ? "increased" : "decreased"} from ${prev.severityLevel} to ${latest.severityLevel}${reason}.`,
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
      { label: "Risk Score (MRI)", values: series.mri, color: "#ef6f93", unit: "" },
      { label: "Blood Sugar", values: series.bs, color: "#f5b942", unit: " mmol/L" },
      { label: "Hemoglobin", values: series.hb, color: "#4ade80", unit: " g/dL" },
      { label: "Weight", values: series.weight, color: "#c99a4a", unit: " kg" },
    ],
    bpPoints,
    summaryNotes: buildTrendSummary(series, chronological),
    hasData: true,
  };
}
