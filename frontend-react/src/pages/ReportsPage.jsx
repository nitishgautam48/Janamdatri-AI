import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { api } from "../lib/api";
import { addReportVitalsToHealthRecord } from "../lib/storage";

const TIME_ORDER = ["Morning", "Afternoon", "Evening", "Night", "As needed"];

export default function ReportsPage() {
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleAnalyze() {
    setError("");
    if (!file && !text.trim()) {
      setError("Upload a file or paste the report's text first.");
      return;
    }
    const formData = new FormData();
    if (file) formData.append("file", file);
    if (text.trim()) formData.append("text", text.trim());

    setBusy(true);
    setConfirmed(false);
    try {
      const data = await api.analyzeDocument(formData);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const extractedVitals = result?.extractedVitals || {};
  const confirmLabels = [];
  if (extractedVitals.hemoglobin != null) confirmLabels.push(`Hemoglobin: ${extractedVitals.hemoglobin} g/dL`);
  if (extractedVitals.systolicBP != null) confirmLabels.push(`Blood Pressure: ${extractedVitals.systolicBP}/${extractedVitals.diastolicBP} mmHg`);
  if (extractedVitals.bloodSugar != null) confirmLabels.push(`Blood Sugar: ${extractedVitals.bloodSugar} mmol/L`);

  const scheduleTimes = result ? TIME_ORDER.filter((t) => result.scheduleByTime?.[t]) : [];
  const flaggedCount = result?.findings?.filter((f) => f.flag).length || 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <h1 className="text-xl font-bold text-ink">My Reports</h1>
        <p className="mt-1 text-sm text-muted">
          Upload a prescription or lab report (PDF/TXT), or paste its text, and get a clear medication schedule
          (what to take, when) and a summary of any values worth discussing with your provider.
        </p>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-muted">Upload file (.pdf or .txt)</label>
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(e) => setFile(e.target.files[0] || null)}
            className="block text-sm text-ink"
          />
        </div>
        <div className="my-4 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-muted">Paste the report's text</label>
          <textarea
            rows={6}
            placeholder="e.g. Tab. Folic Acid 5mg OD morning, Hemoglobin: 9.2 g/dl…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
        </div>

        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
        <Button className="mt-4" onClick={handleAnalyze} disabled={busy}>
          {busy ? "…" : "Analyze Report"}
        </Button>
      </Card>

      {result && (
        <>
          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Summary</h3>
            <p className="text-sm text-ink">{result.summary}</p>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-bold text-ink">Medication Schedule</h3>
            {scheduleTimes.length === 0 ? (
              <p className="text-sm text-muted">No medication schedule could be determined from this report.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {scheduleTimes.map((time) => (
                  <div key={time} className="rounded-md border border-border p-3.5">
                    <h4 className="mb-1.5 text-sm font-semibold text-ink">{time}</h4>
                    <ul className="list-inside list-disc space-y-0.5 text-sm text-muted">
                      {result.scheduleByTime[time].map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-bold text-ink">Key Findings</h3>
            {!result.findings || result.findings.length === 0 ? (
              <p className="text-sm text-muted">No lab values were recognized in this report.</p>
            ) : (
              <>
                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  {result.findings.map((f) => (
                    <div key={f.label} className="rounded-md border border-border p-3">
                      <p className="eyebrow">{f.label}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">{f.value}</p>
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${f.flag ? "bg-warning-soft text-warning" : "bg-good-soft text-good"}`}>
                        {f.flag ? "Needs Attention" : "Normal"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mb-3 text-xs text-faint">
                  {flaggedCount
                    ? `${flaggedCount} item${flaggedCount > 1 ? "s" : ""} to discuss with your provider - see details below.`
                    : "Nothing here shows an obvious flag, but always confirm with your provider."}
                </p>
                <div className="space-y-2">
                  {result.findings.map((f) => (
                    <div key={f.label} className="rounded-md border border-border p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {f.label}: {f.value}
                        {f.flag && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Review</span>}
                      </div>
                      {f.flag && <p className="mt-1 text-sm text-muted">{f.flag}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          {confirmLabels.length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-bold text-ink">Add These Values to My Health Record?</h3>
              <p className="mb-3 text-xs text-muted">These will show up in your Health Trends alongside your assessments. Nothing is added until you confirm.</p>
              <ul className="mb-3 list-inside list-disc space-y-1 text-sm text-ink">
                {confirmLabels.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <Button
                disabled={confirmed}
                onClick={() => {
                  addReportVitalsToHealthRecord(extractedVitals);
                  setConfirmed(true);
                }}
              >
                {confirmed ? "✓ Added" : "✓ Add to My Health Record"}
              </Button>
              {confirmed && <p className="mt-2 text-xs text-good">Added to your Health Trends.</p>}
            </Card>
          )}

          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Extracted Text (preview)</h3>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-bg p-3 text-xs text-muted">{result.extractedTextPreview}</pre>
          </Card>
        </>
      )}
    </div>
  );
}
