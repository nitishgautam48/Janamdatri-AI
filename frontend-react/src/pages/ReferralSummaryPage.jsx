import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Pill from "../components/ui/Pill";
import { useAuth } from "../context/AuthContext";
import { useHistory } from "../lib/useHistory";
import {
  KEYS, scopedGet, loadSavedEpds,
  lastKnownVitals, lastKnownHemoglobinAssessment, lastKnownWeightAssessment,
} from "../lib/storage";

const LEVEL_TONE = { Critical: "critical", Severe: "critical", Moderate: "warning", Mild: "good", Minimal: "good" };

function Row({ label, value }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

// A printable snapshot for the person to hand to (or share with) a
// healthcare provider - built entirely from data already collected
// elsewhere in the app, never new medical content invented for this page.
export default function ReferralSummaryPage() {
  const { user } = useAuth();
  const { history, loading } = useHistory();
  const latest = history[0];

  const guide = scopedGet(KEYS.GUIDE);
  const postpartumGuide = scopedGet(KEYS.POSTPARTUM_GUIDE);
  const isPostpartum = !!(postpartumGuide && postpartumGuide.isWithin6Weeks);
  const profileExtra = scopedGet(KEYS.PROFILE_EXTRA);
  const savedEpds = loadSavedEpds();
  const vitals = lastKnownVitals();
  const hb = lastKnownHemoglobinAssessment();
  const weight = lastKnownWeightAssessment();

  const sev = latest?.result?.severity;
  const exp = latest?.result?.clinicalExplanation;
  const rf = latest?.result?.riskFormulation;
  const recommendations = latest?.result?.recommendations;
  const tone = sev ? LEVEL_TONE[sev.level] || "neutral" : "neutral";

  if (!loading && !latest) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <h1 className="text-xl font-bold text-ink">Referral Summary</h1>
          <p className="mt-2 text-sm text-muted">
            You'll need at least one assessment before a referral summary can be generated.
          </p>
          <Link to="/assess" className="mt-3 inline-block text-sm text-primary hover:underline">Run your first Assessment →</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3" data-print-hide>
        <div>
          <h1 className="text-xl font-bold text-ink">Referral Summary</h1>
          <p className="mt-1 text-sm text-muted">A one-page snapshot to share with a doctor, ASHA/ANM, or facility.</p>
        </div>
        <Button onClick={() => window.print()}>🖨️ Print / Save as PDF</Button>
      </div>

      <Card id="referral-summary-print">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div>
            <p className="text-lg font-extrabold text-ink">Janamdatri AI — Referral Summary</p>
            <p className="text-xs text-faint">Generated {new Date().toLocaleString()}</p>
          </div>
          <span className="text-3xl">🤰</span>
        </div>

        <p className="eyebrow mb-1.5">Patient</p>
        <Row label="Name" value={user ? user.name || user.email : "Guest (no account)"} />
        <Row label="Status" value={isPostpartum ? `Postpartum · Day ${postpartumGuide.daysPostpartum}` : guide ? `Pregnant · Week ${guide.week} (Trimester ${guide.trimester})` : "Pregnancy stage not set"} />
        {guide?.estimatedDueDate && <Row label="Estimated due date" value={guide.estimatedDueDate} />}
        {postpartumGuide?.deliveryDate && <Row label="Delivery date" value={postpartumGuide.deliveryDate} />}
        <Row label="Previous pregnancy" value={profileExtra?.previousPregnancy === "yes" ? "Yes" : "No / first pregnancy"} />
        <Row label="Existing conditions" value={profileExtra?.conditions} />
        <Row label="Current medications/supplements" value={profileExtra?.medications} />
        <Row label="ANC visits completed" value={profileExtra?.ancVisitsCompleted} />

        {sev && (
          <>
            <p className="eyebrow mb-1.5 mt-5">AI-Assisted Risk Estimate</p>
            <div className="flex items-center gap-2">
              <Pill tone={tone}>{sev.emoji} {sev.level}</Pill>
              <span className="text-sm text-muted">Maternal Risk Index: {latest.mri}</span>
            </div>
            {sev.escalatedBy && <p className="mt-1.5 text-sm text-ink">Main reason: {sev.escalatedBy.replace(/_/g, " ")}</p>}
            {exp?.recommendedNextAction && <p className="mt-1.5 text-sm font-medium text-ink">{exp.recommendedNextAction}</p>}
            <p className="mt-1.5 text-xs text-faint">Last assessed: {new Date(latest.timestamp).toLocaleString()}</p>
          </>
        )}

        {exp?.warningSigns?.length > 0 && (
          <>
            <p className="eyebrow mb-1.5 mt-5">Warning Signs Reported</p>
            <div className="flex flex-wrap gap-1.5">
              {exp.warningSigns.map((w) => (
                <span key={w} className="rounded-full border border-critical/30 px-2.5 py-1 text-xs text-critical">{w.replace(/_/g, " ")}</span>
              ))}
            </div>
          </>
        )}

        {rf?.staticRiskFactors?.length > 0 || rf?.dynamicRiskFactors?.length > 0 ? (
          <>
            <p className="eyebrow mb-1.5 mt-5">Risk Factors</p>
            <div className="flex flex-wrap gap-1.5">
              {[...(rf.staticRiskFactors || []), ...(rf.dynamicRiskFactors || [])].map((f) => (
                <span key={f} className="rounded-full border border-border-strong px-2.5 py-1 text-xs text-muted">{f.replace(/_/g, " ")}</span>
              ))}
            </div>
          </>
        ) : null}

        <p className="eyebrow mb-1.5 mt-5">Latest Vitals &amp; Checks</p>
        {vitals && (
          <Row
            label={`Vitals (${new Date(vitals.timestamp).toLocaleDateString()})`}
            value={`BP ${vitals.SystolicBP}/${vitals.DiastolicBP} mmHg · BS ${vitals.BS} mmol/L · Temp ${vitals.BodyTemp}°F · HR ${vitals.HeartRate} bpm`}
          />
        )}
        {hb && <Row label={`Hemoglobin (${new Date(hb.timestamp).toLocaleDateString()})`} value={`${hb.hemoglobin} g/dL — ${hb.grade}`} />}
        {weight && <Row label={`Weight (${new Date(weight.timestamp).toLocaleDateString()})`} value={`${weight.valueKg} kg${weight.status ? ` — ${weight.status}` : ""}`} />}
        {!vitals && !hb && !weight && <p className="text-sm text-muted">No vitals recorded yet.</p>}

        {savedEpds && (
          <>
            <p className="eyebrow mb-1.5 mt-5">Mental Health Check (EPDS)</p>
            <Row label={`Last check (${new Date(savedEpds.savedAt).toLocaleDateString()})`} value={`${savedEpds.result.total}/${savedEpds.result.maxScore} — ${savedEpds.result.classification}`} />
            {savedEpds.result.selfHarmFlagged && (
              <p className="mt-1 text-sm font-semibold text-critical">🚨 Self-harm item was flagged on this check.</p>
            )}
          </>
        )}

        {recommendations?.length > 0 && (
          <>
            <p className="eyebrow mb-1.5 mt-5">Recommended Next Steps</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink">
              {recommendations.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </>
        )}

        <p className="mt-6 border-t border-border pt-3 text-xs text-faint">
          This is an AI-assisted screening summary generated by Janamdatri AI, not a medical diagnosis. It is intended
          to support - not replace - assessment by a qualified healthcare professional. Any emergency or urgent
          result, or anything that feels sudden or severe, means seeking care now regardless of what this summary says.
        </p>
      </Card>
    </div>
  );
}
