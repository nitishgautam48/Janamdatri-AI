import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { api } from "../lib/api";

export default function ProviderPage() {
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
      const result = await api.providerSummary(code.trim());
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <h1 className="text-xl font-bold text-ink">Provider Access</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the code your patient shared with you to view their latest result. No login needed — the code itself is the access credential.
        </p>
        <form onSubmit={lookup} className="mt-4 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="e.g. 8UDPF7AG"
            className="flex-1 rounded-md border border-border-strong bg-bg px-4 py-2.5 font-mono text-sm uppercase text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "View Summary"}
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      </Card>

      {data && (
        <>
          <Card>
            <h2 className="text-lg font-bold text-ink">{data.patientName}</h2>
            <p className="mt-1 text-xs text-muted">Read-only summary. No edit access, and no other patients are reachable from this code.</p>
          </Card>

          {data.latestAssessment ? (
            <Card>
              <p className="eyebrow mb-2">Latest Assessment</p>
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
            </Card>
          ) : null}

          {data.latestNutrition ? (
            <Card>
              <p className="eyebrow mb-2">Latest Nutrition Check</p>
              <p className="text-xs text-muted">Recorded: {new Date(data.latestNutrition.createdAt * 1000).toLocaleString()}</p>
              {data.latestNutrition.gaps?.length ? (
                <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink">
                  {data.latestNutrition.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-ink">No nutrition gaps flagged.</p>
              )}
            </Card>
          ) : null}

          {!data.latestAssessment && !data.latestNutrition && (
            <Card>
              <p className="text-sm text-muted">This patient has no assessment or nutrition data yet.</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
