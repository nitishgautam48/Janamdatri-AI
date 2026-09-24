import { useState } from "react";
import Card from "../ui/Card";
import { slugify } from "../../lib/a11y";

const STEPS = ["Vitals", "Anemia & Stage", "Additional Checks", "Symptoms", "History", "Review"];

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
    { key: "multiple_gestation", label: "Expecting twins/multiples", risk: true },
  ],
};

const URINE_PROTEIN_OPTIONS = [
  { value: "", label: "Not tested" },
  { value: "nil", label: "Nil" },
  { value: "trace", label: "Trace" },
  { value: "1+", label: "1+" },
  { value: "2+", label: "2+" },
  { value: "3+", label: "3+" },
];

function Field({ label, hint, why, ...props }) {
  const [showWhy, setShowWhy] = useState(false);
  const id = `field-${slugify(label)}`;
  return (
    <div className="field">
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={id}>
          {label} {hint && <span style={{ color: "var(--color-neutral-500)" }}>{hint}</span>}
        </label>
        {why && (
          <button
            type="button"
            onClick={() => setShowWhy((s) => !s)}
            aria-expanded={showWhy}
            aria-label="Why this matters"
            style={{
              display: "flex",
              height: 16,
              width: 16,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              border: "1px solid var(--color-neutral-700)",
              fontSize: "0.625rem",
              fontWeight: 700,
              lineHeight: 1,
              color: "var(--color-neutral-500)",
              background: "none",
              cursor: "pointer",
            }}
          >
            i
          </button>
        )}
      </div>
      {why && showWhy && <p className="mb-1.5 -mt-0.5" style={{ fontSize: "0.75rem", lineHeight: 1.4, color: "var(--color-accent-400)" }}>{why}</p>}
      <input id={id} {...props} className="input" />
    </div>
  );
}

