import { useState } from "react";
import { Link } from "react-router-dom";
import ReadAloudButton from "../ui/ReadAloudButton";
import { useLang } from "../../context/LangContext";

const LEVEL_COLOR = {
  Critical: "var(--color-critical)", Severe: "var(--color-critical)",
  Moderate: "var(--color-warning)", Mild: "var(--color-good)", Minimal: "var(--color-good)",
};
const LEVEL_TINT = {
  Critical: "var(--color-critical-soft)", Severe: "var(--color-critical-soft)",
  Moderate: "var(--color-warning-soft)", Mild: "var(--color-good-soft)", Minimal: "var(--color-good-soft)",
};
const LEVEL_ICON = {
  Critical: "ph-warning", Severe: "ph-warning",
  Moderate: "ph-warning-circle", Mild: "ph-check-circle", Minimal: "ph-check-circle",
};

function Section({ title, icon, action, children }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>
          {icon && <i className={`ph ${icon}`} style={{ color: "var(--color-accent-400)" }} />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function TagGroup({ label, items, color }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <p className="eyebrow">{label}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map((item) => (
          <span
            key={item}
            style={{
              borderRadius: 99, border: `1px solid ${color || "var(--color-neutral-700)"}`,
              color: color || "var(--color-neutral-400)", padding: "4px 10px", fontSize: "0.75rem",
            }}
          >
            {item.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Results({ data, onReset }) {
  const { t } = useLang();
  const [showDetails, setShowDetails] = useState(false);
  const {
    severity, mri, clinicalExplanation: exp, mlPrediction: ml, dangerLadder: ladder,
    riskFormulation: rf, hemoglobinAssessment: hb, psychologicalEvaluation: psych,
    weightAssessment: weight, fetalMovementAssessment: fetal, fundalHeightAssessment: fundal,
    urineProteinAssessment: urineProtein, bmiAssessment: bmi,
    recommendations,
  } = data;

  const color = LEVEL_COLOR[severity.level] || "var(--color-neutral-400)";
  const tint = LEVEL_TINT[severity.level] || "var(--color-neutral-800)";
  const icon = LEVEL_ICON[severity.level] || "ph-info";
  const isHigh = severity.level === "Critical" || severity.level === "Severe";

  // The clinical content read aloud here (recommendedNextAction,
  // whyThisResult, recommendations below) comes straight from the Python
  // triage engine, which has no i18n layer of its own - only the static
  // page chrome around it is translated in this pass. Read aloud always
  // speaks it in the language it was generated in (English).
  const whyText = [
    `${t("results.yourResult")} ${severity.level}.`,
    exp?.recommendedNextAction,
    ...(exp?.whyThisResult || []),
  ].filter(Boolean).join(" ");

  const nextStepsText = recommendations?.length ? recommendations.join(". ") : "";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* A. Your Status */}
      <div style={{ background: tint, borderRadius: 14, padding: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 48, height: 48, borderRadius: "50%", border: `1px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <i className={`ph ${icon}`} style={{ fontSize: "1.75rem", color }} />
          </span>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>{t("results.overallRisk")}</p>
            <div style={{ fontSize: "1.875rem", fontWeight: 500, color: "var(--color-text)", lineHeight: 1.1 }}>{severity.level}</div>
            <div style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>
              {t("results.mriLabel")} {mri}
              {severity.escalatedBy ? ` · ${t("results.escalatedBy")} ${severity.escalatedBy.replace(/_/g, " ")}` : ""}
            </div>
            {exp?.actionTierLabel && (
              <span style={{ display: "inline-flex", marginTop: 8, borderRadius: 99, border: `1px solid ${color}`, color, padding: "3px 10px", fontSize: "0.75rem" }}>
                {exp.actionTierLabel}
              </span>
            )}
          </div>
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{t("results.combinesNote")}</p>
        <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{t("results.screeningNote")}</p>
        {isHigh && (
          <a href="tel:108" className="jd-call108-fill" style={{ textDecoration: "none" }}>
            <i className="ph ph-phone-call" /> {t("results.call108Ambulance")}
          </a>
        )}
      </div>

      {/* B. Why This Result */}
      <Section title={t("results.whyThisResult")} icon="ph-compass" action={<ReadAloudButton text={whyText} />}>
        {exp?.recommendedNextAction && <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text)" }}>{exp.recommendedNextAction}</p>}
        {exp?.whyThisResult?.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {exp.whyThisResult.map((w, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: "0.875rem", lineHeight: 1.45, color: "var(--color-text)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, marginTop: 7, flex: "none" }} />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        <TagGroup label={t("results.warningSigns")} items={exp?.warningSigns} color="var(--color-critical)" />
        {exp?.disclaimer && <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{exp.disclaimer}</p>}
      </Section>

      {/* C. Protective Factors */}
      {rf?.protectiveFactors?.length > 0 && (
        <Section title={t("results.workingInFavour")} icon="ph-check-circle">
          <TagGroup items={rf.protectiveFactors} color="var(--color-good)" />
        </Section>
      )}

      {/* D. What To Do Next */}
      {recommendations?.length > 0 && (
        <Section title={t("results.whatToDoNext")} icon="ph-clipboard-text" action={<ReadAloudButton text={nextStepsText} />}>
          <div style={{ display: "grid", gap: 8 }}>
            {recommendations.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: "0.875rem", lineHeight: 1.45, color: "var(--color-text)" }}>
                <i className="ph ph-check" style={{ color: "var(--color-accent-400)", marginTop: 3, flex: "none" }} />
                <span>{r}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* E. Detailed Results */}
      <button type="button" onClick={() => setShowDetails((s) => !s)} className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
        <i className={`ph ${showDetails ? "ph-caret-up" : "ph-caret-down"}`} />
        {showDetails ? t("results.hideDetails") : t("results.showDetails")}
      </button>

      {showDetails && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
          <Section title={t("results.riskGauge")}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>{mri}</span>
              <span style={{ fontSize: "0.875rem", color: "var(--color-neutral-500)" }}>/ 100</span>
            </div>
            <div style={{ height: 10, width: "100%", overflow: "hidden", borderRadius: 99, background: "var(--color-neutral-800)" }}>
              <div style={{ height: "100%", borderRadius: 99, width: `${Math.min(mri, 100)}%`, background: mri >= 60 ? "var(--color-critical)" : mri >= 40 ? "var(--color-warning)" : "var(--color-good)" }} />
            </div>
          </Section>

          {ml && (
            <Section title={t("results.aiRiskEstimate")}>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)", marginTop: -4 }}>{ml.modelName?.replace(/_/g, " ")}</p>
              <div style={{ display: "grid", gap: 6 }}>
                {Object.entries(ml.probabilities).map(([label, prob]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.75rem" }}>
                    <span style={{ width: 64, flex: "none", color: "var(--color-neutral-400)" }}>{label}</span>
                    <div style={{ height: 8, flex: 1, overflow: "hidden", borderRadius: 99, background: "var(--color-neutral-800)" }}>
                      <div style={{ height: "100%", borderRadius: 99, width: `${prob * 100}%`, background: "var(--color-accent)" }} />
                    </div>
                    <span style={{ width: 40, flex: "none", textAlign: "right", color: "var(--color-neutral-500)" }}>{Math.round(prob * 100)}%</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{t("results.aiDisclaimer")}</p>
            </Section>
          )}

          <Section title={t("results.dangerLadder")}>
            {ladder?.rung > 0 ? (
              <>
                <span style={{ display: "inline-flex", alignSelf: "start", borderRadius: 99, border: `1px solid ${ladder.rung >= 4 ? "var(--color-critical)" : ladder.rung >= 3 ? "var(--color-warning)" : "var(--color-neutral-600)"}`, color: ladder.rung >= 4 ? "var(--color-critical)" : ladder.rung >= 3 ? "var(--color-warning)" : "var(--color-neutral-400)", padding: "3px 10px", fontSize: "0.75rem" }}>
                  {t("results.rungPrefix")} {ladder.rung} — {ladder.rungLabel}
                </span>
                <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>{ladder.description}</p>
              </>
            ) : (
              <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("results.noDangerSign")}</p>
            )}
          </Section>

          {rf && (
            <Section title={`${t("results.riskFactors")} (×${rf.multiplier?.toFixed(2)})`}>
              <TagGroup label={t("results.staticFactors")} items={rf.staticRiskFactors} />
              <TagGroup label={t("results.dynamicFactors")} items={rf.dynamicRiskFactors} color="var(--color-warning)" />
            </Section>
          )}

          {hb && (
            <Section title={t("results.anemiaGrading")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}><strong>{hb.grade}</strong> ({hb.hemoglobin} g/dL)</p>
              <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{hb.methodology}</p>
            </Section>
          )}

          {psych && (
            <Section title={t("results.psychEval")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}><strong>{psych.classification}</strong> ({psych.total}/{psych.maxScore})</p>
              {psych.selfHarmFlagged && (
                <div style={{ borderRadius: 10, border: "1px solid var(--color-critical)", background: "var(--color-critical-soft)", padding: 10, fontSize: "0.875rem", color: "var(--color-text)" }}>
                  <i className="ph ph-warning" /> {t("results.selfHarmFlagged")} ({psych.selfHarmSeverityLabel}) — {t("results.pleaseReachOut")}.{" "}
                  <a href="tel:1800-599-0019" style={{ fontWeight: 600, textDecoration: "underline", color: "var(--color-critical)" }}>{t("results.callKiran")}</a>
                </div>
              )}
              {psych.anxietySubscale?.flagged && (
                <p style={{ fontSize: "0.75rem", color: "var(--color-warning)" }}>{t("results.anxietyFlagged")}</p>
              )}
            </Section>
          )}

          {weight && (
            <Section title={t("results.weightCheck")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
                <strong>{weight.status}</strong>{weight.diffKg != null ? ` (${weight.diffKg > 0 ? "+" : ""}${weight.diffKg} kg since last check)` : ""}
              </p>
              {weight.flag && <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{weight.flag}</p>}
            </Section>
          )}

          {fetal && (
            <Section title={t("results.fetalMovementCheck")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}><strong>{fetal.status}</strong></p>
              {fetal.flag && <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{fetal.flag}</p>}
            </Section>
          )}

          {fundal && (
            <Section title={t("results.fundalHeightCheck")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}><strong>{fundal.status}</strong></p>
              {fundal.flag && <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{fundal.flag}</p>}
            </Section>
          )}

          {urineProtein && (
            <Section title={t("results.urineProteinCheck")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}><strong>{urineProtein.status}</strong> ({urineProtein.reading})</p>
              {urineProtein.flag && <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{urineProtein.flag}</p>}
            </Section>
          )}

          {bmi && (
            <Section title={t("results.bmiCheck")}>
              <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}><strong>{bmi.category}</strong> ({bmi.bmi})</p>
              {bmi.flag && <p style={{ fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{bmi.flag}</p>}
            </Section>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        <button type="button" onClick={onReset} className="btn btn-ghost">
          <i className="ph ph-arrow-left" /> {t("results.runAnother")}
        </button>
        <Link to="/referral" style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-accent-400)", textDecoration: "none" }}>
          <i className="ph ph-file-text" /> {t("results.generateReferral")}
        </Link>
      </div>
    </div>
  );
}
