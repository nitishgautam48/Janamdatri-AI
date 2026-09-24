import { useState } from "react";
import { api } from "../lib/api";
import { addReportVitalsToHealthRecord } from "../lib/storage";

const TIME_ORDER = ["Morning", "Afternoon", "Evening", "Night", "As needed"];

function Section({ title, children }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 10, boxShadow: "var(--shadow-sm)" }}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>{title}</h3>
      {children}
    </div>
  );
}

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
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 12, boxShadow: "var(--shadow-sm)" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text)" }}>My Reports</h1>
          <p style={{ marginTop: 4, fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>
            Upload a prescription or lab report (PDF/TXT), or paste its text, and get a clear medication schedule
            (what to take, when) and a summary of any values worth discussing with your provider.
          </p>
        </div>

        <label
          htmlFor="reports-file"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px dashed var(--color-neutral-700)", borderRadius: 10, cursor: "pointer", fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}
        >
          <i className="ph ph-upload-simple" style={{ fontSize: "1.125rem", color: "var(--color-accent-400)" }} />
          <span style={{ flex: 1 }}>{file ? file.name : "Upload file (.pdf or .txt)"}</span>
          <input id="reports-file" type="file" accept=".pdf,.txt" onChange={(e) => setFile(e.target.files[0] || null)} style={{ display: "none" }} />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>
          <span style={{ height: 1, flex: 1, background: "var(--color-neutral-800)" }} />
          or
          <span style={{ height: 1, flex: 1, background: "var(--color-neutral-800)" }} />
        </div>

        <div className="field">
          <label htmlFor="reports-text">Paste the report's text</label>
          <textarea
            id="reports-text"
            rows={6}
            placeholder="e.g. Tab. Folic Acid 5mg OD morning, Hemoglobin: 9.2 g/dl…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input"
            style={{ width: "100%" }}
          />
        </div>

        {error && <p style={{ fontSize: "0.875rem", color: "var(--color-critical)" }}>{error}</p>}
        <button type="button" onClick={handleAnalyze} disabled={busy} className="btn btn-primary" style={{ justifySelf: "start" }}>
          {busy ? "…" : "Analyze Report"}
        </button>
      </div>

      {result && (
        <>
          <Section title="Summary">
            <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{result.summary}</p>
          </Section>

          <Section title="Medication Schedule">
            {scheduleTimes.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>No medication schedule could be determined from this report.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                {scheduleTimes.map((time) => (
                  <div key={time} style={{ borderRadius: 10, border: "1px solid var(--color-neutral-800)", padding: 12 }}>
                    <h4 style={{ marginBottom: 6, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{time}</h4>
                    <ul className="list-inside list-disc space-y-0.5" style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
                      {result.scheduleByTime[time].map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Key Findings">
            {!result.findings || result.findings.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>No lab values were recognized in this report.</p>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  {result.findings.map((f) => (
                    <div key={f.label} style={{ borderRadius: 10, border: "1px solid var(--color-neutral-800)", padding: 12 }}>
                      <p className="eyebrow">{f.label}</p>
                      <p style={{ marginTop: 4, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{f.value}</p>
                      <span
                        className="tag"
                        style={{ marginTop: 4, background: f.flag ? "var(--color-warning-soft)" : "var(--color-good-soft)", color: f.flag ? "var(--color-warning)" : "var(--color-good)" }}
                      >
                        {f.flag ? "Needs Attention" : "Normal"}
                      </span>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-600)" }}>
                  {flaggedCount
                    ? `${flaggedCount} item${flaggedCount > 1 ? "s" : ""} to discuss with your provider - see details below.`
                    : "Nothing here shows an obvious flag, but always confirm with your provider."}
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {result.findings.map((f) => (
                    <div key={f.label} style={{ borderRadius: 10, border: "1px solid var(--color-neutral-800)", padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>
                        {f.label}: {f.value}
                        {f.flag && <span className="tag" style={{ background: "var(--color-warning-soft)", color: "var(--color-warning)" }}>Review</span>}
                      </div>
                      {f.flag && <p style={{ marginTop: 4, fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{f.flag}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>

          {confirmLabels.length > 0 && (
            <Section title="Add These Values to My Health Record?">
              <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>These will show up in your Health Trends alongside your assessments. Nothing is added until you confirm.</p>
              <ul className="list-inside list-disc space-y-1" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
                {confirmLabels.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <button
                type="button"
                disabled={confirmed}
                onClick={() => { addReportVitalsToHealthRecord(extractedVitals); setConfirmed(true); }}
                className="btn btn-primary"
                style={{ justifySelf: "start" }}
              >
                <i className="ph ph-check" /> {confirmed ? "Added" : "Add to My Health Record"}
              </button>
              {confirmed && <p style={{ fontSize: "0.75rem", color: "var(--color-good)" }}>Added to your Health Trends.</p>}
            </Section>
          )}

          <Section title="Extracted Text (preview)">
            <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", borderRadius: 10, background: "var(--color-bg)", padding: 12, fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{result.extractedTextPreview}</pre>
          </Section>
        </>
      )}
    </div>
  );
}
