import { useMemo } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Pill from "../components/ui/Pill";
import Sparkline from "../components/ui/Sparkline";
import { useHistory } from "../lib/useHistory";
import { KEYS, scopedGet, scopedRemove } from "../lib/storage";

const LEVEL_TONE = { Critical: "critical", Severe: "critical", Moderate: "warning", Mild: "good", Minimal: "good" };
const LEVEL_ORDER = ["Minimal", "Mild", "Moderate", "Severe", "Critical"];

function firstLastValid(values) {
  const valid = values.filter((v) => v != null);
  if (valid.length < 2) return null;
  return { first: valid[0], last: valid[valid.length - 1] };
}

function TrendTile({ label, values, color, unit }) {
  const fl = firstLastValid(values);
  if (!fl) return null;
  const diff = fl.last - fl.first;
  const arrow = diff > 0.05 ? "↑" : diff < -0.05 ? "↓" : "→";
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <span className="text-sm text-muted">{arrow}</span>
      </div>
      <Sparkline values={values} color={color} />
      <p className="mt-1 text-sm text-ink">{fl.first}{unit} → {fl.last}{unit}</p>
    </Card>
  );
}

function buildTrendSummary(series, chronological) {
  const notes = [];
  const hbFl = firstLastValid(series.hb);
  if (hbFl && Math.abs(hbFl.last - hbFl.first) >= 0.3) {
    notes.push(
      hbFl.last > hbFl.first
        ? `Your hemoglobin has improved across your recent checks (${hbFl.first} → ${hbFl.last} g/dL).`
        : `Your hemoglobin has been declining across your recent checks (${hbFl.first} → ${hbFl.last} g/dL) - worth mentioning at your next visit.`
    );
  }
  const sbpFl = firstLastValid(series.sbp);
  if (sbpFl && Math.abs(sbpFl.last - sbpFl.first) >= 5) {
    notes.push(
      sbpFl.last > sbpFl.first
        ? `Your blood pressure has been trending up (${sbpFl.first} → ${sbpFl.last} mmHg systolic) - worth watching closely.`
        : `Your blood pressure has improved (${sbpFl.first} → ${sbpFl.last} mmHg systolic).`
    );
  }
  const weightFl = firstLastValid(series.weight);
  if (weightFl && weightFl.last < weightFl.first) {
    notes.push(`Your weight has decreased across your recent checks (${weightFl.first} → ${weightFl.last} kg) - worth mentioning at your next visit.`);
  } else if (weightFl && weightFl.last - weightFl.first >= 2) {
    notes.push(`Your weight has risen quickly across your recent checks (${weightFl.first} → ${weightFl.last} kg) - worth watching for fluid retention.`);
  }
  if (chronological.length >= 2) {
    const prev = chronological[chronological.length - 2];
    const latest = chronological[chronological.length - 1];
    if (prev.severityLevel !== latest.severityLevel) {
      const increased = LEVEL_ORDER.indexOf(latest.severityLevel) > LEVEL_ORDER.indexOf(prev.severityLevel);
      const escalatedBy = latest.result?.severity?.escalatedBy;
      const reason = escalatedBy ? ` because of ${escalatedBy.replace(/_/g, " ")}` : "";
      notes.push(`Your risk level ${increased ? "increased" : "decreased"} from ${prev.severityLevel} to ${latest.severityLevel}${reason}.`);
    }
  }
  return notes;
}

function HealthTrends({ history }) {
  const reportLog = scopedGet(KEYS.REPORT_VITALS_LOG) || [];

  const { tiles, summaryNotes, hasData } = useMemo(() => {
    if (history.length < 2 && reportLog.length < 2) return { tiles: [], summaryNotes: [], hasData: false };

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

    return {
      tiles: [
        { label: "Risk Score (MRI)", values: series.mri, color: "#ef6f93", unit: "" },
        { label: "Systolic BP", values: series.sbp, color: "#ff5c5c", unit: " mmHg" },
        { label: "Blood Sugar", values: series.bs, color: "#f5b942", unit: " mmol/L" },
        { label: "Hemoglobin", values: series.hb, color: "#4ade80", unit: " g/dL" },
        { label: "Weight", values: series.weight, color: "#c99a4a", unit: " kg" },
      ],
      summaryNotes: buildTrendSummary(series, chronological),
      hasData: true,
    };
  }, [history, reportLog]);

  if (!hasData) {
    return <p className="text-sm text-muted">Not enough data yet - run at least 2 assessments (or confirm values from an uploaded report in My Reports) to see trends here.</p>;
  }
  const visibleTiles = tiles.filter((t) => firstLastValid(t.values));
  if (!visibleTiles.length) {
    return <p className="text-sm text-muted">Not enough repeated vitals/hemoglobin data yet to chart a trend - the risk trend needs at least 2 assessments with vitals or hemoglobin entered.</p>;
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTiles.map((t) => <TrendTile key={t.label} {...t} />)}
      </div>
      <div className="mt-3 space-y-1.5">
        {summaryNotes.length ? (
          summaryNotes.map((n, i) => <p key={i} className="text-sm text-ink">📈 {n}</p>)
        ) : (
          <p className="text-sm text-muted">No major changes detected across your recent assessments.</p>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { history, loading, refetch } = useHistory();

  function handleClear() {
    if (!window.confirm("Clear your local assessment history on this device?")) return;
    scopedRemove(KEYS.HISTORY);
    refetch();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <h1 className="text-xl font-bold text-ink">Health Trends</h1>
        <p className="mb-3 text-sm text-muted">How your key numbers and risk level have changed across your assessments.</p>
        {loading ? <p className="text-sm text-muted">Loading…</p> : <HealthTrends history={history} />}
      </Card>

      <Card>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Assessment History</h2>
          <button type="button" onClick={handleClear} className="text-xs font-semibold text-muted hover:text-critical">
            Clear
          </button>
        </div>
        <p className="mb-3 text-xs text-faint">Stored only in this browser (not sent anywhere).</p>

        {!loading && history.length === 0 && <p className="text-sm text-muted">No assessments yet.</p>}

        <div className="divide-y divide-border">
          {history.map((entry, i) => {
            const tone = LEVEL_TONE[entry.severityLevel] || "neutral";
            return (
              <div key={i} className="flex items-center justify-between py-3">
                <div>
                  <Pill tone={tone}>{entry.severityLevel}</Pill>
                  <p className="mt-1 text-xs text-faint">{new Date(entry.timestamp).toLocaleString()}</p>
                </div>
                <span className="text-sm text-muted">MRI {entry.mri}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
