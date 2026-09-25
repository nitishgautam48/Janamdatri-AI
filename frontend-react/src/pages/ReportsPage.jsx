import { useState } from "react";
import { api } from "../lib/api";
import { addReportVitalsToHealthRecord } from "../lib/storage";
import { useLang } from "../context/LangContext";

// `id` is the exact English time-of-day string document_extractor.py
// groups the medication schedule by (result.scheduleByTime is keyed by
// these strings server-side, which has no i18n layer) - decoupled from
// `labelKey`, the translated display, same pattern as the Assessment's
// symptom chips.
const TIME_ORDER = [
  { id: "Morning", labelKey: "reports.timeMorning" },
  { id: "Afternoon", labelKey: "reports.timeAfternoon" },
  { id: "Evening", labelKey: "reports.timeEvening" },
  { id: "Night", labelKey: "reports.timeNight" },
  { id: "As needed", labelKey: "reports.timeAsNeeded" },
];

function Section({ title, children }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 10, boxShadow: "var(--shadow-sm)" }}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>{title}</h3>
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useLang();
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleAnalyze() {
    setError("");
    if (!file && !text.trim()) {
      setError(t("reports.uploadFirstError"));
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
  if (extractedVitals.hemoglobin != null) confirmLabels.push(`${t("reports.hemoglobinLabel")}: ${extractedVitals.hemoglobin} g/dL`);
  if (extractedVitals.systolicBP != null) confirmLabels.push(`${t("reports.bloodPressureLabel")}: ${extractedVitals.systolicBP}/${extractedVitals.diastolicBP} mmHg`);
  if (extractedVitals.bloodSugar != null) confirmLabels.push(`${t("reports.bloodSugarLabel")}: ${extractedVitals.bloodSugar} mmol/L`);

  const scheduleTimes = result ? TIME_ORDER.filter((time) => result.scheduleByTime?.[time.id]) : [];
  const flaggedCount = result?.findings?.filter((f) => f.flag).length || 0;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 12, boxShadow: "var(--shadow-sm)" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text)" }}>{t("reports.title")}</h1>
          <p style={{ marginTop: 4, fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{t("reports.subtitle")}</p>
        </div>

        <label
          htmlFor="reports-file"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, border: "1px dashed var(--color-neutral-700)", borderRadius: 10, cursor: "pointer", fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}
        >
          <i className="ph ph-upload-simple" style={{ fontSize: "1.125rem", color: "var(--color-accent-400)" }} />
          <span style={{ flex: 1 }}>{file ? file.name : t("reports.uploadFile")}</span>
          <input id="reports-file" type="file" accept=".pdf,.txt" onChange={(e) => setFile(e.target.files[0] || null)} style={{ display: "none" }} />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>
          <span style={{ height: 1, flex: 1, background: "var(--color-neutral-800)" }} />
          {t("reports.or")}
          <span style={{ height: 1, flex: 1, background: "var(--color-neutral-800)" }} />
        </div>

        <div className="field">
          <label htmlFor="reports-text">{t("reports.pasteText")}</label>
          <textarea
            id="reports-text"
            rows={6}
            placeholder={t("reports.pastePlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="input"
            style={{ width: "100%" }}
          />
        </div>

        {error && <p style={{ fontSize: "0.875rem", color: "var(--color-critical)" }}>{error}</p>}
        <button type="button" onClick={handleAnalyze} disabled={busy} className="btn btn-primary" style={{ justifySelf: "start" }}>
          {busy ? "…" : t("reports.analyzeReport")}
        </button>
      </div>

      {result && (
        <>
          <Section title={t("reports.summary")}>
            <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{result.summary}</p>
          </Section>

          <Section title={t("reports.medicationSchedule")}>
            {scheduleTimes.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{t("reports.noScheduleDetermined")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
                {scheduleTimes.map((time) => (
                  <div key={time.id} style={{ borderRadius: 10, border: "1px solid var(--color-neutral-800)", padding: 12 }}>
                    <h4 style={{ marginBottom: 6, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{t(time.labelKey)}</h4>
                    <ul className="list-inside list-disc space-y-0.5" style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
                      {result.scheduleByTime[time.id].map((m) => <li key={m}>{m}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={t("reports.keyFindings")}>
            {!result.findings || result.findings.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{t("reports.noLabValues")}</p>
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
                        {f.flag ? t("reports.needsAttention") : t("reports.normal")}
                      </span>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-600)" }}>
                  {flaggedCount
                    ? t(flaggedCount > 1 ? "reports.itemsToDiscussMany" : "reports.itemToDiscussOne").replace("{n}", flaggedCount)
                    : t("reports.nothingFlagged")}
                </p>
                <div style={{ display: "grid", gap: 8 }}>
                  {result.findings.map((f) => (
                    <div key={f.label} style={{ borderRadius: 10, border: "1px solid var(--color-neutral-800)", padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>
                        {f.label}: {f.value}
                        {f.flag && <span className="tag" style={{ background: "var(--color-warning-soft)", color: "var(--color-warning)" }}>{t("reports.review")}</span>}
                      </div>
                      {f.flag && <p style={{ marginTop: 4, fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{f.flag}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>

          {confirmLabels.length > 0 && (
            <Section title={t("reports.addToHealthRecord")}>
              <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("reports.addToHealthRecordDesc")}</p>
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
                <i className="ph ph-check" /> {confirmed ? t("reports.added") : t("reports.addToRecord")}
              </button>
              {confirmed && <p style={{ fontSize: "0.75rem", color: "var(--color-good)" }}>{t("reports.addedConfirm")}</p>}
            </Section>
          )}

          <Section title={t("reports.extractedTextPreview")}>
            <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", borderRadius: 10, background: "var(--color-bg)", padding: 12, fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{result.extractedTextPreview}</pre>
          </Section>
        </>
      )}
    </div>
  );
}
