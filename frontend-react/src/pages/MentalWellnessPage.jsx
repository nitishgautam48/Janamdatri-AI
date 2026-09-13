import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Pill from "../components/ui/Pill";
import Spinner from "../components/ui/Spinner";
import { api } from "../lib/api";
import { KEYS, scopedGet, scopedSet, epdsDaysSince, epdsFollowUpDue } from "../lib/storage";

const SUPPORTIVE_INFO = {
  "Low probability": "Your responses don't suggest significant depression or anxiety symptoms right now. Mood can shift during pregnancy and after birth, so it's worth checking in again in a couple of weeks, especially if anything changes.",
  "Possible depression": "Your responses suggest some symptoms worth paying attention to. This is common during and after pregnancy, and it doesn't mean anything is wrong with you as a mother. Consider mentioning how you've been feeling at your next ANC visit.",
  "Probable depression": "Your responses suggest a symptom pattern consistent with depression. This is common, treatable, and not a personal failing - please talk to your ANC provider or a counselor soon rather than waiting to see if it passes.",
  "High symptom burden": "Your responses suggest a significant symptom burden right now. Please talk to your ANC provider or a counselor soon - support that actually helps is available, and reaching out is the fastest way to feel better.",
};

export default function MentalWellnessPage() {
  const [items, setItems] = useState(null);
  const [responses, setResponses] = useState({});
  const [savedEpds, setSavedEpds] = useState(() => scopedGet(KEYS.EPDS));
  const [result, setResult] = useState(() => scopedGet(KEYS.EPDS)?.result || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const followUpDue = epdsFollowUpDue(savedEpds);
  const daysSince = epdsDaysSince(savedEpds);

  useEffect(() => {
    api.psychAssessItems().then(setItems);
  }, []);

  async function handleSubmit() {
    setError("");
    if (!items) return;
    const missing = items.items.some((_, i) => responses[i] === undefined);
    if (missing) {
      setError("Please answer all 10 questions.");
      return;
    }
    const orderedResponses = items.items.map((_, i) => responses[i]);

    setBusy(true);
    try {
      const data = await api.psychAssess(orderedResponses);
      setResult(data);
      const saved = { responses: orderedResponses, result: data, savedAt: new Date().toISOString() };
      scopedSet(KEYS.EPDS, saved);
      setSavedEpds(saved);
    } catch (err) {
      setError(err.message || "Could not score EPDS.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {savedEpds && (
        <Card className={followUpDue ? "border-warning/40 bg-warning-soft" : ""}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink">
              Last check: <strong>{savedEpds.result.classification}</strong> ({daysSince} day{daysSince === 1 ? "" : "s"} ago)
            </p>
            {followUpDue && <Pill tone="warning">Follow-up due</Pill>}
          </div>
          {followUpDue && (
            <p className="mt-1.5 text-sm text-warning">
              It's been {daysSince} days since your last check, which suggested {savedEpds.result.classification.toLowerCase()} —
              worth checking in again below.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h1 className="text-xl font-bold text-ink">Mental Health Check</h1>
        <p className="mt-1 text-sm text-muted">
          The Edinburgh Postnatal Depression Scale (EPDS) — a validated 10-question screening tool for how you've
          felt over the past 7 days, used during pregnancy and after birth. This is a screening aid, not a
          diagnosis.
        </p>

        {!items ? (
          <Spinner className="mt-4" />
        ) : (
          <div className="mt-4 divide-y divide-border">
            {items.items.map((text, i) => (
              <div key={i} className="py-4">
                <p className="mb-2 text-sm font-medium text-ink">{i + 1}. {text}</p>
                <div className="flex flex-col gap-1.5">
                  {items.options[i].map((opt, val) => (
                    <label key={val} className="flex items-center gap-2 text-sm text-muted">
                      <input
                        type="radio"
                        name={`epds-q${i}`}
                        checked={responses[i] === val}
                        onChange={() => setResponses((r) => ({ ...r, [i]: val }))}
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
          {busy ? "…" : "Score My Mood"}
        </Button>
      </Card>

      {result && (
        <Card>
          <h3 className="mb-3 text-sm font-bold text-ink">Your Result</h3>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-ink">{result.total}</span>
            <span className="text-sm text-muted">/ {result.maxScore}</span>
          </div>
          <p className="mb-3 text-sm font-semibold text-ink">{result.classification}</p>

          {result.selfHarmFlagged && (
            <div className="mb-3 rounded-md border border-critical/40 bg-critical-soft p-3 text-sm text-critical">
              🚨 You indicated thoughts of self-harm have occurred to you. Please talk to someone you trust right now.
              <br />
              <a href="tel:1800-599-0019" className="mt-2 inline-block rounded-full bg-critical px-4 py-2 text-sm font-bold text-white">
                📞 Call KIRAN: 1800-599-0019 (toll-free, 24x7)
              </a>
            </div>
          )}

          {SUPPORTIVE_INFO[result.classification] && (
            <p className="mb-2 text-sm text-warning">💛 {SUPPORTIVE_INFO[result.classification]}</p>
          )}

          {result.anxietySubscale?.flagged && (
            <p className="mb-2 text-sm text-warning">
              💛 Your responses also suggest possible anxiety (a validated EPDS subscale), even{" "}
              {result.classification === "Low probability" ? "though your overall mood score is low" : "alongside your mood score"} - this
              is worth mentioning to your ANC provider too.
            </p>
          )}

          {!result.selfHarmFlagged && result.classification !== "Low probability" && (
            <p className="mb-2 text-xs text-faint">We'll suggest a follow-up check in about 2 weeks - feelings during pregnancy can change, and it helps to keep checking in.</p>
          )}

          <p className="text-xs text-faint">{result.methodology}</p>
        </Card>
      )}
    </div>
  );
}
