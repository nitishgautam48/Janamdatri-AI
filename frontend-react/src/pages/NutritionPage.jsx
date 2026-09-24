import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Spinner from "../components/ui/Spinner";
import QuestionFlow from "../components/ui/QuestionFlow";
import { api } from "../lib/api";
import {
  KEYS, lastKnownHemoglobin, scopedGet, scopedSet,
  loadMealLog, toggleMealLogGroup, mealLogFrequencyCounts, todayDateStr,
  loadWaterState, saveWaterState,
} from "../lib/storage";
import { useLang } from "../context/LangContext";

const STATUS_TONE = { Adequate: "good", Borderline: "warning", Low: "critical" };
// Backend-fixed enum (nutrition_eval.py has no i18n layer) - only its
// DISPLAY is translated here, the underlying "Adequate"/"Borderline"/"Low"
// string used for STATUS_TONE lookups and color logic is untouched.
const STATUS_LABEL_KEY = { Adequate: "nutrition.statusAdequate", Borderline: "nutrition.statusBorderline", Low: "nutrition.statusLow" };
const WATER_TARGET = 10;

function WaterTracker() {
  const { t } = useLang();
  const [state, setState] = useState(() => loadWaterState());

  function change(delta) {
    setState((s) => {
      const glasses = Math.max(0, Math.min(WATER_TARGET, s.glasses + delta));
      const next = { ...s, glasses };
      saveWaterState(next);
      return next;
    });
  }

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 12, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{t("nutrition.waterLabel")} <span style={{ color: "var(--color-neutral-500)" }}>{t("nutrition.waterToday")}</span></span>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{state.glasses} / {WATER_TARGET}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${WATER_TARGET},1fr)`, gap: 4 }}>
        {Array.from({ length: WATER_TARGET }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 28,
              borderRadius: "4px 4px 8px 8px",
              border: `1px solid ${i < state.glasses ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
              background: i < state.glasses ? "var(--color-accent-900)" : "transparent",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => change(-1)} className="btn btn-secondary btn-icon" aria-label={t("nutrition.removeGlass")}>
          <i className="ph ph-minus" />
        </button>
        <button type="button" onClick={() => change(1)} className="btn btn-primary" style={{ flex: 1 }}>
          <i className="ph ph-plus" /> {t("nutrition.addGlass")}
        </button>
      </div>
    </div>
  );
}

// Turns a "logged N of the last 7 days" count into the same 0-3 scale the
// frequency questionnaire already uses (see nutrition_eval.py's
// FREQUENCY_OPTIONS) - a suggested starting answer, not a forced one.
function countToFrequencyIndex(count) {
  if (!count) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  return 3;
}

// A simple average of the per-nutrient percentages already shown below -
// not a new medical claim, just one number to anchor the page on. Computed
// client-side so a result saved before this field existed still gets one.
function withNutritionScore(data) {
  if (!data || data.nutritionScore != null) return data;
  const percents = Object.values(data.nutrients || {}).map((n) => n.percent);
  const nutritionScore = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : 0;
  return { ...data, nutritionScore };
}

