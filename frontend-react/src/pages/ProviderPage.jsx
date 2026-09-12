import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Pill from "../components/ui/Pill";
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
        <p className="mt-2 text-sm text-muted">Loading…</p>
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

export default function ProviderPage() {
  const [roster, setRoster] = useState(() => loadRoster());
  const [summaries, setSummaries] = useState({});
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  async function fetchSummary(patientCode) {
    try {
      const result = await api.providerSummary(patientCode);
      setSummaries((s) => ({ ...s, [patientCode]: { data: result } }));
    } catch (err) {
      setSummaries((s) => ({ ...s, [patientCode]: { error: err.message || "Could not load this patient." } }));
    }
  }

  useEffect(() => {
    roster.forEach((entry) => fetchSummary(entry.code));
    // Only on mount - each roster change that adds/removes a patient
    // manages its own summaries entry directly instead of re-running this.
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h1 className="text-xl font-bold text-ink">Provider Dashboard</h1>
        <p className="mt-2 text-sm text-muted">
          Add a patient's share code once to keep them on this dashboard - saved only in this browser, not sent
          anywhere else. Read-only: no edit access, and each code only ever unlocks the one patient it belongs to.
        </p>
        <form onSubmit={handleAdd} className="mt-4 flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="Share code, e.g. 8UDPF7AG"
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-4 py-2.5 font-mono text-sm uppercase text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname (optional, e.g. Ward 3 - bed 4)"
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
          <Button type="submit" disabled={addBusy}>
            {addBusy ? "…" : "+ Add Patient"}
          </Button>
        </form>
        {addError && <p className="mt-3 text-sm text-critical">{addError}</p>}
      </Card>

      {roster.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No patients added yet. Add a share code above to start your dashboard.</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {roster.map((entry) => (
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
