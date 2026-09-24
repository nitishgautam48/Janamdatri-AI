import { useMemo } from "react";
import { Link } from "react-router-dom";
import Spinner from "../components/ui/Spinner";
import Sparkline from "../components/ui/Sparkline";
import { useHistory } from "../lib/useHistory";
import { KEYS, scopedRemove } from "../lib/storage";
import { computeHealthTrends, firstLastValid } from "../lib/trends";

const LEVEL_COLOR = {
  Critical: "var(--color-critical)", Severe: "var(--color-critical)",
  Moderate: "var(--color-warning)", Mild: "var(--color-good)", Minimal: "var(--color-good)",
};
const LEVEL_TINT = {
  Critical: "var(--color-critical-soft)", Severe: "var(--color-critical-soft)",
  Moderate: "var(--color-warning-soft)", Mild: "var(--color-good-soft)", Minimal: "var(--color-good-soft)",
};
const LEVEL_ICON = {
  Critical: "ph-warning", Severe: "ph-warning",
  Moderate: "ph-warning-circle", Mild: "ph-check-circle", Minimal: "ph-check-circle",
};
function TrendTile({ label, values, color, unit }) {
  const fl = firstLastValid(values);
  if (!fl) return null;
  const diff = fl.last - fl.first;
  const arrow = diff > 0.05 ? "↑" : diff < -0.05 ? "↓" : "→";
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: 14, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="eyebrow">{label}</p>
        <span style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{arrow}</span>
      </div>
      <Sparkline values={values} color={color} />
      <p style={{ marginTop: 4, fontSize: "0.875rem", color: "var(--color-text)" }}>{fl.first}{unit} → {fl.last}{unit}</p>
    </div>
  );
}

// Literal bar-chart port of the mockup's BP trend (Janamdatri App v2.dc.html
// lines 365-371): bars scaled across a 60-180 mmHg range with a dashed
// 140 mmHg threshold line, rather than the sparkline used for the other
// metrics - blood pressure is the one trend the mockup gives its own
// chart form, since crossing 140 is a clinically meaningful line to see.
const BP_MIN = 60, BP_MAX = 180, BP_THRESHOLD = 140;
function bpPct(v) {
  return Math.max(4, Math.min(100, ((v - BP_MIN) / (BP_MAX - BP_MIN)) * 100));
}

function BpBarChart({ points }) {
  if (!points.length) return null;
  const thresholdBottom = bpPct(BP_THRESHOLD);
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: 14, display: "grid", gap: 10, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p className="eyebrow">Blood pressure trend</p>
        <div style={{ fontSize: "0.6875rem", color: "var(--color-neutral-500)", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ width: 14, borderTop: "1px dashed var(--color-critical)" }} />
          {BP_THRESHOLD}
        </div>
      </div>
      <div style={{ position: "relative", height: 120, display: "flex", alignItems: "flex-end", gap: 10, paddingTop: 6 }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: `${thresholdBottom}%`, borderTop: "1px dashed var(--color-critical)", opacity: 0.7 }} />
        {points.map((p, i) => {
          const color = p.sbp >= 140 ? "var(--color-critical)" : p.sbp >= 130 ? "var(--color-warning)" : "var(--color-good)";
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, justifyContent: "flex-end", height: "100%" }}>
              <span style={{ fontSize: "0.6875rem", color: "var(--color-neutral-400)" }}>{p.sbp}</span>
              <div style={{ width: "100%", maxWidth: 36, height: `${bpPct(p.sbp)}%`, borderRadius: "6px 6px 2px 2px", background: color, opacity: 0.85 }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {points.map((p, i) => (
          <span key={i} style={{ flex: 1, textAlign: "center", fontSize: "0.6875rem", color: "var(--color-neutral-500)" }}>
            {p.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        ))}
      </div>
    </div>
  );
}

function HealthTrends({ history }) {
  const { tiles, bpPoints, summaryNotes, hasData } = useMemo(() => computeHealthTrends(history), [history]);

  if (!hasData) {
    return <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>Not enough data yet - run at least 2 assessments (or confirm values from an uploaded report in My Reports) to see trends here.</p>;
  }
  const visibleTiles = tiles.filter((t) => firstLastValid(t.values));
  if (!visibleTiles.length && bpPoints.length < 2) {
    return <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>Not enough repeated vitals/hemoglobin data yet to chart a trend - the risk trend needs at least 2 assessments with vitals or hemoglobin entered.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {bpPoints.length >= 2 && <BpBarChart points={bpPoints} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
        {visibleTiles.map((t) => <TrendTile key={t.label} {...t} />)}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <p className="eyebrow">What Changed</p>
        {summaryNotes.length ? (
          summaryNotes.map((n, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ flex: "none", marginTop: 2, borderRadius: 99, border: `1px solid ${n.tone}`, color: n.tone, padding: "1px 8px", fontSize: "0.6875rem" }}>{n.label}</span>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{n.text}</p>
            </div>
          ))
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ borderRadius: 99, border: "1px solid var(--color-good)", color: "var(--color-good)", padding: "1px 8px", fontSize: "0.6875rem" }}>Stable</span>
            <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>No major changes detected across your recent assessments.</p>
          </div>
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
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Link to="/referral" className="btn btn-primary" style={{ fontSize: "0.8125rem", textDecoration: "none" }}>
          <i className="ph ph-file-text" /> Referral Summary →
        </Link>
      </div>

      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 12, boxShadow: "var(--shadow-sm)" }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--color-text)" }}>Health Trends</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>How your key numbers and risk level have changed across your assessments.</p>
        </div>
        {loading ? <Spinner /> : <HealthTrends history={history} />}
      </div>

      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8, boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)" }}>Assessment History</h2>
          <button type="button" onClick={handleClear} className="btn btn-ghost" style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>
            Clear
          </button>
        </div>
        <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>Stored only in this browser (not sent anywhere).</p>

        {!loading && history.length === 0 && <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>No assessments yet.</p>}

        {history.map((entry, i) => {
          const color = LEVEL_COLOR[entry.severityLevel] || "var(--color-neutral-400)";
          const tint = LEVEL_TINT[entry.severityLevel] || "var(--color-neutral-800)";
          const icon = LEVEL_ICON[entry.severityLevel] || "ph-info";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i > 0 ? "1px solid var(--color-neutral-800)" : "none" }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: tint, color, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", fontSize: "1.125rem" }}>
                <i className={`ph ${icon}`} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{entry.severityLevel}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{new Date(entry.timestamp).toLocaleString()}</div>
              </div>
              <span style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>MRI {entry.mri}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
