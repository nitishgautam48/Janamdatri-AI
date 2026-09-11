import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { api } from "../lib/api";
import { KEYS, lastKnownHemoglobin, scopedGet, scopedSet } from "../lib/storage";

const STATUS_TONE = { Adequate: "good", Borderline: "warning", Low: "critical" };

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
  const [items, setItems] = useState(null);
  const [responses, setResponses] = useState({});
  const [result, setResult] = useState(() => withNutritionScore(scopedGet(KEYS.NUTRITION)?.result || null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.nutritionItems().then(setItems);
  }, []);

  async function handleSubmit() {
    setError("");
    if (!items) return;
    const missing = items.questions.some((q) => responses[q.id] === undefined);
    if (missing) {
      setError("Please answer all the questions.");
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
      setError(err.message || "Could not analyze diet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <h1 className="text-xl font-bold text-ink">Nutrition Analysis</h1>
        <p className="mt-1 text-sm text-muted">
          Tell me how often you eat these food groups, and I'll check your intake against pregnancy nutrient needs
          (iron, protein, folate, calcium, B12, vitamin D, iodine) and suggest specific, affordable Indian foods to
          close any gaps. Not a lab test - a starting point for the conversation with your ANC provider or a
          nutritionist.
        </p>

        {!items ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {items.questions.map((q, i) => (
              <div key={q.id} className="py-4">
                <p className="mb-2 text-sm font-medium text-ink">{i + 1}. {q.text}</p>
                <div className="flex flex-col gap-1.5">
                  {items.frequencyOptions.map((opt, val) => (
                    <label key={val} className="flex items-center gap-2 text-sm text-muted">
                      <input
                        type="radio"
                        name={`nutrition-${q.id}`}
                        checked={responses[q.id] === val}
                        onChange={() => setResponses((r) => ({ ...r, [q.id]: val }))}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
        <Button className="mt-4" onClick={handleSubmit} disabled={busy || !items}>
          {busy ? "…" : "Analyze My Diet"}
        </Button>
      </Card>

      {result && (
        <Card className={result.nutritionScore >= 70 ? "border-good/30" : result.nutritionScore >= 40 ? "border-warning/30 bg-warning-soft" : "border-critical/30 bg-critical-soft"}>
          <p className="eyebrow mb-2">Nutrition Score</p>
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
          <p className="mt-2 text-xs text-faint">
            An overall read across the nutrients below - a starting point for the conversation with your ANC provider,
            not a lab result.
          </p>
        </Card>
      )}

      {result && (
        <Card>
          <h3 className="mb-3 text-sm font-bold text-ink">Your Nutrient Adequacy</h3>
          {result.priorityNutrients?.length > 0 && (
            <p className="mb-2 text-xs text-muted">Priority for this trimester: {result.priorityNutrients.join(", ")}</p>
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
                    {v.status}
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
