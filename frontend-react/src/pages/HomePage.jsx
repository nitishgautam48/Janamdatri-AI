import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Pill from "../components/ui/Pill";
import PregnancyTimeline from "../components/ui/PregnancyTimeline";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import { useHistory } from "../lib/useHistory";
import {
  KEYS, scopedGet, loadSavedEpds,
  lastKnownVitals, lastKnownHemoglobinAssessment, lastKnownWeightAssessment,
  loadTodayCareState, saveTodayCareState,
} from "../lib/storage";
import { buildTodayCareTasks } from "../lib/todayCare";

const TIPS_EN = [
  "Take your iron/folic acid tablet at the same time every day — it's easier to remember with a meal.",
  "Drink plenty of water and eat fibre-rich foods to help with pregnancy constipation.",
  "Kick counts matter — get to know your baby's usual movement pattern so you notice if it changes.",
  "Rest on your left side when lying down — it improves blood flow to the baby.",
  "Never skip an ANC visit, even if you're feeling fine — many risks show no symptoms early on.",
];

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

function riskPillTone(level) {
  if (level === "Critical" || level === "Severe") return { tone: "critical", label: "🔴 High" };
  if (level === "Moderate") return { tone: "warning", label: "🟡 Moderate" };
  if (level === "Mild" || level === "Minimal") return { tone: "good", label: "🟢 Low" };
  return { tone: "neutral", label: "—" };
}

function SnapshotCard({ label, icon, value, unit, tone, statusLabel, subtext, emptyHint, to }) {
  return (
    <Card className="!p-4">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="eyebrow">{icon} {label}</p>
        {tone && <Pill tone={tone} className="!px-2 !py-0.5 text-[10px]">{statusLabel}</Pill>}
      </div>
      {value != null ? (
        <>
          <p className="text-2xl font-extrabold text-ink">
            {value}
            {unit && <span className="ml-1 text-sm font-medium text-muted">{unit}</span>}
          </p>
          {subtext && <p className="mt-1 text-xs text-faint">{subtext}</p>}
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-muted">Not available yet</p>
          <Link to={to} className="mt-1 inline-block text-xs text-primary hover:underline">{emptyHint} →</Link>
        </>
      )}
    </Card>
  );
}

function TodayCare({ history }) {
  const [state, setState] = useState(() => loadTodayCareState());
  const tasks = useMemo(() => buildTodayCareTasks(history), [history]);

  function toggle(id) {
    const next = { ...state, checked: { ...state.checked, [id]: !state.checked[id] }, date: state.date };
    setState(next);
    saveTodayCareState(next);
  }

  const doneCount = tasks.filter((t) => (t.manual ? !!state.checked[t.id] : !!t.done)).length;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">Today's Care</p>
        <span className="text-xs font-semibold text-muted">{doneCount}/{tasks.length}</span>
      </div>
      <div className="space-y-2">
        {tasks.map((t) => {
          const checked = t.manual ? !!state.checked[t.id] : !!t.done;
          return (
            <label
              key={t.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                checked ? "bg-good-soft text-muted" : "hover:bg-surface-hover text-ink"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!t.manual}
                onChange={() => t.manual && toggle(t.id)}
                className="mt-0.5"
              />
              <span className={checked ? "line-through" : ""}>{t.text}</span>
            </label>
          );
        })}
      </div>
    </Card>
  );
}

