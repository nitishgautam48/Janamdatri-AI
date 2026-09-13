import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Pill from "../components/ui/Pill";
import Spinner from "../components/ui/Spinner";
import { api } from "../lib/api";
import { loadRoster, addToRoster, removeFromRoster } from "../lib/providerRoster";

const LEVEL_TONE = { Critical: "critical", Severe: "critical", Moderate: "warning", Mild: "good", Minimal: "good" };

function PatientDetail({ data }) {
  return (
    <>
      {data.latestAssessment ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-sm text-ink">
            <strong>Risk level:</strong> {data.latestAssessment.severityLevel} (MRI {data.latestAssessment.mri})
          </p>
          <p className="mt-1 text-xs text-muted">
            Recorded: {new Date(data.latestAssessment.createdAt * 1000).toLocaleString()}
          </p>
          {data.latestAssessment.vitalsInput && (
            <p className="mt-2 text-sm text-ink">
              <strong>Vitals:</strong> BP {data.latestAssessment.vitalsInput.SystolicBP}/{data.latestAssessment.vitalsInput.DiastolicBP}, blood
              sugar {data.latestAssessment.vitalsInput.BS} mmol/L, temp {data.latestAssessment.vitalsInput.BodyTemp}°F, heart rate{" "}
              {data.latestAssessment.vitalsInput.HeartRate} bpm
            </p>
          )}
          {data.latestAssessment.hemoglobinAssessment && (
            <p className="mt-2 text-sm text-ink">
              <strong>Hemoglobin:</strong> {data.latestAssessment.hemoglobinAssessment.hemoglobin} g/dL (
              {data.latestAssessment.hemoglobinAssessment.grade})
            </p>
          )}
          {data.latestAssessment.explanation?.warningSigns?.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-semibold text-ink">Warning signs:</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-critical">
                {data.latestAssessment.explanation.warningSigns.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {data.latestAssessment.explanation?.recommendedNextAction && (
            <p className="mt-3 text-sm text-ink">
              <strong>Recommended next action:</strong> {data.latestAssessment.explanation.recommendedNextAction}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted">No assessment recorded yet.</p>
      )}

      {data.latestNutrition && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="eyebrow mb-1">Latest Nutrition Check</p>
          <p className="text-xs text-muted">Recorded: {new Date(data.latestNutrition.createdAt * 1000).toLocaleString()}</p>
          {data.latestNutrition.gaps?.length ? (
            <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink">
              {data.latestNutrition.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-ink">No nutrition gaps flagged.</p>
          )}
        </div>
      )}
    </>
  );
}

function RosterCard({ entry, summary, onRefresh, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const data = summary?.data;
  const sev = data?.latestAssessment;
  const tone = sev ? LEVEL_TONE[sev.severityLevel] || "neutral" : "neutral";
  const isDanger = sev && (sev.severityLevel === "Critical" || sev.severityLevel === "Severe");

  return (
    <Card className={isDanger ? "border-critical/40 bg-critical-soft" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-ink">{entry.nickname || entry.patientName}</h3>
          {entry.nickname && <p className="text-xs text-faint">{entry.patientName}</p>}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onRefresh} aria-label="Refresh" title="Refresh" className="text-xs text-muted hover:text-ink">
            ↻
          </button>
          <button type="button" onClick={onRemove} aria-label="Remove from dashboard" title="Remove" className="text-xs text-muted hover:text-critical">
            ✕
          </button>
        </div>
      </div>

      {summary?.error ? (
        <p className="mt-2 text-sm text-critical">{summary.error}</p>
      ) : !summary ? (
        <Spinner className="mt-2" />
      ) : sev ? (
        <>
          <div className="mt-2">
            <Pill tone={tone}>{sev.severityLevel}</Pill>
            <span className="ml-2 text-xs text-muted">MRI {sev.mri}</span>
          </div>
          <p className="mt-1 text-xs text-faint">Last checked: {new Date(sev.createdAt * 1000).toLocaleDateString()}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">No assessment recorded yet.</p>
      )}

      {summary && !summary.error && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-3 text-xs font-semibold text-primary hover:underline">
          {expanded ? "▲ Hide full details" : "▼ View full details"}
        </button>
      )}
      {expanded && data && <PatientDetail data={data} />}
    </Card>
  );
}

// How often the dashboard re-fetches every roster patient's summary
// without the provider having to manually refresh - close enough to
// "real-time" for a triage/monitoring dashboard without needing any
// push/websocket infrastructure or backend change.
const AUTO_REFRESH_MS = 45000;

export default function ProviderPage() {
  const [roster, setRoster] = useState(() => loadRoster());
  const [summaries, setSummaries] = useState({});
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  async function fetchSummary(patientCode) {
    try {
      const result = await api.providerSummary(patientCode);
      setSummaries((s) => ({ ...s, [patientCode]: { data: result } }));
    } catch (err) {
      setSummaries((s) => ({ ...s, [patientCode]: { error: err.message || "Could not load this patient." } }));
    }
  }

  function refreshAll(currentRoster) {
    currentRoster.forEach((entry) => fetchSummary(entry.code));
    setLastRefreshed(new Date());
  }

  useEffect(() => {
    refreshAll(roster);
    const interval = setInterval(() => refreshAll(loadRoster()), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
    // Only set up once - refreshAll always re-reads the roster fresh from
    // storage/state at call time, so it never goes stale across adds/removes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    if (roster.some((r) => r.code === trimmed)) {
      setAddError("This patient is already on your dashboard.");
      return;
    }
    setAddBusy(true);
    setAddError("");
    try {
      const result = await api.providerSummary(trimmed);
      const nextRoster = addToRoster({ code: trimmed, nickname: nickname.trim(), patientName: result.patientName });
      setRoster(nextRoster);
      setSummaries((s) => ({ ...s, [trimmed]: { data: result } }));
      setCode("");
      setNickname("");
    } catch (err) {
      setAddError(err.message || "Could not find a patient with that code.");
    } finally {
      setAddBusy(false);
    }
  }

  function handleRemove(patientCode) {
    setRoster(removeFromRoster(patientCode));
    setSummaries((s) => {
      const next = { ...s };
      delete next[patientCode];
      return next;
    });
  }

  // Analytics scoped to THIS provider's own roster only - patients who
  // gave this provider their share code, not a system-wide view across
  // every patient in the app. A true cross-facility "authority" dashboard
  // would need its own account/authorization model (who counts as an
  // authority, what they're allowed to see) that doesn't exist yet, so
  // this deliberately stays inside the same consent boundary the roster
  // itself already has.
  const severityOf = (code) => summaries[code]?.data?.latestAssessment?.severityLevel;
  const urgentCodes = roster.filter((r) => ["Critical", "Severe"].includes(severityOf(r.code)));
  const moderateCount = roster.filter((r) => severityOf(r.code) === "Moderate").length;
  const stableCount = roster.filter((r) => ["Mild", "Minimal"].includes(severityOf(r.code))).length;
  const noDataCount = roster.length - urgentCodes.length - moderateCount - stableCount;

  const sortedRoster = [...roster].sort((a, b) => {
    const rank = (code) => (["Critical", "Severe"].includes(severityOf(code)) ? 0 : severityOf(code) === "Moderate" ? 1 : 2);
    return rank(a.code) - rank(b.code);
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h1 className="text-xl font-bold text-ink">Provider Dashboard</h1>
        <p className="mt-2 text-sm text-muted">
          Add a patient's share code once to keep them on this dashboard - saved only in this browser, not sent
          anywhere else. Read-only: no edit access, and each code only ever unlocks the one patient it belongs to.
        </p>
        <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <input
            aria-label="Share code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="Share code, e.g. 8UDPF7AG"
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-4 py-2.5 font-mono text-sm uppercase text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <input
            aria-label="Nickname (optional)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname (optional, e.g. Ward 3 - bed 4)"
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <Button type="submit" disabled={addBusy}>
            {addBusy ? "…" : "+ Add Patient"}
          </Button>
        </form>
        {addError && <p className="mt-3 text-sm text-critical">{addError}</p>}
      </Card>

      {roster.length > 0 && (
        <>
          {urgentCodes.length > 0 && (
            <Card className="border-critical/40 bg-critical-soft">
              <p className="text-sm font-bold text-critical">
                🚨 {urgentCodes.length} patient{urgentCodes.length > 1 ? "s" : ""} need{urgentCodes.length > 1 ? "" : "s"} urgent attention
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {urgentCodes.map((r) => (
                  <span key={r.code} className="rounded-full border border-critical/40 bg-white px-2.5 py-1 text-xs font-semibold text-critical">
                    {r.nickname || r.patientName}
                  </span>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow">Dashboard Summary</p>
              <div className="flex items-center gap-2">
                {lastRefreshed && (
                  <span className="text-xs text-faint">Updated {lastRefreshed.toLocaleTimeString()}</span>
                )}
                <button
                  type="button"
                  onClick={() => refreshAll(roster)}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  ↻ Refresh all
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-border p-3 text-center">
                <p className="text-2xl font-extrabold text-ink">{roster.length}</p>
                <p className="text-xs text-muted">Total patients</p>
              </div>
              <div className="rounded-md border border-critical/30 bg-critical-soft p-3 text-center">
                <p className="text-2xl font-extrabold text-critical">{urgentCodes.length}</p>
                <p className="text-xs text-critical">Urgent</p>
              </div>
              <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-center">
                <p className="text-2xl font-extrabold text-warning">{moderateCount}</p>
                <p className="text-xs text-warning">Moderate</p>
              </div>
              <div className="rounded-md border border-good/30 bg-good-soft p-3 text-center">
                <p className="text-2xl font-extrabold text-good">{stableCount}</p>
                <p className="text-xs text-good">Stable{noDataCount > 0 ? ` (+${noDataCount} no data)` : ""}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-faint">
              Auto-refreshes every {AUTO_REFRESH_MS / 1000}s while this page is open. Scoped to the patients on this
              dashboard only - not a facility-wide view.
            </p>
          </Card>
        </>
      )}

      {roster.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No patients added yet. Add a share code above to start your dashboard.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sortedRoster.map((entry) => (
            <RosterCard
              key={entry.code}
              entry={entry}
              summary={summaries[entry.code]}
              onRefresh={() => fetchSummary(entry.code)}
              onRemove={() => handleRemove(entry.code)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
