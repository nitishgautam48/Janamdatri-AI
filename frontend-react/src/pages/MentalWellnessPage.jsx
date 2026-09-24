import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Pill from "../components/ui/Pill";
import Spinner from "../components/ui/Spinner";
import QuestionFlow from "../components/ui/QuestionFlow";
import { api } from "../lib/api";
import { KEYS, scopedGet, scopedSet, epdsDaysSince, epdsFollowUpDue, loadMoodLog, setTodayMood, loadPhq2, savePhq2 } from "../lib/storage";
import { useLang } from "../context/LangContext";

const MOODS = [
  { key: "good", icon: "ph-smiley", labelKey: "wellness.moodGood", color: "var(--color-good)" },
  { key: "okay", icon: "ph-smiley-meh", labelKey: "wellness.moodOkay", color: "var(--color-neutral-400)" },
  { key: "low", icon: "ph-smiley-sad", labelKey: "wellness.moodLow", color: "var(--color-warning)" },
  { key: "worried", icon: "ph-smiley-nervous", labelKey: "wellness.moodWorried", color: "var(--color-warning)" },
  { key: "verysad", icon: "ph-cloud-rain", labelKey: "wellness.moodVerySad", color: "var(--color-critical)" },
];

function MoodPicker() {
  const { t } = useLang();
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
        <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{t("wellness.howIsMood")}</div>
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
              <span style={{ fontSize: "0.6875rem", color: "var(--color-neutral-400)" }}>{t(m.labelKey)}</span>
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

const PHQ2_QUESTION_KEYS = ["wellness.phq2Q1", "wellness.phq2Q2"];
const PHQ2_OPTION_KEYS = ["wellness.phq2OptNotAtAll", "wellness.phq2OptSeveralDays", "wellness.phq2OptMoreThanHalf", "wellness.phq2OptNearlyEveryDay"];

function Phq2Quick() {
  const { t } = useLang();
  const [saved, setSaved] = useState(() => loadPhq2());
  const [answers, setAnswers] = useState(saved?.answers || {});

  function pick(qIndex, score) {
    const nextAnswers = { ...answers, [qIndex]: score };
    setAnswers(nextAnswers);
    if (Object.keys(nextAnswers).length === PHQ2_QUESTION_KEYS.length) {
      const total = PHQ2_QUESTION_KEYS.reduce((sum, _, i) => sum + nextAnswers[i], 0);
      const result = { answers: nextAnswers, total, flagged: total >= 3 };
      savePhq2(result);
      setSaved(result);
    }
  }

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 14, boxShadow: "var(--shadow-sm)" }}>
      <div>
        <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{t("wellness.phq2Title")}</div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("wellness.phq2Subtitle")}</div>
      </div>
      {PHQ2_QUESTION_KEYS.map((qKey, i) => (
        <div key={qKey} style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{t(qKey)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PHQ2_OPTION_KEYS.map((labelKey, score) => {
              const selected = answers[i] === score;
              return (
                <button
                  key={labelKey}
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
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {saved && (
        <div style={{ padding: 12, borderRadius: 10, background: saved.flagged ? "var(--color-warning-soft)" : "var(--color-good-soft)", display: "grid", gap: 6 }}>
          <div style={{ fontSize: "0.875rem", color: saved.flagged ? "var(--color-warning)" : "var(--color-good)" }}>
            {saved.flagged ? t("wellness.phq2WorthLook") : t("wellness.phq2NothingFlagged")}
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
            {saved.flagged ? t("wellness.phq2FlaggedNote") : t("wellness.phq2OkNote")}
          </div>
          {saved.flagged && (
            <a href="tel:14416" className="btn btn-primary" style={{ justifySelf: "start", fontSize: "0.8125rem" }}>
              <i className="ph ph-phone" /> {t("wellness.teleManas")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function BreathingExercise() {
  const { t } = useLang();
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState("in");

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setPhase((p) => (p === "in" ? "out" : "in")), 4000);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "20px 16px", display: "grid", gap: 16, justifyItems: "center", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ justifySelf: "start", fontSize: "0.9375rem", color: "var(--color-text)" }}>{t("wellness.breathingExercise")}</div>
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
          <span style={{ fontSize: "0.9375rem", color: "var(--color-accent-100)" }}>{active ? (phase === "in" ? t("wellness.breatheIn") : t("wellness.breatheOut")) : t("wellness.ready")}</span>
        </div>
      </div>
      <button type="button" onClick={() => setActive((a) => !a)} className="btn btn-primary" style={{ minWidth: 140 }}>
        <i className={`ph ${active ? "ph-pause" : "ph-play"}`} /> {active ? t("wellness.stop") : t("wellness.start")}
      </button>
    </div>
  );
}

// Both keyed by the exact English classification string psych_eval.py
// returns (it has no i18n layer, so that value itself never changes) -
// SUPPORTIVE_INFO_KEY for the matching supportive paragraph, and
// CLASSIFICATION_LABEL_KEY (used below) purely for how the classification
// itself is DISPLAYED, same pattern as Nutrition's status labels.
const SUPPORTIVE_INFO_KEY = {
  "Low probability": "wellness.supportiveLowProbability",
  "Possible depression": "wellness.supportivePossible",
  "Probable depression": "wellness.supportiveProbable",
  "High symptom burden": "wellness.supportiveHigh",
};
const CLASSIFICATION_LABEL_KEY = {
  "Low probability": "wellness.classificationLow",
  "Possible depression": "wellness.classificationPossible",
  "Probable depression": "wellness.classificationProbable",
  "High symptom burden": "wellness.classificationHigh",
};

export default function MentalWellnessPage() {
  const { t } = useLang();
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
      setError(t("wellness.answerAllError"));
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
      setError(err.message || t("wellness.scoreError"));
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
              {t("wellness.lastCheck")} <strong>{t(CLASSIFICATION_LABEL_KEY[savedEpds.result.classification]) || savedEpds.result.classification}</strong>{" "}
              ({daysSince} {daysSince === 1 ? t("wellness.dayAgo") : t("wellness.daysAgo")})
            </p>
            {followUpDue && <Pill tone="warning">{t("wellness.followUpDue")}</Pill>}
          </div>
          {followUpDue && (
            <p className="mt-1.5 text-sm text-warning">
              {t("wellness.followUpNotePrefix")} {daysSince} {t("wellness.followUpNoteMiddle")}{" "}
              {(t(CLASSIFICATION_LABEL_KEY[savedEpds.result.classification]) || savedEpds.result.classification).toLowerCase()}{" "}
              {t("wellness.followUpNoteSuffix")}
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
              <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{t("wellness.teleManasLabel")}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("wellness.teleManasDesc")}</div>
            </div>
            <a href="tel:14416" className="btn btn-secondary btn-icon" aria-label={t("wellness.call")}><i className="ph ph-phone" /></a>
          </div>
        </div>
      </div>

      <Card>
        <h1 className="text-xl font-bold text-ink">{t("wellness.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("wellness.subtitle")}</p>

        {!items ? (
          <Spinner className="mt-4" />
        ) : (
          <QuestionFlow
            questions={items.items.map((text, i) => ({ id: i, text, options: items.options[i] }))}
            responses={responses}
            onAnswer={(id, value) => setResponses((r) => ({ ...r, [id]: value }))}
            onComplete={handleSubmit}
            submitLabel={t("wellness.scoreMyMood")}
            busy={busy}
            error={error}
          />
        )}
      </Card>

      {result && (
        <Card>
          <h3 className="mb-3 text-sm font-bold text-ink">{t("wellness.yourResult")}</h3>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-ink">{result.total}</span>
            <span className="text-sm text-muted">/ {result.maxScore}</span>
          </div>
          <p className="mb-3 text-sm font-semibold text-ink">{t(CLASSIFICATION_LABEL_KEY[result.classification]) || result.classification}</p>

          {result.selfHarmFlagged && (
            <div className="mb-3 rounded-md border border-critical/40 bg-critical-soft p-3 text-sm text-critical">
              🚨 {t("wellness.selfHarmIndicated")} ("{result.selfHarmSeverityLabel}"). {t("wellness.selfHarmPleaseTalk")}
              <br />
              <a href="tel:1800-599-0019" className="mt-2 inline-block rounded-full bg-critical px-4 py-2 text-sm font-bold text-white">
                📞 {t("wellness.callKiran")}
              </a>
            </div>
          )}

          {SUPPORTIVE_INFO_KEY[result.classification] && (
            <p className="mb-2 text-sm text-warning">💛 {t(SUPPORTIVE_INFO_KEY[result.classification])}</p>
          )}

          {result.anxietySubscale?.flagged && (
            <p className="mb-2 text-sm text-warning">
              💛 {t("wellness.anxietyAlso")}{" "}
              {result.classification === "Low probability" ? t("wellness.anxietyLowScore") : t("wellness.anxietyAlongside")}{" "}
              {t("wellness.anxietySuffix")}
            </p>
          )}

          {!result.selfHarmFlagged && result.classification !== "Low probability" && (
            <p className="mb-2 text-xs text-faint">{t("wellness.followUpSuggestion")}</p>
          )}

          <p className="text-xs text-faint">{result.methodology}</p>
        </Card>
      )}
    </div>
  );
}