function SelectField({ label, why, options, ...props }) {
  const [showWhy, setShowWhy] = useState(false);
  const id = `field-${slugify(label)}`;
  return (
    <div className="field">
      <div className="mb-1 flex items-center gap-1">
        <label htmlFor={id}>{label}</label>
        {why && (
          <button
            type="button"
            onClick={() => setShowWhy((s) => !s)}
            aria-expanded={showWhy}
            aria-label="Why this matters"
            style={{
              display: "flex", height: 16, width: 16, flexShrink: 0, alignItems: "center", justifyContent: "center",
              borderRadius: "50%", border: "1px solid var(--color-neutral-700)", fontSize: "0.625rem", fontWeight: 700,
              lineHeight: 1, color: "var(--color-neutral-500)", background: "none", cursor: "pointer",
            }}
          >
            i
          </button>
        )}
      </div>
      {why && showWhy && <p className="mb-1.5 -mt-0.5" style={{ fontSize: "0.75rem", lineHeight: 1.4, color: "var(--color-accent-400)" }}>{why}</p>}
      <select id={id} {...props} className="input">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function Wizard({ form, setForm, hasSavedEpds, onSubmit, submitting, error }) {
  const [step, setStep] = useState(0);
  // Purely for the chips' own visual "selected" state - the actual data
  // stays the single symptomText string the textarea also edits, so
  // typing by hand and tapping chips both work on the same field. Without
  // this, tapping a chip a second time silently duplicated its phrase in
  // the text (toggleChip always appended, never checked what was already
  // there) with no visual sign it had been added at all.
  const [selectedChips, setSelectedChips] = useState(() => new Set());

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleChip(phrase) {
    const isSelected = selectedChips.has(phrase);
    setSelectedChips((prev) => {
      const next = new Set(prev);
      isSelected ? next.delete(phrase) : next.add(phrase);
      return next;
    });
    if (isSelected) {
      // Remove just this phrase, tolerating it having been used as the
      // whole text, the first phrase, or a later one in the ", "-joined list.
      const withoutPhrase = form.symptomText
        .split(", ")
        .filter((part) => part.trim() !== phrase)
        .join(", ");
      set("symptomText", withoutPhrase);
    } else if (!form.symptomText.split(", ").some((part) => part.trim() === phrase)) {
      set("symptomText", form.symptomText ? `${form.symptomText}, ${phrase}` : phrase);
    }
  }

  function toggleFlag(key) {
    setForm((f) => ({ ...f, historyFlags: { ...f.historyFlags, [key]: !f.historyFlags[key] } }));
  }

  return (
    <Card>
      {/* Segmented progress bars, matching the mockup's ckStepper (each
          bar glows purple when filled) rather than numbered circles. */}
      <div className="mb-2 flex items-center gap-3">
        {step > 0 ? (
          <button type="button" onClick={() => setStep((s) => s - 1)} aria-label="Back" className="btn btn-ghost btn-icon" style={{ color: "var(--color-neutral-400)" }}>
            <i className="ph ph-arrow-left" />
          </button>
        ) : (
          <span style={{ width: 36 }} />
        )}
        <div className="flex flex-1 gap-1">
          {STEPS.map((label, i) => (
            <div
              key={label}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= step ? "var(--color-accent)" : "var(--color-neutral-800)",
                boxShadow: i <= step ? "0 0 6px var(--color-accent)" : "none",
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)", minWidth: 44, textAlign: "right" }}>
          {step + 1} / {STEPS.length}
        </div>
      </div>
      <p className="mb-2" style={{ fontSize: "0.75rem", color: "var(--color-accent-400)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{STEPS[step]}</p>

      {/* Every step after Vitals is explicitly marked optional already -
          this just says so up front, so the 6-step layout reads as "fill
          in what you know" rather than a form that must be completed in
          full before it's useful. */}
      <p className="mb-4" style={{ fontSize: "0.75rem", color: "var(--color-neutral-600)" }}>
        Most steps are optional - fill in what you know and skip the rest with "Skip to Review" below.
      </p>

      {error && (
        <p className="mb-4" style={{ borderRadius: 10, border: "1px solid var(--color-critical)", background: "var(--color-critical-soft)", padding: "8px 12px", fontSize: "0.875rem", color: "var(--color-text)" }}>
          {error}
        </p>
      )}

      {step === 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>Vitals</h2>
            <label className="flex items-center gap-2" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>
              <input type="checkbox" checked={form.vitalsEnabled} onChange={(e) => set("vitalsEnabled", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
              Include vitals
            </label>
          </div>
          {form.vitalsEnabled && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field
                label="Age (years)" type="number" placeholder="e.g. 28" value={form.age} onChange={(e) => set("age", e.target.value)}
                why="Age on its own shifts the baseline risk for several pregnancy complications, so the model factors it in alongside your other vitals."
              />
              <Field
                label="Systolic BP" hint="normal <120" type="number" placeholder="e.g. 118" value={form.sbp} onChange={(e) => set("sbp", e.target.value)}
                why="High blood pressure can be an early sign of pre-eclampsia, a serious pregnancy complication that's easier to manage the earlier it's caught."
              />
              <Field
                label="Diastolic BP" hint="normal <80" type="number" placeholder="e.g. 76" value={form.dbp} onChange={(e) => set("dbp", e.target.value)}
                why="Diastolic pressure is checked alongside systolic - together they give a fuller picture of blood pressure risk than either alone."
              />
              <Field
                label="Blood Sugar (mmol/L)" hint="normal ~6-7" type="number" step="0.1" placeholder="e.g. 6.5" value={form.bs} onChange={(e) => set("bs", e.target.value)}
                why="Elevated blood sugar can indicate gestational diabetes, which needs monitoring and sometimes treatment to protect you and your baby."
              />
              <Field
                label="Body Temp (°F)" hint="normal ~98" type="number" step="0.1" placeholder="e.g. 98.2" value={form.temp} onChange={(e) => set("temp", e.target.value)}
                why="A fever can signal an infection that needs prompt attention during pregnancy, so it's checked as part of every assessment."
              />
              <Field
                label="Heart Rate (bpm)" type="number" placeholder="e.g. 78" value={form.hr} onChange={(e) => set("hr", e.target.value)}
                why="An unusually fast heart rate can be a sign of infection, blood loss, or significant anxiety - all worth knowing about."
              />
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>Anemia Check <span className="tag tag-neutral" style={{ marginLeft: 4, verticalAlign: "middle" }}>optional</span></h2>
            <p className="mb-2 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>If you have a recent hemoglobin (Hb) test result, enter it here for India-specific anemia grading.</p>
            <div className="max-w-[220px]">
              <Field
                label="Hemoglobin (g/dL)" type="number" step="0.1" placeholder="e.g. 10.5" value={form.hemoglobin} onChange={(e) => set("hemoglobin", e.target.value)}
                why="Low hemoglobin (anemia) is very common in pregnancy in India and raises the risk from even routine blood loss at delivery - catching it early means there's time for iron therapy to help."
              />
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>Pregnancy Stage <span className="tag tag-neutral" style={{ marginLeft: 4, verticalAlign: "middle" }}>optional</span></h2>
            <p className="mb-2 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>Lets the assessment factor in trimester-specific risks and week-appropriate warning signs.</p>
            <div className="max-w-[220px]">
              <Field
                label="Current gestational week" type="number" placeholder="e.g. 24" value={form.week} onChange={(e) => set("week", e.target.value)}
                why="Some symptoms and warning signs only mean something at certain stages of pregnancy, so your week helps the assessment weigh them correctly."
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>Additional Checks <span className="tag tag-neutral" style={{ marginLeft: 4, verticalAlign: "middle" }}>optional</span></h2>
          <p className="mb-2 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>Each is a well-established antenatal screening check, not a diagnosis.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field
              label="Current weight (kg)" type="number" step="0.1" placeholder="e.g. 62" value={form.weight} onChange={(e) => set("weight", e.target.value)}
              why="A sudden jump in weight can be an early sign of fluid retention linked to pre-eclampsia, while weight loss can point to other concerns."
            />
            <Field
              label="Height (cm)" type="number" step="0.1" placeholder="e.g. 158" value={form.heightCm} onChange={(e) => set("heightCm", e.target.value)}
              why="Combined with your weight, height gives your BMI - a background risk factor for gestational diabetes and hypertensive disorders, not an emergency sign on its own."
            />
            <Field
              label="Fetal movements (last hour)" type="number" placeholder="e.g. 6" value={form.fetalMovementCount} onChange={(e) => set("fetalMovementCount", e.target.value)}
              why="A change in your baby's usual movement pattern is one of the clearest signs to get checked right away - this compares against the expected range."
            />
            <Field
              label="Fundal height (cm)" type="number" step="0.1" placeholder="e.g. 27" value={form.fundalHeight} onChange={(e) => set("fundalHeight", e.target.value)}
              why="Fundal height is a simple way to check whether the baby is growing as expected for this stage of pregnancy."
            />
            <SelectField
              label="Urine protein" options={URINE_PROTEIN_OPTIONS} value={form.urineProtein} onChange={(e) => set("urineProtein", e.target.value)}
              why="Protein in urine (checked by dipstick) is one of the two things - alongside blood pressure - used to diagnose pre-eclampsia. 2+ or higher on its own is worth an urgent check."
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>Symptoms</h2>
          <p className="mb-3 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>Tap any that apply — they'll be added to the description below, or type your own.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {SYMPTOM_CHIPS.map((phrase) => {
              const selected = selectedChips.has(phrase);
              return (
                <button
                  key={phrase}
                  type="button"
                  onClick={() => toggleChip(phrase)}
                  aria-pressed={selected}
                  style={{
                    borderRadius: 99,
                    border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-neutral-700)"}`,
                    background: selected ? "var(--color-accent-900)" : "transparent",
                    color: selected ? "var(--color-accent-200)" : "var(--color-neutral-400)",
                    padding: "6px 12px",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  {selected ? "✓ " : ""}
                  {phrase}
                </button>
              );
            })}
          </div>
          <textarea
            rows={4}
            aria-label="Describe your symptoms"
            placeholder="Describe how you're feeling in your own words…"
            value={form.symptomText}
            onChange={(e) => set("symptomText", e.target.value)}
            className="input"
            style={{ width: "100%" }}
          />
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>History</h2>
          <p className="mb-3 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>Optional — helps weigh background risk factors.</p>
          <div className="mb-6 max-w-[220px]">
            <Field
              label="Previous pregnancies" hint="not counting this one" type="number" placeholder="e.g. 0"
              value={form.previousPregnancies} onChange={(e) => set("previousPregnancies", e.target.value)}
              why="A 5th or later pregnancy (grand multiparity) carries a higher background risk of hemorrhage and other complications, regardless of how the earlier ones went."
            />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2" style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-neutral-600)" }}>Past pregnancy history</h3>
              <div className="space-y-2">
                {HISTORY_FLAGS.past.map((f) => (
                  <label key={f.key} className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
                    <input type="checkbox" checked={!!form.historyFlags[f.key]} onChange={() => toggleFlag(f.key)} style={{ accentColor: "var(--color-accent)" }} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2" style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-neutral-600)" }}>Current pregnancy care</h3>
              <div className="space-y-2">
                {HISTORY_FLAGS.current.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2"
                    style={{ fontSize: "0.875rem", color: f.protective ? "var(--color-good)" : f.risk ? "var(--color-critical)" : "var(--color-text)" }}
                  >
                    <input type="checkbox" checked={!!form.historyFlags[f.key]} onChange={() => toggleFlag(f.key)} style={{ accentColor: "var(--color-accent)" }} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div>
          {hasSavedEpds && (
            <label className="mb-4 flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
              <input type="checkbox" checked={form.includeEpds} onChange={(e) => set("includeEpds", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
              Include my saved Mental Health Check (EPDS) score in this assessment
            </label>
          )}
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>Review</h2>
          <p className="mb-3 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>Check what you're about to submit, then run the assessment.</p>
          <ReviewSummary form={form} />
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {/* Every remaining step is optional - this lets someone who's
            given enough (or is in a hurry) go straight to submitting
            instead of clicking "Next" through steps they don't need. */}
        {step > 0 && step < STEPS.length - 1 && (
          <button type="button" onClick={() => setStep(STEPS.length - 1)} className="btn btn-ghost" style={{ fontSize: "0.75rem" }}>
            Skip to Review
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => setStep((s) => s + 1)} className="btn btn-primary" style={{ height: 44, paddingInline: 20 }}>
            Next: {STEPS[step + 1]} <i className="ph ph-arrow-right" />
          </button>
        ) : (
          <button type="button" onClick={onSubmit} disabled={submitting} className="btn btn-primary" style={{ height: 44, paddingInline: 20 }}>
            {submitting ? "Running…" : "Run Assessment"}
          </button>
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
  if (form.heightCm) rows.push(["Height", `${form.heightCm} cm`]);
  if (form.fetalMovementCount) rows.push(["Fetal movements", `${form.fetalMovementCount} in last hour`]);
  if (form.fundalHeight) rows.push(["Fundal height", `${form.fundalHeight} cm`]);
  if (form.urineProtein) rows.push(["Urine protein", URINE_PROTEIN_OPTIONS.find((o) => o.value === form.urineProtein)?.label || form.urineProtein]);
  if (form.previousPregnancies) rows.push(["Previous pregnancies", form.previousPregnancies]);
  if (form.symptomText) rows.push(["Symptoms", form.symptomText]);
  const flags = Object.entries(form.historyFlags).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " "));
  if (flags.length) rows.push(["History", flags.join(", ")]);

  if (!rows.length) return <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>Nothing entered yet — go back and add at least one input.</p>;

  return (
    <div style={{ display: "grid", gap: 1, background: "var(--color-neutral-900)", borderRadius: 12, overflow: "hidden" }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ background: "#1b1d2a", display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 14px", fontSize: "0.875rem" }}>
          <span style={{ flexShrink: 0, fontWeight: 500, color: "var(--color-neutral-400)" }}>{label}</span>
          <span style={{ textAlign: "right", color: "var(--color-text)" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
