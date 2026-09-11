import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Pill from "../components/ui/Pill";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import { useHistory } from "../lib/useHistory";
import { KEYS, scopedGet } from "../lib/storage";

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
  if (level === "Critical" || level === "Severe") return { tone: "critical", label: "🔴 HIGH" };
  if (level === "Moderate") return { tone: "warning", label: "🟡 MODERATE" };
  if (level === "Mild" || level === "Minimal") return { tone: "good", label: "🟢 LOW" };
  return { tone: "neutral", label: "—" };
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
  const isDanger = latest && (latest.severityLevel === "Critical" || latest.severityLevel === "Severe");
  const selfHarm = !!(latest && latest.result?.psychologicalEvaluation?.selfHarmFlagged);

  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? "home.greetingMorning" : hour < 17 ? "home.greetingAfternoon" : "home.greetingEvening";
  const name = user ? user.name || user.email.split("@")[0] : "";
  const tip = useMemo(() => TIPS_EN[dayOfYear() % TIPS_EN.length], []);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-2">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">
          {t(greetingKey)}
          {name ? `, ${name}` : ""} 👋
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="eyebrow mb-2">{isPostpartum ? "Postpartum" : "Pregnancy"}</p>
          {isPostpartum ? (
            <>
              <p className="text-3xl font-extrabold text-ink">Day {postpartumGuide.daysPostpartum}</p>
              <p className="mt-1 text-sm text-muted">Week {postpartumGuide.weeksPostpartum} postpartum</p>
            </>
          ) : guide ? (
            <>
              <p className="text-3xl font-extrabold text-ink">{guide.week} weeks</p>
              <p className="mt-1 text-sm text-muted">{["", "1st", "2nd", "3rd"][guide.trimester]} trimester</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-ink">{t("home.weekNotSet")}</p>
              <Link to="/profile" className="mt-2 inline-block text-sm text-primary hover:underline">
                Set it in your profile →
              </Link>
            </>
          )}
        </Card>

        <Card>
          <p className="eyebrow mb-2">Latest Risk Level</p>
          <Pill tone={risk.tone} className="text-sm">
            {risk.label}
          </Pill>
          {loading && <p className="mt-2 text-xs text-faint">Loading…</p>}
          {!loading && !latest && (
            <p className="mt-2 text-sm text-muted">
              <Link to="/assess" className="text-primary hover:underline">
                Run your first Assessment →
              </Link>
            </p>
          )}
        </Card>
      </div>

      <Card className={isDanger || selfHarm ? "border-critical/40 bg-critical-soft" : ""}>
        <p className="eyebrow mb-2">{t("home.urgentAlerts")}</p>
        {isDanger || selfHarm ? (
          <>
            <p className="text-sm font-semibold text-ink">
              🚨 Your last assessment ({latest.severityLevel}) flagged something that needs prompt attention.
            </p>
            <div className="mt-3 flex gap-2">
              <a href="tel:108" className="rounded-full bg-critical px-4 py-2 text-sm font-bold text-white">
                🚨 Call 108
              </a>
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

      <Card>
        <p className="eyebrow mb-2">{t("home.tipOfDay")}</p>
        <p className="text-sm leading-relaxed text-ink">{tip}</p>
      </Card>
    </div>
  );
}
