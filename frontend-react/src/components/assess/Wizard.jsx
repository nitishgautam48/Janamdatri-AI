import { useState } from "react";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Pill from "../ui/Pill";

const STEPS = ["Vitals", "Symptoms", "History", "Review"];

const SYMPTOM_CHIPS = [
  "severe headache", "blurred vision", "heavy bleeding", "baby stopped moving",
  "convulsions", "high fever", "severe abdominal pain", "face is swollen",
  "labor for more than a day", "foul smelling discharge", "chest pain",
];

const HISTORY_FLAGS = {
  past: [
    { key: "prior_csection", label: "Prior C-section" },
    { key: "prior_preeclampsia", label: "Prior pre-eclampsia" },
    { key: "prior_pph", label: "Prior postpartum hemorrhage" },
    { key: "prior_stillbirth_or_loss", label: "Prior stillbirth/loss" },
    { key: "chronic_hypertension", label: "Chronic hypertension" },
    { key: "pre_existing_diabetes", label: "Pre-existing diabetes" },
  ],
  current: [
    { key: "regular_anc_visits", label: "Regular ANC visits", protective: true },
    { key: "iron_folic_supplementation", label: "Taking iron/folic supplements", protective: true },
    { key: "institutional_delivery_plan", label: "Planning institutional delivery", protective: true },
    { key: "birth_preparedness_plan", label: "Has a birth preparedness plan", protective: true },
    { key: "family_support", label: "Supportive family", protective: true },
    { key: "no_antenatal_care", label: "No ANC visits so far", risk: true },
  ],
};

function Field({ label, hint, ...props }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-muted">
        {label} {hint && <span className="text-xs text-faint">{hint}</span>}
      </label>
      <input
        {...props}
        className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
      />
    </div>
  );
}

