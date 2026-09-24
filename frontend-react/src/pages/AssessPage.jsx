import { useState } from "react";
import Wizard from "../components/assess/Wizard";
import Results from "../components/assess/Results";
import { api } from "../lib/api";
import { appendHistoryEntry, lastKnownWeight, loadSavedEpds } from "../lib/storage";

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

  const savedEpds = loadSavedEpds();

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

    setSubmitting(true);
    try {
      const data = await api.assess({
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
      });
      appendHistoryEntry(data);
      setResult(data);
    } catch (err) {
      setError(err.message || "Could not run the assessment.");
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
    <div className="mx-auto max-w-3xl">
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
