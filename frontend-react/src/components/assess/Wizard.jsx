import { useState } from "react";
import Card from "../ui/Card";
import { slugify } from "../../lib/a11y";
import { useLang } from "../../context/LangContext";

const STEP_KEYS = ["wizard.stepVitals", "wizard.stepAnemia", "wizard.stepAdditional", "wizard.stepSymptoms", "wizard.stepHistory", "wizard.stepReview"];

// `phrase` is what actually gets inserted into symptomText and sent to the
// backend's phrase-matching (danger_ladder.py etc. match against specific
// English/Hindi/Hinglish phrase lists, not arbitrary translated text) - it
// must stay fixed regardless of UI language. `labelKey` is only the
// button's displayed text, decoupled from that so the chip can be
// translated without breaking what gets matched.
const SYMPTOM_CHIPS = [
  { phrase: "severe headache", labelKey: "wizard.chipSevereHeadache" },
  { phrase: "blurred vision", labelKey: "wizard.chipBlurredVision" },
  { phrase: "heavy bleeding", labelKey: "wizard.chipHeavyBleeding" },
  { phrase: "baby stopped moving", labelKey: "wizard.chipBabyStoppedMoving" },
  { phrase: "convulsions", labelKey: "wizard.chipConvulsions" },
  { phrase: "high fever", labelKey: "wizard.chipHighFever" },
  { phrase: "severe abdominal pain", labelKey: "wizard.chipSevereAbdominalPain" },
  { phrase: "face is swollen", labelKey: "wizard.chipFaceSwollen" },
  { phrase: "labor for more than a day", labelKey: "wizard.chipLaborLong" },
  { phrase: "foul smelling discharge", labelKey: "wizard.chipFoulDischarge" },
  { phrase: "chest pain", labelKey: "wizard.chipChestPain" },
];

const HISTORY_FLAGS = {
  past: [
    { key: "prior_csection", labelKey: "wizard.flagPriorCsection" },
    { key: "prior_preeclampsia", labelKey: "wizard.flagPriorPreeclampsia" },
    { key: "prior_pph", labelKey: "wizard.flagPriorPph" },
    { key: "prior_stillbirth_or_loss", labelKey: "wizard.flagPriorStillbirth" },
    { key: "chronic_hypertension", labelKey: "wizard.flagChronicHtn" },
    { key: "pre_existing_diabetes", labelKey: "wizard.flagPreDiabetes" },
  ],
  current: [
    { key: "regular_anc_visits", labelKey: "wizard.flagRegularAnc", protective: true },
    { key: "iron_folic_supplementation", labelKey: "wizard.flagIronFolic", protective: true },
    { key: "institutional_delivery_plan", labelKey: "wizard.flagInstDelivery", protective: true },
    { key: "birth_preparedness_plan", labelKey: "wizard.flagBirthPrep", protective: true },
    { key: "family_support", labelKey: "wizard.flagFamilySupport", protective: true },
    { key: "no_antenatal_care", labelKey: "wizard.flagNoAnc", risk: true },
    { key: "multiple_gestation", labelKey: "wizard.flagMultipleGestation", risk: true },
  ],
};

