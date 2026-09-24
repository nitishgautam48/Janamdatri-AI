import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Pill from "../components/ui/Pill";
import Spinner from "../components/ui/Spinner";
import QuestionFlow from "../components/ui/QuestionFlow";
import { api } from "../lib/api";
import { KEYS, scopedGet, scopedSet, epdsDaysSince, epdsFollowUpDue, loadMoodLog, setTodayMood, loadPhq2, savePhq2 } from "../lib/storage";

const MOODS = [
  { key: "good", icon: "ph-smiley", label: "Good", color: "var(--color-good)" },
  { key: "okay", icon: "ph-smiley-meh", label: "Okay", color: "var(--color-neutral-400)" },
  { key: "low", icon: "ph-smiley-sad", label: "Low", color: "var(--color-warning)" },
  { key: "worried", icon: "ph-smiley-nervous", label: "Worried", color: "var(--color-warning)" },
  { key: "verysad", icon: "ph-cloud-rain", label: "Very sad", color: "var(--color-critical)" },
];

function MoodPicker() {
  const [log, setLog] = useState(() => loadMoodLog());
  const todayKey = new Date().toLocaleDateString("en-CA");
  const today = log[todayKey];

  function pick(key) {
    setLog(setTodayMood(key));
  }

  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toLocaleDateString("en-CA");
    const mood = MOODS.find((m) => m.key === log[key]);
    return { label: d.toLocaleDateString(undefined, { weekday: "narrow" }), icon: mood?.icon || "ph-circle-dashed", color: mood?.color || "var(--color-neutral-700)" };
  });

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 12, boxShadow: "var(--shadow-sm)" }}>
      <div>
        <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>How is your mood today?</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
        {MOODS.map((m) => {
          const selected = today === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => pick(m.key)}
              style={{
                border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
                background: selected ? "var(--color-accent-900)" : "transparent",
                borderRadius: 12,
                padding: "10px 2px",
                display: "grid",
                justifyItems: "center",
                gap: 4,
                cursor: "pointer",
                minHeight: 68,
              }}
            >
              <i className={`ph ${m.icon}`} style={{ fontSize: "1.625rem", color: m.color }} />
              <span style={{ fontSize: "0.6875rem", color: "var(--color-neutral-400)" }}>{m.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, borderTop: "1px solid var(--color-neutral-800)", paddingTop: 10 }}>
        {days.map((d, i) => (
          <div key={i} style={{ display: "grid", justifyItems: "center", gap: 2 }}>
            <i className={`ph ${d.icon}`} style={{ fontSize: "1.125rem", color: d.color }} />
            <span style={{ fontSize: "0.625rem", color: "var(--color-neutral-600)" }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PHQ2_QUESTIONS = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
];
const PHQ2_OPTIONS = ["Not at all", "Several days", "More than half the days", "Nearly every day"];

function Phq2Quick() {
  const [saved, setSaved] = useState(() => loadPhq2());
  const [answers, setAnswers] = useState(saved?.answers || {});

  function pick(qIndex, score) {
    const nextAnswers = { ...answers, [qIndex]: score };
    setAnswers(nextAnswers);
    if (Object.keys(nextAnswers).length === PHQ2_QUESTIONS.length) {
      const total = PHQ2_QUESTIONS.reduce((sum, _, i) => sum + nextAnswers[i], 0);
      const result = { answers: nextAnswers, total, flagged: total >= 3 };
      savePhq2(result);
      setSaved(result);
    }
  }

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 14, boxShadow: "var(--shadow-sm)" }}>
      <div>
        <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>PHQ-2 quick check</div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>In the last 2 weeks, how often have you had…</div>
      </div>
      {PHQ2_QUESTIONS.map((q, i) => (
        <div key={q} style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{q}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PHQ2_OPTIONS.map((label, score) => {
              const selected = answers[i] === score;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(i, score)}
                  style={{
                    padding: "6px 10px",
                    whiteSpace: "nowrap",
                    borderRadius: 99,
                    border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-neutral-700)"}`,
                    background: selected ? "var(--color-accent-900)" : "transparent",
                    color: selected ? "var(--color-accent-200)" : "var(--color-neutral-400)",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {saved && (
        <div style={{ padding: 12, borderRadius: 10, background: saved.flagged ? "var(--color-warning-soft)" : "var(--color-good-soft)", display: "grid", gap: 6 }}>
          <div style={{ fontSize: "0.875rem", color: saved.flagged ? "var(--color-warning)" : "var(--color-good)" }}>
            {saved.flagged ? "Worth a closer look" : "Nothing flagged right now"}
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
            {saved.flagged
              ? "This quick check alone doesn't diagnose anything, but a score like this is often followed up with the fuller Mental Health Check (EPDS) above, or a conversation with your ANC provider."
              : "This is a 2-question quick check, not the full EPDS - still worth doing the fuller check above from time to time."}
          </div>
          {saved.flagged && (
            <a href="tel:14416" className="btn btn-primary" style={{ justifySelf: "start", fontSize: "0.8125rem" }}>
              <i className="ph ph-phone" /> Tele-MANAS 14416
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function BreathingExercise() {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState("in");

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setPhase((p) => (p === "in" ? "out" : "in")), 4000);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "20px 16px", display: "grid", gap: 16, justifyItems: "center", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ justifySelf: "start", fontSize: "0.9375rem", color: "var(--color-text)" }}>Breathing exercise</div>
      <div style={{ width: 180, height: 180, borderRadius: "50%", border: "1px dashed var(--color-neutral-700)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 170,
            height: 170,
            borderRadius: "50%",
            background: "radial-gradient(circle, var(--color-accent-700), var(--color-accent-900))",
            boxShadow: "0 0 40px rgba(145,132,217,0.35)",
            transform: `scale(${active && phase === "in" ? 1 : 0.7})`,
            transition: "transform 4s ease-in-out",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: "0.9375rem", color: "var(--color-accent-100)" }}>{active ? (phase === "in" ? "Breathe in…" : "Breathe out…") : "Ready"}</span>
        </div>
      </div>
      <button type="button" onClick={() => setActive((a) => !a)} className="btn btn-primary" style={{ minWidth: 140 }}>
        <i className={`ph ${active ? "ph-pause" : "ph-play"}`} /> {active ? "Stop" : "Start"}
      </button>
    </div>
  );
}

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <MoodPicker />
          <Phq2Quick />
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <BreathingExercise />
          <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
            <i className="ph ph-headset" style={{ fontSize: "1.5rem", color: "var(--color-accent-400)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>Tele-MANAS · 14416</div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>Free, private mental health support, 24 hours</div>
            </div>
            <a href="tel:14416" className="btn btn-secondary btn-icon" aria-label="Call"><i className="ph ph-phone" /></a>
          </div>
        </div>
      </div>

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
          <QuestionFlow
            questions={items.items.map((text, i) => ({ id: i, text, options: items.options[i] }))}
            responses={responses}
            onAnswer={(id, value) => setResponses((r) => ({ ...r, [id]: value }))}
            onComplete={handleSubmit}
            submitLabel="Score My Mood"
            busy={busy}
            error={error}
          />
        )}
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
              🚨 You indicated thoughts of self-harm have occurred to you ("{result.selfHarmSeverityLabel}"). Please talk to
              someone you trust right now.
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
