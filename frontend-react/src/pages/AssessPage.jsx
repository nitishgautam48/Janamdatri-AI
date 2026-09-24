import { useEffect, useState } from "react";
import Wizard from "../components/assess/Wizard";
import Results from "../components/assess/Results";
import { api } from "../lib/api";
import {
  appendHistoryEntry, lastKnownWeight, loadSavedEpds,
  savePendingAssessment, loadPendingAssessment, clearPendingAssessment,
} from "../lib/storage";

const EMPTY_FORM = {
  vitalsEnabled: true,
  age: "", sbp: "", dbp: "", bs: "", temp: "", hr: "",
  hemoglobin: "", week: "",
  weight: "", heightCm: "", fetalMovementCount: "", fundalHeight: "", urineProtein: "",
  previousPregnancies: "",
  symptomText: "",
  historyFlags: {},
  includeEpds: true,
};

function collectVitals(form) {
  if (!form.vitalsEnabled) return null;
  const values = [form.age, form.sbp, form.dbp, form.bs, form.temp, form.hr];
  if (values.some((v) => String(v).trim() === "")) return null;
  return {
    Age: Number(form.age), SystolicBP: Number(form.sbp), DiastolicBP: Number(form.dbp),
    BS: Number(form.bs), BodyTemp: Number(form.temp), HeartRate: Number(form.hr),
  };
}

export default function AssessPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // A submit that failed only because the device was offline (rural/poor-
  // connectivity use is the whole point of ASHA-linked care, not an edge
  // case) - the filled-in form is saved to this device rather than lost,
  // and retried automatically the moment connectivity returns.
  const [pending, setPending] = useState(() => loadPendingAssessment());
  const [retrying, setRetrying] = useState(false);

  const savedEpds = loadSavedEpds();

  async function submitPayload(payload) {
    const data = await api.assess(payload);
    appendHistoryEntry(data);
    clearPendingAssessment();
    setPending(null);
    setResult(data);
    return data;
  }

  async function retryPending() {
    if (!pending || retrying) return;
    setRetrying(true);
    try {
      await submitPayload(pending.payload);
    } catch (err) {
      // Still offline (or the server itself is down) - leave it queued,
      // the 'online' listener below and the manual retry button both try
      // again later. Nothing to show the person here; the offline banner
      // (OfflineBanner, app-wide) already tells them why.
    } finally {
      setRetrying(false);
    }
  }

  // Auto-retry the moment the browser reports connectivity back, so
  // someone doesn't have to remember to come back and press a button. Also
  // tried once immediately if already online on mount - the 'online' event
  // only fires on an offline->online TRANSITION, so a pending assessment
  // saved last session and reopened later (already connected, no
  // transition this session to trigger on) would otherwise sit there
  // until someone noticed the manual "Retry now" button.
  useEffect(() => {
    if (!pending) return;
    if (typeof navigator === "undefined" || navigator.onLine) retryPending();
    window.addEventListener("online", retryPending);
    return () => window.removeEventListener("online", retryPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  async function handleSubmit() {
    setError("");

    if (form.vitalsEnabled) {
      const values = [form.age, form.sbp, form.dbp, form.bs, form.temp, form.hr];
      if (values.some((v) => String(v).trim() !== "") && values.some((v) => String(v).trim() === "")) {
        setError("Please fill in all vitals fields, or uncheck 'Include vitals'.");
        return;
      }
    }

    const vitals = collectVitals(form);
    const text = form.symptomText.trim();
    const hemoglobin = form.hemoglobin ? Number(form.hemoglobin) : null;
    const pregnancyWeek = form.week ? Number(form.week) : null;
    const weight = form.weight ? Number(form.weight) : null;
    const previousWeight = weight != null ? lastKnownWeight() : null;
    const heightCm = form.heightCm ? Number(form.heightCm) : null;
    const fetalMovementCount = form.fetalMovementCount ? Number(form.fetalMovementCount) : null;
    const fundalHeight = form.fundalHeight ? Number(form.fundalHeight) : null;
    const urineProtein = form.urineProtein || null;
    const previousPregnancies = form.previousPregnancies ? Number(form.previousPregnancies) : null;
    const epdsResponses = savedEpds && form.includeEpds ? savedEpds.responses : null;

    if (!text && !vitals && hemoglobin === null && !epdsResponses && weight === null && fetalMovementCount === null
        && fundalHeight === null && !urineProtein) {
      setError("Provide vitals, symptoms, hemoglobin, weight, fetal movement, fundal height, urine protein, or an EPDS score before running an assessment.");
      return;
    }

    const payload = {
      text: text || undefined,
      vitals: vitals || undefined,
      history: form.historyFlags,
      hemoglobin,
      pregnancyWeek,
      weight,
      previousWeight,
      heightCm,
      fetalMovementCount,
      fundalHeight,
      urineProtein,
      previousPregnancies,
      epdsResponses: epdsResponses || undefined,
    };

    setSubmitting(true);
    try {
      await submitPayload(payload);
    } catch (err) {
      if (err.isNetworkError) {
        savePendingAssessment(payload);
        setPending(loadPendingAssessment());
        setForm(EMPTY_FORM);
      } else {
        setError(err.message || "Could not run the assessment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-3xl">
        <Results data={result} onReset={() => { setResult(null); setForm(EMPTY_FORM); }} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl" style={{ display: "grid", gap: 14 }}>
      {pending && (
        <div
          style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, borderRadius: 12,
            border: "1px solid var(--color-warning)", background: "var(--color-warning-soft)",
            padding: "10px 14px", fontSize: "0.8125rem", color: "var(--color-text)",
          }}
        >
          <i className="ph ph-cloud-arrow-up" style={{ color: "var(--color-warning)" }} />
          <span style={{ flex: 1, minWidth: 200 }}>
            An assessment from {new Date(pending.savedAt).toLocaleString()} couldn't reach the server while you were
            offline - it's saved on this device and will submit automatically once you're back online.
          </span>
          <button type="button" onClick={retryPending} disabled={retrying} className="btn btn-secondary" style={{ fontSize: "0.75rem" }}>
            {retrying ? "Retrying…" : "Retry now"}
          </button>
        </div>
      )}
      <Wizard
        form={form}
        setForm={setForm}
        hasSavedEpds={!!savedEpds}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={error}
      />
    </div>
  );
}