function Field({ label, hint, why, ...props }) {
  const { t } = useLang();
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
            aria-label={t("wizard.whyAriaLabel")}
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
  const { t } = useLang();
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
            aria-label={t("wizard.whyAriaLabel")}
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
  const { t } = useLang();
  const STEPS = STEP_KEYS.map((k) => t(k));
  const URINE_PROTEIN_OPTIONS = [
    { value: "", label: t("wizard.urineNotTested") },
    { value: "nil", label: t("wizard.urineNil") },
    { value: "trace", label: t("wizard.urineTrace") },
    { value: "1+", label: "1+" },
    { value: "2+", label: "2+" },
    { value: "3+", label: "3+" },
  ];
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
          <button type="button" onClick={() => setStep((s) => s - 1)} aria-label={t("common.back")} className="btn btn-ghost btn-icon" style={{ color: "var(--color-neutral-400)" }}>
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
        {t("wizard.optionalStepsNote")}
      </p>

      {error && (
        <p className="mb-4" style={{ borderRadius: 10, border: "1px solid var(--color-critical)", background: "var(--color-critical-soft)", padding: "8px 12px", fontSize: "0.875rem", color: "var(--color-text)" }}>
          {error}
        </p>
      )}

      {step === 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.stepVitals")}</h2>
            <label className="flex items-center gap-2" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>
              <input type="checkbox" checked={form.vitalsEnabled} onChange={(e) => set("vitalsEnabled", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
              {t("wizard.includeVitals")}
            </label>
          </div>
          {form.vitalsEnabled && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field
                label={t("wizard.ageLabel")} type="number" placeholder="e.g. 28" value={form.age} onChange={(e) => set("age", e.target.value)}
                why={t("wizard.ageWhy")}
              />
              <Field
                label={t("wizard.sbpLabel")} hint={t("wizard.sbpHint")} type="number" placeholder="e.g. 118" value={form.sbp} onChange={(e) => set("sbp", e.target.value)}
                why={t("wizard.sbpWhy")}
              />
              <Field
                label={t("wizard.dbpLabel")} hint={t("wizard.dbpHint")} type="number" placeholder="e.g. 76" value={form.dbp} onChange={(e) => set("dbp", e.target.value)}
                why={t("wizard.dbpWhy")}
              />
              <Field
                label={t("wizard.bsLabel")} hint={t("wizard.bsHint")} type="number" step="0.1" placeholder="e.g. 6.5" value={form.bs} onChange={(e) => set("bs", e.target.value)}
                why={t("wizard.bsWhy")}
              />
              <Field
                label={t("wizard.tempLabel")} hint={t("wizard.tempHint")} type="number" step="0.1" placeholder="e.g. 98.2" value={form.temp} onChange={(e) => set("temp", e.target.value)}
                why={t("wizard.tempWhy")}
              />
              <Field
                label={t("wizard.hrLabel")} type="number" placeholder="e.g. 78" value={form.hr} onChange={(e) => set("hr", e.target.value)}
                why={t("wizard.hrWhy")}
              />
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.anemiaCheckHeading")} <span className="tag tag-neutral" style={{ marginLeft: 4, verticalAlign: "middle" }}>{t("wizard.optionalTag")}</span></h2>
            <p className="mb-2 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("wizard.anemiaCheckDesc")}</p>
            <div className="max-w-[220px]">
              <Field
                label={t("wizard.hemoglobinLabel")} type="number" step="0.1" placeholder="e.g. 10.5" value={form.hemoglobin} onChange={(e) => set("hemoglobin", e.target.value)}
                why={t("wizard.hemoglobinWhy")}
              />
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.pregnancyStageHeading")} <span className="tag tag-neutral" style={{ marginLeft: 4, verticalAlign: "middle" }}>{t("wizard.optionalTag")}</span></h2>
            <p className="mb-2 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("wizard.pregnancyStageDesc")}</p>
            <div className="max-w-[220px]">
              <Field
                label={t("wizard.weekLabel")} type="number" placeholder="e.g. 24" value={form.week} onChange={(e) => set("week", e.target.value)}
                why={t("wizard.weekWhy")}
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.additionalChecksHeading")} <span className="tag tag-neutral" style={{ marginLeft: 4, verticalAlign: "middle" }}>{t("wizard.optionalTag")}</span></h2>
          <p className="mb-2 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("wizard.additionalChecksDesc")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field
              label={t("wizard.weightLabel")} type="number" step="0.1" placeholder="e.g. 62" value={form.weight} onChange={(e) => set("weight", e.target.value)}
              why={t("wizard.weightWhy")}
            />
            <Field
              label={t("wizard.heightLabel")} type="number" step="0.1" placeholder="e.g. 158" value={form.heightCm} onChange={(e) => set("heightCm", e.target.value)}
              why={t("wizard.heightWhy")}
            />
            <Field
              label={t("wizard.fetalMovementLabel")} type="number" placeholder="e.g. 6" value={form.fetalMovementCount} onChange={(e) => set("fetalMovementCount", e.target.value)}
              why={t("wizard.fetalMovementWhy")}
            />
            <Field
              label={t("wizard.fundalHeightLabel")} type="number" step="0.1" placeholder="e.g. 27" value={form.fundalHeight} onChange={(e) => set("fundalHeight", e.target.value)}
              why={t("wizard.fundalHeightWhy")}
            />
            <SelectField
              label={t("wizard.urineProteinLabel")} options={URINE_PROTEIN_OPTIONS} value={form.urineProtein} onChange={(e) => set("urineProtein", e.target.value)}
              why={t("wizard.urineProteinWhy")}
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.symptomsHeading")}</h2>
          <p className="mb-3 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("wizard.symptomsDesc")}</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {SYMPTOM_CHIPS.map((chip) => {
              const selected = selectedChips.has(chip.phrase);
              return (
                <button
                  key={chip.phrase}
                  type="button"
                  onClick={() => toggleChip(chip.phrase)}
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
                  {t(chip.labelKey)}
                </button>
              );
            })}
          </div>
          <textarea
            rows={4}
            aria-label={t("wizard.symptomsAriaLabel")}
            placeholder={t("wizard.symptomsPlaceholder")}
            value={form.symptomText}
            onChange={(e) => set("symptomText", e.target.value)}
            className="input"
            style={{ width: "100%" }}
          />
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.historyHeading")}</h2>
          <p className="mb-3 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("wizard.historyDesc")}</p>
          <div className="mb-6 max-w-[220px]">
            <Field
              label={t("wizard.previousPregnanciesLabel")} hint={t("wizard.previousPregnanciesHint")} type="number" placeholder="e.g. 0"
              value={form.previousPregnancies} onChange={(e) => set("previousPregnancies", e.target.value)}
              why={t("wizard.previousPregnanciesWhy")}
            />
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="mb-2" style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-neutral-600)" }}>{t("wizard.pastHistoryHeading")}</h3>
              <div className="space-y-2">
                {HISTORY_FLAGS.past.map((f) => (
                  <label key={f.key} className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
                    <input type="checkbox" checked={!!form.historyFlags[f.key]} onChange={() => toggleFlag(f.key)} style={{ accentColor: "var(--color-accent)" }} />
                    {t(f.labelKey)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2" style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-neutral-600)" }}>{t("wizard.currentCareHeading")}</h3>
              <div className="space-y-2">
                {HISTORY_FLAGS.current.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2"
                    style={{ fontSize: "0.875rem", color: f.protective ? "var(--color-good)" : f.risk ? "var(--color-critical)" : "var(--color-text)" }}
                  >
                    <input type="checkbox" checked={!!form.historyFlags[f.key]} onChange={() => toggleFlag(f.key)} style={{ accentColor: "var(--color-accent)" }} />
                    {t(f.labelKey)}
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
              {t("wizard.includeEpdsLabel")}
            </label>
          )}
          <h2 style={{ fontSize: "1.25rem", fontWeight: 500, color: "var(--color-text)" }}>{t("wizard.reviewHeading")}</h2>
          <p className="mb-3 mt-1" style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("wizard.reviewDesc")}</p>
          <ReviewSummary form={form} urineProteinOptions={URINE_PROTEIN_OPTIONS} />
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {/* Every remaining step is optional - this lets someone who's
            given enough (or is in a hurry) go straight to submitting
            instead of clicking "Next" through steps they don't need. */}
        {step > 0 && step < STEPS.length - 1 && (
          <button type="button" onClick={() => setStep(STEPS.length - 1)} className="btn btn-ghost" style={{ fontSize: "0.75rem" }}>
            {t("wizard.skipToReview")}
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => setStep((s) => s + 1)} className="btn btn-primary" style={{ height: 44, paddingInline: 20 }}>
            {t("wizard.nextPrefix")}{STEPS[step + 1]} <i className="ph ph-arrow-right" />
          </button>
        ) : (
          <button type="button" onClick={onSubmit} disabled={submitting} className="btn btn-primary" style={{ height: 44, paddingInline: 20 }}>
            {submitting ? t("wizard.running") : t("wizard.runAssessment")}
          </button>
        )}
      </div>
    </Card>
  );
}

