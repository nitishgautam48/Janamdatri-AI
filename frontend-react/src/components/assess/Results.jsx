import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "../ui/Card";
import Pill from "../ui/Pill";
import Button from "../ui/Button";
import ReadAloudButton from "../ui/ReadAloudButton";

const LEVEL_TONE = { Critical: "critical", Severe: "critical", Moderate: "warning", Mild: "good", Minimal: "good" };

function TagGroup({ label, items, className = "" }) {
  if (!items || !items.length) return null;
  return (
    <div className="mb-3">
      <p className="eyebrow mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className={`rounded-full border px-2.5 py-1 text-xs ${className || "border-border-strong text-muted"}`}>
            {item.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Results({ data, onReset }) {
  const [showDetails, setShowDetails] = useState(false);
  const {
    severity, mri, clinicalExplanation: exp, mlPrediction: ml, dangerLadder: ladder,
    riskFormulation: rf, hemoglobinAssessment: hb, psychologicalEvaluation: psych,
    weightAssessment: weight, fetalMovementAssessment: fetal, fundalHeightAssessment: fundal,
    recommendations,
  } = data;

  const tone = LEVEL_TONE[severity.level] || "neutral";

  const whyText = [
    `Your result: ${severity.level}.`,
    exp?.recommendedNextAction,
    ...(exp?.whyThisResult || []),
  ].filter(Boolean).join(" ");

  const nextStepsText = recommendations?.length ? recommendations.join(". ") : "";

  return (
    <div className="space-y-5">
      {/* A. Your Status */}
      <Card className={tone === "critical" ? "border-critical/40 bg-critical-soft" : tone === "warning" ? "border-warning/40 bg-warning-soft" : "border-good/30"}>
        <div className="flex items-center gap-4">
          <span className="text-4xl">{severity.emoji}</span>
          <div>
            <p className="eyebrow mb-1">AI-Assisted Risk Estimate</p>
            <div className="text-2xl font-extrabold text-ink">{severity.level}</div>
            <div className="text-sm text-muted">
              Maternal Risk Index: {mri}
              {severity.escalatedBy ? ` · escalated by: ${severity.escalatedBy.replace(/_/g, " ")}` : ""}
            </div>
            {exp?.actionTierLabel && <Pill tone={tone} className="mt-2">{exp.actionTierLabel}</Pill>}
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">
          This is an AI-assisted estimate to guide you toward the right next step - it is not a medical diagnosis. High-risk
          or emergency signs should always be checked by a healthcare professional.
        </p>
      </Card>

      {/* B. Why This Result */}
      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-ink">🧭 Why This Result</h3>
          <ReadAloudButton text={whyText} />
        </div>
        {exp?.recommendedNextAction && <p className="mb-3 text-sm font-medium text-ink">{exp.recommendedNextAction}</p>}
        {exp?.whyThisResult?.length > 0 && (
          <ul className="mb-3 list-inside list-disc space-y-1 text-sm text-ink">
            {exp.whyThisResult.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <TagGroup label="Warning Signs" items={exp?.warningSigns} className="border-critical/30 text-critical" />
        {exp?.disclaimer && <p className="mt-2 text-xs text-faint">{exp.disclaimer}</p>}
      </Card>

      {/* C. Protective Factors - what's already working in your favour,
          not buried inside the detailed risk-factors breakdown. */}
      {rf?.protectiveFactors?.length > 0 && (
        <Card className="border-good/30 bg-good-soft">
          <h3 className="mb-2 text-sm font-bold text-ink">✓ What's Working In Your Favour</h3>
          <div className="flex flex-wrap gap-1.5">
            {rf.protectiveFactors.map((item) => (
              <span key={item} className="rounded-full border border-good/40 px-2.5 py-1 text-xs text-good">
                {item.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* D. What To Do Next */}
      {recommendations?.length > 0 && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">📋 What To Do Next</h3>
            <ReadAloudButton text={nextStepsText} />
          </div>
          <ul className="list-inside list-disc space-y-1.5 text-sm text-ink">
            {recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </Card>
      )}

      {/* E. Detailed Results - the full breakdown, collapsed by default so
          the status/why/next-step hierarchy above is what people actually
          read first. */}
      <div>
        <Button variant="ghost" onClick={() => setShowDetails((s) => !s)} className="w-full justify-center">
          {showDetails ? "▲ Hide Detailed Results" : "▼ Show Detailed Results"}
        </Button>
      </div>

      {showDetails && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="eyebrow mb-2">Risk Gauge</p>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-ink">{mri}</span>
              <span className="text-sm text-muted">/ 100</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className={`h-full rounded-full ${mri >= 80 ? "bg-critical" : mri >= 60 ? "bg-critical/70" : mri >= 40 ? "bg-warning" : "bg-good"}`}
                style={{ width: `${Math.min(mri, 100)}%` }}
              />
            </div>
          </Card>

          {ml && (
            <Card>
              <p className="eyebrow mb-2">
                AI-Assisted Risk Estimate <span className="text-faint">({ml.modelName?.replace(/_/g, " ")})</span>
              </p>
              <div className="space-y-1.5">
                {Object.entries(ml.probabilities).map(([label, prob]) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className="w-16 shrink-0 text-muted">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${prob * 100}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-faint">{Math.round(prob * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-faint">A statistical estimate from vitals alone - not a diagnosis.</p>
            </Card>
          )}

          <Card>
            <p className="eyebrow mb-2">Danger-Sign Ladder</p>
            {ladder?.rung > 0 ? (
              <>
                <Pill tone={ladder.rung >= 4 ? "critical" : ladder.rung >= 3 ? "warning" : "neutral"}>Rung {ladder.rung} — {ladder.rungLabel}</Pill>
                <p className="mt-2 text-xs text-muted">{ladder.description}</p>
              </>
            ) : (
              <p className="text-xs text-muted">No danger-sign phrase matched.</p>
            )}
          </Card>

          {rf && (
            <Card>
              <p className="eyebrow mb-2">Risk Factors <span className="text-faint">(×{rf.multiplier?.toFixed(2)})</span></p>
              <TagGroup label="Static" items={rf.staticRiskFactors} />
              <TagGroup label="Dynamic" items={rf.dynamicRiskFactors} className="border-warning/30 text-warning" />
            </Card>
          )}

          {hb && (
            <Card>
              <p className="eyebrow mb-2">Anemia Grading (India)</p>
              <p className="text-sm text-ink"><strong>{hb.grade}</strong> ({hb.hemoglobin} g/dL)</p>
              <p className="mt-1 text-xs text-faint">{hb.methodology}</p>
            </Card>
          )}

          {psych && (
            <Card>
              <p className="eyebrow mb-2">Psychological Evaluation (EPDS)</p>
              <p className="text-sm text-ink"><strong>{psych.classification}</strong> ({psych.total}/{psych.maxScore})</p>
              {psych.selfHarmFlagged && (
                <div className="mt-2 rounded-md border border-critical/40 bg-critical-soft p-2.5 text-sm text-critical">
                  🚨 Self-harm item flagged — please reach out now.{" "}
                  <a href="tel:1800-599-0019" className="font-semibold underline">Call KIRAN: 1800-599-0019</a>
                </div>
              )}
              {psych.anxietySubscale?.flagged && (
                <p className="mt-2 text-xs text-warning">💛 Anxiety subscale also flagged — worth mentioning to your ANC provider too.</p>
              )}
            </Card>
          )}

          {weight && (
            <Card>
              <p className="eyebrow mb-2">Weight Check</p>
              <p className="text-sm text-ink">
                <strong>{weight.status}</strong>{weight.diffKg != null ? ` (${weight.diffKg > 0 ? "+" : ""}${weight.diffKg} kg since last check)` : ""}
              </p>
              {weight.flag && <p className="mt-1 text-xs text-faint">{weight.flag}</p>}
            </Card>
          )}

          {fetal && (
            <Card>
              <p className="eyebrow mb-2">Fetal Movement Check</p>
              <p className="text-sm text-ink"><strong>{fetal.status}</strong></p>
              {fetal.flag && <p className="mt-1 text-xs text-faint">{fetal.flag}</p>}
            </Card>
          )}

          {fundal && (
            <Card>
              <p className="eyebrow mb-2">Fundal Height Check</p>
              <p className="text-sm text-ink"><strong>{fundal.status}</strong></p>
              {fundal.flag && <p className="mt-1 text-xs text-faint">{fundal.flag}</p>}
            </Card>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" onClick={onReset}>← Run another assessment</Button>
        <Link to="/referral" className="text-sm font-semibold text-primary hover:underline">
          📄 Generate Referral Summary →
        </Link>
      </div>
    </div>
  );
}
