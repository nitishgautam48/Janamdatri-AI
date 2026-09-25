import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Spinner from "../components/ui/Spinner";
import CriticalFollowUp from "../components/shared/CriticalFollowUp";
import { useAuth } from "../context/AuthContext";
import { useLang } from "../context/LangContext";
import { useHistory } from "../lib/useHistory";
import {
  KEYS, scopedGet, loadSavedEpds,
  lastKnownVitals, lastKnownHemoglobinAssessment, lastKnownWeightAssessment,
  loadTodayCareState, saveTodayCareState,
} from "../lib/storage";
import { buildTodayCareTasks } from "../lib/todayCare";
import { computeHealthTrends, renderTrendNote } from "../lib/trends";
import { severityLabel } from "../lib/severity";

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

const RISK_COLORS = {
  high: { c: "var(--color-critical)", text: "var(--color-critical)", tint: "var(--color-critical-soft)", icon: "ph-warning" },
  medium: { c: "var(--color-warning)", text: "var(--color-warning)", tint: "var(--color-warning-soft)", icon: "ph-warning-circle" },
  low: { c: "var(--color-good)", text: "var(--color-good)", tint: "var(--color-good-soft)", icon: "ph-check-circle" },
};

function riskBucket(level) {
  if (level === "Critical" || level === "Severe") return "high";
  if (level === "Moderate") return "medium";
  if (level === "Mild" || level === "Minimal") return "low";
  return null;
}

// A tile in the mockup's 4-up "today" grid: icon+label eyebrow, a big
// value, and a short sub caption - or, when there's no reading yet, the
// same shape with a prompt link instead of blocking on empty state.
function Tile({ icon, label, value, unit, sub, tone, emptyHint, to }) {
  const { t } = useLang();
  return (
    <Link
      to={to}
      style={{
        background: "var(--color-surface)",
        border: 0,
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 6,
        textAlign: "left",
        cursor: "pointer",
        boxShadow: "var(--shadow-sm)",
        minWidth: 0,
        textDecoration: "none",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-neutral-500)", fontSize: "0.75rem" }}>
        <i className={`ph ${icon}`} style={{ fontSize: "1rem", color: tone || "var(--color-accent-400)" }} />
        {label}
      </span>
      {value != null ? (
        <>
          <span style={{ fontSize: "1.25rem", fontWeight: 500, whiteSpace: "nowrap", color: "var(--color-text)" }}>
            {value}
            {unit && <span style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)", marginLeft: 4 }}>{unit}</span>}
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: "0.9375rem", color: "var(--color-neutral-400)" }}>{t("home.notRecorded")}</span>
          <span style={{ fontSize: "0.75rem", color: "var(--color-accent-400)" }}>{emptyHint} →</span>
        </>
      )}
    </Link>
  );
}