const ALL_HISTORY_FLAGS = [...HISTORY_FLAGS.past, ...HISTORY_FLAGS.current];

function ReviewSummary({ form, urineProteinOptions }) {
  const { t } = useLang();
  const rows = [];
  if (form.vitalsEnabled && (form.age || form.sbp || form.dbp || form.bs || form.temp || form.hr)) {
    rows.push([t("wizard.reviewVitalsLabel"),
      `${t("wizard.reviewAge")} ${form.age || "—"}, ${t("wizard.reviewBp")} ${form.sbp || "—"}/${form.dbp || "—"}, ${t("wizard.reviewBs")} ${form.bs || "—"}, ${t("wizard.reviewTemp")} ${form.temp || "—"}, ${t("wizard.reviewHr")} ${form.hr || "—"}`]);
  }
  if (form.hemoglobin) rows.push([t("wizard.reviewHemoglobinLabel"), `${form.hemoglobin} g/dL`]);
  if (form.week) rows.push([t("wizard.reviewWeekLabel"), form.week]);
  if (form.weight) rows.push([t("wizard.reviewWeightLabel"), `${form.weight} kg`]);
  if (form.heightCm) rows.push([t("wizard.reviewHeightLabel"), `${form.heightCm} cm`]);
  if (form.fetalMovementCount) rows.push([t("wizard.reviewFetalMovementLabel"), `${form.fetalMovementCount} ${t("wizard.reviewInLastHour")}`]);
  if (form.fundalHeight) rows.push([t("wizard.reviewFundalHeightLabel"), `${form.fundalHeight} cm`]);
  if (form.urineProtein) rows.push([t("wizard.reviewUrineProteinLabel"), urineProteinOptions.find((o) => o.value === form.urineProtein)?.label || form.urineProtein]);
  if (form.previousPregnancies) rows.push([t("wizard.reviewPreviousPregnanciesLabel"), form.previousPregnancies]);
  if (form.symptomText) rows.push([t("wizard.reviewSymptomsLabel"), form.symptomText]);
  const flags = Object.entries(form.historyFlags)
    .filter(([, v]) => v)
    .map(([k]) => {
      const flag = ALL_HISTORY_FLAGS.find((f) => f.key === k);
      return flag ? t(flag.labelKey) : k.replace(/_/g, " ");
    });
  if (flags.length) rows.push([t("wizard.reviewHistoryLabel"), flags.join(", ")]);

  if (!rows.length) return <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{t("wizard.reviewEmpty")}</p>;

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