export default function Wizard({ form, setForm, hasSavedEpds, onSubmit, submitting, error }) {
  const [step, setStep] = useState(0);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleChip(phrase) {
    set("symptomText", form.symptomText ? `${form.symptomText}, ${phrase}` : phrase);
  }

  function toggleFlag(key) {
    setForm((f) => ({ ...f, historyFlags: { ...f.historyFlags, [key]: !f.historyFlags[key] } }));
  }

  return (
    <Card>
      <div className="mb-6 flex items-center gap-1 sm:gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                i === step ? "bg-primary text-paper-ink" : i < step ? "bg-good text-paper-ink" : "bg-surface-hover text-muted"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            {/* Labels hide below sm - 4 steps with text + connecting lines
                don't fit a phone width, and the circles/color alone are
                already enough to show progress. */}
            <span className={`hidden truncate text-xs font-medium sm:inline ${i === step ? "text-ink" : "text-faint"}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px min-w-2 flex-1 bg-border" />}
          </div>
        ))}
      </div>

      {error && <p className="mb-4 rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">{error}</p>}

      {step === 0 && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">1 · Vitals</h2>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={form.vitalsEnabled} onChange={(e) => set("vitalsEnabled", e.target.checked)} />
                Include vitals
              </label>
            </div>
            {form.vitalsEnabled && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Age (years)" type="number" placeholder="e.g. 28" value={form.age} onChange={(e) => set("age", e.target.value)} />
                <Field label="Systolic BP" hint="normal <120" type="number" placeholder="e.g. 118" value={form.sbp} onChange={(e) => set("sbp", e.target.value)} />
                <Field label="Diastolic BP" hint="normal <80" type="number" placeholder="e.g. 76" value={form.dbp} onChange={(e) => set("dbp", e.target.value)} />
                <Field label="Blood Sugar (mmol/L)" hint="normal ~6-7" type="number" step="0.1" placeholder="e.g. 6.5" value={form.bs} onChange={(e) => set("bs", e.target.value)} />
                <Field label="Body Temp (°F)" hint="normal ~98" type="number" step="0.1" placeholder="e.g. 98.2" value={form.temp} onChange={(e) => set("temp", e.target.value)} />
                <Field label="Heart Rate (bpm)" type="number" placeholder="e.g. 78" value={form.hr} onChange={(e) => set("hr", e.target.value)} />
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-1 text-sm font-bold text-ink">1b · Anemia Check <Pill className="ml-1">optional</Pill></h2>
            <p className="mb-2 text-xs text-muted">If you have a recent hemoglobin (Hb) test result, enter it here for India-specific anemia grading.</p>
            <div className="max-w-[220px]">
              <Field label="Hemoglobin (g/dL)" type="number" step="0.1" placeholder="e.g. 10.5" value={form.hemoglobin} onChange={(e) => set("hemoglobin", e.target.value)} />
            </div>
          </div>

          <div>
            <h2 className="mb-1 text-sm font-bold text-ink">1c · Pregnancy Stage <Pill className="ml-1">optional</Pill></h2>
            <p className="mb-2 text-xs text-muted">Lets the assessment factor in trimester-specific risks and week-appropriate warning signs.</p>
            <div className="max-w-[220px]">
              <Field label="Current gestational week" type="number" placeholder="e.g. 24" value={form.week} onChange={(e) => set("week", e.target.value)} />
            </div>
          </div>

          <div>
            <h2 className="mb-1 text-sm font-bold text-ink">1d · Additional Checks <Pill className="ml-1">optional</Pill></h2>
            <p className="mb-2 text-xs text-muted">Each is a well-established antenatal screening check, not a diagnosis.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Current weight (kg)" type="number" step="0.1" placeholder="e.g. 62" value={form.weight} onChange={(e) => set("weight", e.target.value)} />
              <Field label="Fetal movements (last hour)" type="number" placeholder="e.g. 6" value={form.fetalMovementCount} onChange={(e) => set("fetalMovementCount", e.target.value)} />
              <Field label="Fundal height (cm)" type="number" step="0.1" placeholder="e.g. 27" value={form.fundalHeight} onChange={(e) => set("fundalHeight", e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="mb-1 text-sm font-bold text-ink">2 · Symptoms</h2>
          <p className="mb-3 text-xs text-muted">Tap any that apply — they'll be added to the description below, or type your own.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {SYMPTOM_CHIPS.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => toggleChip(phrase)}
                className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-muted hover:border-primary hover:text-ink"
              >
                {phrase}
              </button>
            ))}
          </div>
          <textarea
            rows={4}
            placeholder="Describe how you're feeling in your own words…"
            value={form.symptomText}
            onChange={(e) => set("symptomText", e.target.value)}
            className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="mb-1 text-sm font-bold text-ink">3 · History</h2>
          <p className="mb-3 text-xs text-muted">Optional — helps weigh background risk factors.</p>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">Past pregnancy history</h3>
              <div className="space-y-2">
                {HISTORY_FLAGS.past.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={!!form.historyFlags[f.key]} onChange={() => toggleFlag(f.key)} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">Current pregnancy care</h3>
              <div className="space-y-2">
                {HISTORY_FLAGS.current.map((f) => (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2 text-sm ${f.protective ? "text-good" : f.risk ? "text-critical" : "text-ink"}`}
                  >
                    <input type="checkbox" checked={!!form.historyFlags[f.key]} onChange={() => toggleFlag(f.key)} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          {hasSavedEpds && (
            <label className="mb-4 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.includeEpds} onChange={(e) => set("includeEpds", e.target.checked)} />
              Include my saved Mental Health Check (EPDS) score in this assessment
            </label>
          )}
          <h2 className="mb-1 text-sm font-bold text-ink">4 · Review</h2>
          <p className="mb-3 text-xs text-muted">Check what you're about to submit, then run the assessment.</p>
          <ReviewSummary form={form} />
        </div>
      )}

      <div className="mt-6 flex justify-between">
        {step > 0 ? (
          <Button variant="ghost" type="button" onClick={() => setStep((s) => s - 1)}>
            ← Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)}>
            Next: {STEPS[step + 1]} →
          </Button>
        ) : (
          <Button type="button" onClick={onSubmit} disabled={submitting}>
            {submitting ? "Running…" : "Run Assessment"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function ReviewSummary({ form }) {
  const rows = [];
  if (form.vitalsEnabled && (form.age || form.sbp || form.dbp || form.bs || form.temp || form.hr)) {
    rows.push(["Vitals", `Age ${form.age || "—"}, BP ${form.sbp || "—"}/${form.dbp || "—"}, BS ${form.bs || "—"}, Temp ${form.temp || "—"}, HR ${form.hr || "—"}`]);
  }
  if (form.hemoglobin) rows.push(["Hemoglobin", `${form.hemoglobin} g/dL`]);
  if (form.week) rows.push(["Gestational week", form.week]);
  if (form.weight) rows.push(["Weight", `${form.weight} kg`]);
  if (form.fetalMovementCount) rows.push(["Fetal movements", `${form.fetalMovementCount} in last hour`]);
  if (form.fundalHeight) rows.push(["Fundal height", `${form.fundalHeight} cm`]);
  if (form.symptomText) rows.push(["Symptoms", form.symptomText]);
  const flags = Object.entries(form.historyFlags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " "));
  if (flags.length) rows.push(["History", flags.join(", ")]);

  if (!rows.length) return <p className="text-sm text-muted">Nothing entered yet — go back and add at least one input.</p>;

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-3.5 py-2.5 text-sm">
          <span className="shrink-0 font-medium text-muted">{label}</span>
          <span className="text-right text-ink">{value}</span>
        </div>
      ))}
    </div>
  );
}