export default function NutritionPage() {
  const { t } = useLang();
  const [items, setItems] = useState(null);
  const [responses, setResponses] = useState({});
  const [result, setResult] = useState(() => withNutritionScore(scopedGet(KEYS.NUTRITION)?.result || null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mealLog, setMealLog] = useState(() => loadMealLog());
  const todayGroups = new Set(mealLog[todayDateStr()] || []);

  useEffect(() => {
    api.nutritionItems().then((data) => {
      setItems(data);
      // Suggest answers from the meal log so far, rather than leaving the
      // questionnaire blank - still fully editable before submitting.
      const counts = mealLogFrequencyCounts();
      if (Object.keys(counts).length) {
        setResponses((r) => {
          if (Object.keys(r).length) return r;
          const suggested = {};
          data.questions.forEach((q) => {
            if (counts[q.id] != null) suggested[q.id] = countToFrequencyIndex(counts[q.id]);
          });
          return suggested;
        });
      }
    });
  }, []);

  function toggleMeal(groupId) {
    setMealLog(toggleMealLogGroup(groupId));
  }

  async function handleSubmit() {
    setError("");
    if (!items) return;
    const missing = items.questions.some((q) => responses[q.id] === undefined);
    if (missing) {
      setError(t("nutrition.answerAllError"));
      return;
    }

    const guide = scopedGet(KEYS.GUIDE);
    setBusy(true);
    try {
      const data = withNutritionScore(await api.nutritionAssess({
        responses,
        hemoglobin: lastKnownHemoglobin(),
        pregnancyWeek: guide ? guide.week : null,
      }));
      setResult(data);
      scopedSet(KEYS.NUTRITION, { result: data, savedAt: new Date().toISOString() });
    } catch (err) {
      setError(err.message || t("nutrition.analyzeError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {items && (
        <Card>
          <h1 className="text-xl font-bold text-ink">{t("nutrition.todaysMeals")}</h1>
          <p className="mt-1 text-sm text-muted">{t("nutrition.todaysMealsDesc")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {items.questions.map((q) => {
              const logged = todayGroups.has(q.id);
              const count = mealLogFrequencyCounts()[q.id] || 0;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => toggleMeal(q.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    logged ? "border-primary bg-primary-soft text-primary" : "border-border-strong text-muted hover:border-primary hover:text-ink"
                  }`}
                >
                  {logged ? "✓ " : ""}{q.text.split("(")[0].trim()}
                  {count > 0 && <span className="ml-1 text-faint">· {count}{t("nutrition.perWeek")}</span>}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <WaterTracker />

      <Card>
        <h1 className="text-xl font-bold text-ink">{t("nutrition.analysisTitle")}</h1>
        <p className="mt-1 text-sm text-muted">{t("nutrition.analysisDesc")}</p>

        {!items ? (
          <Spinner className="mt-4" />
        ) : (
          <QuestionFlow
            questions={items.questions.map((q) => ({ id: q.id, text: q.text, options: items.frequencyOptions }))}
            responses={responses}
            onAnswer={(id, value) => setResponses((r) => ({ ...r, [id]: value }))}
            onComplete={handleSubmit}
            submitLabel={t("nutrition.analyzeMyDiet")}
            busy={busy}
            error={error}
          />
        )}
      </Card>

      {result && (
        <Card className={result.nutritionScore >= 70 ? "border-good/30" : result.nutritionScore >= 40 ? "border-warning/30 bg-warning-soft" : "border-critical/30 bg-critical-soft"}>
          <p className="eyebrow mb-2">{t("nutrition.nutritionScore")}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-ink">{result.nutritionScore}</span>
            <span className="text-sm text-muted">/ 100</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
            <div
              className={`h-full rounded-full ${result.nutritionScore >= 70 ? "bg-good" : result.nutritionScore >= 40 ? "bg-warning" : "bg-critical"}`}
              style={{ width: `${result.nutritionScore}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-faint">{t("nutrition.scoreDesc")}</p>
        </Card>
      )}

      {result && (
        <Card>
          <h3 className="mb-3 text-sm font-bold text-ink">{t("nutrition.adequacyTitle")}</h3>
          {result.priorityNutrients?.length > 0 && (
            <p className="mb-2 text-xs text-muted">{t("nutrition.priorityFor")} {result.priorityNutrients.join(", ")}</p>
          )}
          {result.connectedInsights?.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {result.connectedInsights.map((insight, i) => (
                <div key={i} className="rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-sm text-ink">
                  🔗 {insight}
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(result.nutrients).map(([name, v]) => (
              <div key={name} className="rounded-md border border-border p-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <strong className="text-sm text-ink">{name}</strong>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    v.status === "Adequate" ? "bg-good-soft text-good" : v.status === "Borderline" ? "bg-warning-soft text-warning" : "bg-critical-soft text-critical"
                  }`}>
                    {t(STATUS_LABEL_KEY[v.status]) || v.status}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className={`h-full rounded-full ${v.status === "Adequate" ? "bg-good" : v.status === "Borderline" ? "bg-warning" : "bg-critical"}`}
                    style={{ width: `${v.percent}%` }}
                  />
                </div>
                {v.status !== "Adequate" && (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-muted">
                    {v.suggestions.slice(0, 4).map((s) => <li key={s}>{s}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