function TodayCare({ history }) {
  const { t } = useLang();
  const [state, setState] = useState(() => loadTodayCareState());
  const tasks = useMemo(() => buildTodayCareTasks(history), [history]);

  function toggle(id) {
    const next = { ...state, checked: { ...state.checked, [id]: !state.checked[id] }, date: state.date };
    setState(next);
    saveTodayCareState(next);
  }

  const doneCount = tasks.filter((t) => (t.manual ? !!state.checked[t.id] : !!t.done)).length;

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 10, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("home.todaysCare")}</span>
        <span style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{doneCount} / {tasks.length}</span>
      </div>
      {tasks.map((t) => {
        const checked = t.manual ? !!state.checked[t.id] : !!t.done;
        return (
          <label
            key={t.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              cursor: t.manual ? "pointer" : "default",
              fontSize: "0.875rem",
              color: checked ? "var(--color-neutral-500)" : "var(--color-text)",
              textDecoration: checked ? "line-through" : "none",
            }}
          >
            <input type="checkbox" checked={checked} disabled={!t.manual} onChange={() => t.manual && toggle(t.id)} style={{ marginTop: 3, accentColor: "var(--color-accent)" }} />
            <span>{t.text}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const { user, identityKey } = useAuth();
  const { t } = useLang();
  const { history, loading } = useHistory();
  const [guide, setGuide] = useState(null);
  const [postpartumGuide, setPostpartumGuide] = useState(null);
  const [extra, setExtra] = useState(null);

  useEffect(() => {
    setGuide(scopedGet(KEYS.GUIDE));
    setPostpartumGuide(scopedGet(KEYS.POSTPARTUM_GUIDE));
    setExtra(scopedGet(KEYS.PROFILE_EXTRA));
  }, [identityKey]);

  const isPostpartum = !!(postpartumGuide && postpartumGuide.isWithin6Weeks);
  const latest = history[0];
  const bucket = latest ? riskBucket(latest.severityLevel) : null;
  const assessSelfHarm = !!latest?.result?.psychologicalEvaluation?.selfHarmFlagged;
  const savedEpds = loadSavedEpds();
  const standaloneSelfHarm = !!savedEpds?.result?.selfHarmFlagged;
  const isDanger = !!(latest && (latest.severityLevel === "Critical" || latest.severityLevel === "Severe"));
  const selfHarm = assessSelfHarm || standaloneSelfHarm;

  // Most-urgent-first: a "Needs Attention" note (rising BP, declining Hb,
  // an escalated risk level) is worth surfacing here over a merely
  // "Improving" one, since this is the one line someone sees without going
  // looking for it.
  const trendNote = useMemo(() => {
    const { summaryNotes } = computeHealthTrends(history);
    if (!summaryNotes.length) return null;
    const note = summaryNotes.find((n) => n.labelKey === "trends.needsAttention") || summaryNotes[0];
    return renderTrendNote(t, note);
  }, [history, t]);

  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? "home.greetingMorning" : hour < 17 ? "home.greetingAfternoon" : "home.greetingEvening";
  const name = user ? user.name || user.email.split("@")[0] : "";
  const tip = useMemo(() => TIPS_EN[dayOfYear() % TIPS_EN.length], []);

  const weekPct = guide ? Math.min((guide.week / 40) * 100, 100) : 0;
  const ppPct = isPostpartum ? Math.min((postpartumGuide.daysPostpartum / 42) * 100, 100) : 0;

  const vitals = lastKnownVitals();
  const hb = lastKnownHemoglobinAssessment();
  const weight = lastKnownWeightAssessment();
  const bpHigh = vitals && (vitals.SystolicBP >= 140 || vitals.DiastolicBP >= 90);
  const bsHigh = vitals && vitals.BS >= 7.8;
  const hbCritical = hb?.grade?.startsWith("Severe");

  const isFirstTimeUser = !loading && !guide && !isPostpartum && !latest && !scopedGet(KEYS.NUTRITION) && !savedEpds;
  const hasAsha = !!(extra?.ashaName || extra?.ashaPhone);
  const waText = encodeURIComponent(
    `Hi ${extra?.ashaName || ""}, this is ${name || "your patient"} on Janamdatri AI. ${
      latest ? `My last check came back ${latest.severityLevel}.` : "I wanted to check in about my pregnancy."
    }`,
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </p>
        <div style={{ fontSize: "1.75rem", fontWeight: 500, letterSpacing: "-0.015em", color: "var(--color-text)" }}>
          {t(greetingKey)}
          {name ? `, ${name}` : ""} 👋
        </div>
      </div>

      {(isDanger || selfHarm) && (
        <div style={{ background: "var(--color-critical-soft)", border: "1px solid var(--color-critical)", borderRadius: 14, padding: 16, display: "grid", gap: 4 }}>
          <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>
            {selfHarm
              ? t("home.selfHarmAlert")
              : `${t("home.dangerAlertPrefix")}${severityLabel(t, latest.severityLevel)}${t("home.dangerAlertSuffix")}`}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            <a href="tel:108" className="btn" style={{ background: "var(--color-critical)", color: "#fff", borderColor: "var(--color-critical)" }}>
              <i className="ph ph-phone-call" /> {t("common.call108")}
            </a>
            {selfHarm && (
              <a href="tel:1800-599-0019" className="btn" style={{ background: "var(--color-critical)", color: "#fff", borderColor: "var(--color-critical)" }}>
                KIRAN 1800-599-0019
              </a>
            )}
            <Link to="/help" className="btn btn-secondary">{t("home.viewHelplines")}</Link>
          </div>
          {isDanger && <CriticalFollowUp assessmentTimestamp={latest.timestamp} severityLevel={latest.severityLevel} />}
        </div>
      )}

      {isFirstTimeUser && (
        <div style={{ background: "var(--color-accent-900)", border: "1px solid var(--color-accent-800)", borderRadius: 14, padding: 16, display: "grid", gap: 10 }}>
          <p className="eyebrow" style={{ color: "var(--color-accent-300)" }}>{t("home.getStarted")}</p>
          <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{t("home.getStartedIntro")}</p>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <Link to="/profile" className="btn btn-secondary" style={{ justifyContent: "flex-start", padding: 12 }}>{t("home.setupProfileStep")}</Link>
            <Link to="/assess" className="btn btn-secondary" style={{ justifyContent: "flex-start", padding: 12 }}>{t("home.runAssessmentStep")}</Link>
            <Link to="/nutrition" className="btn btn-secondary" style={{ justifyContent: "flex-start", padding: 12 }}>{t("home.checkNutritionStep")}</Link>
          </div>
        </div>
      )}

      {/* Hero split: week/day counter + progress on the left, start-check
          CTA + last-check chip on the right - Janamdatri App v2.dc.html
          lines 58-79. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 1, background: "var(--color-neutral-800)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ background: "var(--color-surface)", padding: 20, display: "grid", gap: 16, alignContent: "start" }}>
          {isPostpartum ? (
            <Link to="/postpartum" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", display: "grid", gap: 10, textDecoration: "none" }}>
              <span style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                <span style={{ fontSize: "3rem", fontWeight: 500, lineHeight: 0.9, letterSpacing: "-0.03em", color: "var(--color-text)" }}>{postpartumGuide.daysPostpartum}</span>
                <span style={{ flex: 1, fontSize: "0.8125rem", color: "var(--color-neutral-400)", lineHeight: 1.35 }}>{t("home.daysAfterBirth")}</span>
              </span>
              <span style={{ display: "block", height: 4, background: "var(--color-neutral-900)", borderRadius: 2, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${ppPct}%`, height: "100%", background: "var(--color-accent)", boxShadow: "0 0 10px var(--color-accent)" }} />
              </span>
            </Link>
          ) : guide ? (
            <Link to="/guide" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left", display: "grid", gap: 10, textDecoration: "none" }}>
              <span style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                <span style={{ fontSize: "3rem", fontWeight: 500, lineHeight: 0.9, letterSpacing: "-0.03em", color: "var(--color-text)" }}>{guide.week}</span>
                <span style={{ flex: 1, fontSize: "0.8125rem", color: "var(--color-neutral-400)", lineHeight: 1.35 }}>
                  {t("home.weeksPregnant")}
                  <span style={{ display: "block", color: "var(--color-neutral-500)" }}>{t("home.trimesterLabel")} {guide.trimester}</span>
                </span>
              </span>
              <span style={{ display: "block", height: 4, background: "var(--color-neutral-900)", borderRadius: 2, overflow: "hidden" }}>
                <span style={{ display: "block", width: `${weekPct}%`, height: "100%", background: "var(--color-accent)", boxShadow: "0 0 10px var(--color-accent)" }} />
              </span>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.75rem", color: "var(--color-neutral-500)", whiteSpace: "nowrap" }}>
                {guide.estimatedDueDate && <span>{t("home.due")} {guide.estimatedDueDate}</span>}
                <span>{Math.max(40 - guide.week, 0)} {t("home.weeksToGo")}</span>
              </span>
            </Link>
          ) : (
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 500, color: "var(--color-text)" }}>{t("home.weekNotSet")}</div>
              <Link to="/profile" style={{ fontSize: "0.8125rem", color: "var(--color-accent-400)" }}>{t("home.setupProfileLink")}</Link>
            </div>
          )}
        </div>
        <div style={{ background: "var(--color-surface)", padding: 20, display: "grid", gap: 12, alignContent: "center" }}>
          <Link
            to="/assess"
            style={{
              textAlign: "left",
              border: "1px solid var(--color-accent)",
              borderRadius: 12,
              padding: 16,
              display: "flex",
              alignItems: "center",
              gap: 14,
              boxShadow: "0 0 24px rgba(145,132,217,0.16)",
              background: "none",
              cursor: "pointer",
              width: "100%",
              textDecoration: "none",
            }}
            className="jd-hover-tint"
          >
            <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--color-accent-900)", color: "var(--color-accent-300)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              <i className="ph ph-stethoscope" style={{ fontSize: "1.25rem" }} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "1rem", fontWeight: 500, color: "var(--color-text)" }}>{t("home.startCheck")}</span>
              <span style={{ display: "block", fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{t("home.startCheckSub")}</span>
            </span>
            <i className="ph ph-arrow-right" style={{ fontSize: "1.25rem", color: "var(--color-accent-400)" }} />
          </Link>
          {latest && (
            <Link to="/history" style={{ display: "flex", alignItems: "center", gap: 10, padding: 2, fontSize: "0.8125rem", color: "var(--color-neutral-400)", background: "none", border: 0, cursor: "pointer", textDecoration: "none" }}>
              {bucket && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, background: RISK_COLORS[bucket].tint, color: RISK_COLORS[bucket].text, fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  <i className={`ph ${RISK_COLORS[bucket].icon}`} />
                  {severityLabel(t, latest.severityLevel)}
                </span>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>{t("home.lastCheckLabel")} {new Date(latest.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span style={{ color: "var(--color-accent-400)" }}>{t("home.viewLink")}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Today tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        <Tile icon="ph-drop" label={t("home.bloodPressure")} value={vitals ? `${vitals.SystolicBP}/${vitals.DiastolicBP}` : null}
          sub={vitals && (bpHigh ? t("home.aboveLimit") : t("home.normalLabel"))} tone={vitals ? (bpHigh ? "var(--color-critical)" : "var(--color-good)") : null}
          emptyHint={t("home.recordVitals")} to="/assess" />
        <Tile icon="ph-heartbeat" label={t("home.haemoglobin")} value={hb ? hb.hemoglobin : null} unit="g/dL"
          sub={hb?.grade} tone={hb ? (hbCritical ? "var(--color-critical)" : hb.grade === "Normal" ? "var(--color-good)" : "var(--color-warning)") : null}
          emptyHint={t("home.addHbReading")} to="/assess" />
        <Tile icon="ph-drop-half-bottom" label={t("home.bloodSugar")} value={vitals ? vitals.BS : null} unit="mmol/L"
          sub={vitals && (bsHigh ? t("home.aboveLimit") : t("home.normalLabel"))} tone={vitals ? (bsHigh ? "var(--color-critical)" : "var(--color-good)") : null}
          emptyHint={t("home.recordVitals")} to="/assess" />
        <Tile icon="ph-scales" label={t("home.weightLabel")} value={weight ? weight.valueKg : null} unit="kg"
          sub={weight?.status} tone={weight?.status ? (/tracking normally/i.test(weight.status) ? "var(--color-good)" : "var(--color-warning)") : null}
          emptyHint={t("home.addWeightCheck")} to="/assess" />
      </div>

      {/* One-line trend hint - each assessment used to be fully stateless
          from Home's point of view (the full breakdown only ever showed up
          on History, which most people don't visit unless they think to).
          Surfacing just the single most relevant "what changed" note here,
          computed the same way as History's own trend engine (lib/trends.js),
          means a rising BP or a declining hemoglobin is visible on the very
          first screen, not just to someone who goes looking for it. */}
      {trendNote && (
        <Link
          to="/history"
          style={{
            display: "flex", alignItems: "center", gap: 10, borderRadius: 12, border: `1px solid ${trendNote.tone}`,
            padding: "10px 14px", fontSize: "0.8125rem", color: "var(--color-text)", textDecoration: "none",
          }}
        >
          <i className="ph ph-trend-up" style={{ color: trendNote.tone, flex: "none" }} />
          <span style={{ flex: 1, minWidth: 0 }}>{trendNote.text}</span>
          <span style={{ flex: "none", color: "var(--color-accent-400)" }}>{t("home.viewLink")}</span>
        </Link>
      )}

      {/* Danger signs + right column (next visit, ASHA, today's care) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 14, boxShadow: "var(--shadow-sm)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <i className="ph ph-warning" style={{ fontSize: "1.125rem", color: "var(--color-critical)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>{t("home.call108If")}</div>
              {guide && <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("home.forThisWeek")}</div>}
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(guide?.dangerSigns || t("home.defaultDangerSigns")).map((d) => (
              <div key={d} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: "0.875rem", color: "var(--color-text)" }}>
                <i className="ph ph-dot-outline" style={{ color: "var(--color-critical)", fontSize: "1rem", flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0 }}>{d}</span>
              </div>
            ))}
          </div>
          <a href="tel:108" className="btn jd-call108-fill">
            <i className="ph ph-phone-call" /> {t("home.call108Ambulance")}
          </a>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {guide?.nextAncVisit && (
            <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
              <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--color-accent-900)", color: "var(--color-accent-300)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <i className="ph ph-calendar-check" style={{ fontSize: "1.25rem" }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("home.nextVisit")}</div>
                <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>Visit {guide.nextAncVisit.visit} · {guide.nextAncVisit.window}</div>
              </div>
              <Link to="/guide" className="btn btn-secondary btn-icon" aria-label="Details"><i className="ph ph-arrow-right" /></Link>
            </div>
          )}

          {hasAsha ? (
            <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-accent-900)", color: "var(--color-accent-300)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, flex: "none" }}>
                {(extra.ashaName || "?").charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("home.yourAsha")}</div>
                <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{extra.ashaName || extra.ashaPhone}</div>
              </div>
              {extra.ashaPhone && (
                <a href={`tel:${extra.ashaPhone}`} className="btn btn-secondary btn-icon" aria-label="Call"><i className="ph ph-phone" /></a>
              )}
              {extra.ashaPhone && (
                <a href={`https://wa.me/${extra.ashaPhone.replace(/\D/g, "")}?text=${waText}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-icon" aria-label="WhatsApp">
                  <i className="ph ph-whatsapp-logo" />
                </a>
              )}
            </div>
          ) : (
            <Link to="/profile" className="btn btn-ghost" style={{ justifySelf: "start", fontSize: "0.8125rem" }}>
              <i className="ph ph-user-plus" /> {t("home.addAshaContact")}
            </Link>
          )}

          <TodayCare history={history} />

          <Link to="/help" className="btn btn-ghost" style={{ justifySelf: "start", fontSize: "0.8125rem" }}>
            <i className="ph ph-map-pin" /> {t("home.findNearbyCare")} <i className="ph ph-arrow-right" />
          </Link>
        </div>
      </div>

      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>{t("home.tipOfDay")}</p>
        <p style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "var(--color-text)" }}>{tip}</p>
      </div>

      {loading && <Spinner label="Loading your history…" />}
    </div>
  );
}