export default function HomePage() {
  const { user, identityKey } = useAuth();
  const { t } = useLang();
  const { history, loading } = useHistory();
  const [guide, setGuide] = useState(null);
  const [postpartumGuide, setPostpartumGuide] = useState(null);

  useEffect(() => {
    setGuide(scopedGet(KEYS.GUIDE));
    setPostpartumGuide(scopedGet(KEYS.POSTPARTUM_GUIDE));
  }, [identityKey]);

  const isPostpartum = !!(postpartumGuide && postpartumGuide.isWithin6Weeks);
  const latest = history[0];
  const risk = latest ? riskPillTone(latest.severityLevel) : { tone: "neutral", label: t("home.noData") };
  const assessSelfHarm = !!latest?.result?.psychologicalEvaluation?.selfHarmFlagged;
  const savedEpds = loadSavedEpds();
  const standaloneSelfHarm = !!savedEpds?.result?.selfHarmFlagged;
  const isDanger = !!(latest && (latest.severityLevel === "Critical" || latest.severityLevel === "Severe"));
  const selfHarm = assessSelfHarm || standaloneSelfHarm;

  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? "home.greetingMorning" : hour < 17 ? "home.greetingAfternoon" : "home.greetingEvening";
  const name = user ? user.name || user.email.split("@")[0] : "";
  const tip = useMemo(() => TIPS_EN[dayOfYear() % TIPS_EN.length], []);

  const progressPct = isPostpartum
    ? Math.min((postpartumGuide.daysPostpartum / 42) * 100, 100)
    : guide
    ? Math.min((guide.week / 40) * 100, 100)
    : 0;

  const vitals = lastKnownVitals();
  const hb = lastKnownHemoglobinAssessment();
  const weight = lastKnownWeightAssessment();
  const bpHigh = vitals && (vitals.SystolicBP >= 140 || vitals.DiastolicBP >= 90);
  const bsHigh = vitals && vitals.BS >= 7.8;
  const hbTone = hb ? (hb.grade === "Normal" ? "good" : hb.grade?.startsWith("Severe") ? "critical" : "warning") : null;

  // Nothing set up anywhere yet - a completely fresh guest or new account,
  // not just someone who hasn't run an assessment today.
  const isFirstTimeUser = !guide && !isPostpartum && !latest && !scopedGet(KEYS.NUTRITION) && !savedEpds;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-2">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {t(greetingKey)}
          {name ? `, ${name}` : ""} 👋
        </h1>
        {isPostpartum ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted">
              <span>Day {postpartumGuide.daysPostpartum} postpartum</span>
              <span>6 weeks</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : guide ? (
          <div className="mt-4">
            <PregnancyTimeline week={guide.week} />
          </div>
        ) : null}
      </div>

      {isFirstTimeUser && (
        <Card className="border-primary/30 bg-primary-soft">
          <p className="eyebrow mb-1 text-primary">Get Started</p>
          <p className="mb-3 text-sm text-ink">Three things to set up so this dashboard can actually work for you:</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Link to="/profile" className="rounded-md border border-primary/30 bg-surface px-3.5 py-3 text-sm font-semibold text-ink hover:border-primary">
              1. Set up your Pregnancy Profile
            </Link>
            <Link to="/assess" className="rounded-md border border-primary/30 bg-surface px-3.5 py-3 text-sm font-semibold text-ink hover:border-primary">
              2. Run your first Assessment
            </Link>
            <Link to="/nutrition" className="rounded-md border border-primary/30 bg-surface px-3.5 py-3 text-sm font-semibold text-ink hover:border-primary">
              3. Check your Nutrition
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted">You can also tap the ✨ chat bubble anytime to ask Janamdatri a quick question.</p>
        </Card>
      )}

      {/* A. Health Status Hero Card - the one thing to look at first. */}
      <Card className={isDanger ? "border-critical/40 bg-critical-soft" : ""}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">AI-Assisted Risk Estimate</p>
            <Pill tone={risk.tone} className="text-sm">{risk.label}</Pill>
            {latest ? (
              <p className="mt-2 text-sm text-muted">
                Last checked {new Date(latest.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {latest.result?.severity?.escalatedBy ? ` · main reason: ${latest.result.severity.escalatedBy.replace(/_/g, " ")}` : ""}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">No assessment yet — run one to see your status here.</p>
            )}
            <p className="mt-2 text-xs text-faint">An AI-assisted estimate to guide you, not a medical diagnosis.</p>
          </div>
          <Link
            to="/assess"
            className="whitespace-nowrap rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-paper-ink hover:bg-primary-dark"
          >
            {latest ? "View Full Assessment →" : "Run your first Assessment →"}
          </Link>
        </div>
      </Card>

      {/* B. Health Snapshot - BP / Hb / Blood Sugar / Weight, each reused
          from the same clinical data the Assessment and ML model already
          use, never invented here. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SnapshotCard
          label="Blood Pressure" icon="🩸"
          value={vitals ? `${vitals.SystolicBP}/${vitals.DiastolicBP}` : null}
          tone={vitals ? (bpHigh ? "critical" : "good") : null}
          statusLabel={bpHigh ? "High" : "Normal"}
          subtext={vitals ? new Date(vitals.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null}
          emptyHint="Record vitals" to="/assess"
        />
        <SnapshotCard
          label="Hemoglobin" icon="🩹"
          value={hb ? hb.hemoglobin : null} unit="g/dL"
          tone={hbTone}
          statusLabel={hb?.grade}
          subtext={hb ? new Date(hb.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null}
          emptyHint="Add Hb reading" to="/assess"
        />
        <SnapshotCard
          label="Blood Sugar" icon="🍬"
          value={vitals ? vitals.BS : null} unit="mmol/L"
          tone={vitals ? (bsHigh ? "critical" : "good") : null}
          statusLabel={bsHigh ? "High" : "Normal"}
          subtext={vitals ? new Date(vitals.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null}
          emptyHint="Record vitals" to="/assess"
        />
        <SnapshotCard
          label="Weight" icon="⚖️"
          value={weight ? weight.valueKg : null} unit="kg"
          tone={weight?.status ? (/tracking normally/i.test(weight.status) ? "good" : "warning") : null}
          statusLabel={weight?.status}
          subtext={weight ? new Date(weight.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null}
          emptyHint="Add weight check" to="/assess"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TodayCare history={history} />

        {/* C/D. Urgent Alerts - the on-page detail behind the sticky
            cross-app banner (GlobalEmergencyBanner), with clear actions. */}
        <Card className={isDanger || selfHarm ? "border-critical/40 bg-critical-soft" : ""}>
          <p className="eyebrow mb-2">{t("home.urgentAlerts")}</p>
          {isDanger || selfHarm ? (
            <>
              <p className="text-sm font-semibold text-ink">
                {selfHarm
                  ? "🚨 A Mental Health Check flagged thoughts of self-harm — please reach out now."
                  : `🚨 Your last assessment (${latest.severityLevel}) flagged something that needs prompt attention.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="tel:108" className="rounded-full bg-critical px-4 py-2 text-sm font-bold text-white">
                  🚨 Call 108
                </a>
                {selfHarm && (
                  <a href="tel:1800-599-0019" className="rounded-full bg-critical px-4 py-2 text-sm font-bold text-white">
                    KIRAN 1800-599-0019
                  </a>
                )}
                <Link to="/help" className="rounded-full border border-border-strong px-4 py-2 text-sm font-semibold text-ink">
                  View Helplines
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-good">✓ {t("home.noAlerts")}</p>
              <Link to="/guide" className="mt-2 inline-block text-sm text-primary hover:underline">
                {t("home.viewWarningSigns")}
              </Link>
            </>
          )}
        </Card>
      </div>

      <Card>
        <p className="eyebrow mb-2">{t("home.tipOfDay")}</p>
        <p className="text-sm leading-relaxed text-ink">{tip}</p>
      </Card>

      {loading && <p className="text-xs text-faint">Loading your history…</p>}
    </div>
  );
}
