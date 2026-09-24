import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import PregnancyTimeline from "../components/ui/PregnancyTimeline";
import { api } from "../lib/api";
import { KEYS, scopedSet, loadKickLog, appendKickLog } from "../lib/storage";
import { useLang } from "../context/LangContext";

function ThisWeekAccordion({ guide }) {
  const { t } = useLang();
  const [open, setOpen] = useState(null);
  const sections = [
    { id: "mother", label: t("guide.motherHealth"), detail: <p>{guide.note}</p> },
    { id: "nutrition", label: t("guide.nutritionTips"), detail: <ul className="list-inside list-disc space-y-1">{guide.nutrition.map((n) => <li key={n}>{n}</li>)}</ul> },
    { id: "tests", label: t("guide.testsCheckups"), detail: <ul className="list-inside list-disc space-y-1">{guide.nextAncVisit.checks.map((c) => <li key={c}>{c}</li>)}</ul> },
    { id: "warning", label: t("guide.warningSigns"), detail: <ul className="list-inside list-disc space-y-1 text-critical">{guide.dangerSigns.map((d) => <li key={d}>{d}</li>)}</ul> },
  ];

  return (
    <div style={{ display: "grid", gap: 1, background: "var(--color-neutral-900)", borderRadius: 12, overflow: "hidden" }}>
      {sections.map((s) => (
        <div key={s.id} style={{ background: "#1b1d2a" }}>
          <button
            type="button"
            onClick={() => setOpen(open === s.id ? null : s.id)}
            style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", textAlign: "left", fontSize: "0.875rem", fontWeight: 500, color: "var(--color-text)", background: "none", border: 0, cursor: "pointer" }}
          >
            <span>{s.label}</span>
            <i className={`ph ${open === s.id ? "ph-caret-up" : "ph-caret-down"}`} style={{ color: "var(--color-neutral-500)" }} />
          </button>
          {open === s.id && <div style={{ padding: "0 14px 14px", fontSize: "0.8125rem", color: "var(--color-neutral-300)" }}>{s.detail}</div>}
        </div>
      ))}
    </div>
  );
}

const KICK_TARGET = 10;

function KickCounter() {
  const { t } = useLang();
  const [count, setCount] = useState(0);
  const [startedAt, setStartedAt] = useState(null);
  const [log, setLog] = useState(() => loadKickLog());
  const [saved, setSaved] = useState(false);

  function tap() {
    setSaved(false);
    setCount((c) => c + 1);
    setStartedAt((s) => s || Date.now());
  }

  function save() {
    if (count === 0) return;
    const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60000)) : null;
    setLog(appendKickLog(count, minutes));
    setSaved(true);
  }

  function reset() {
    setCount(0);
    setStartedAt(null);
    setSaved(false);
  }

  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 12, boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{t("guide.kickCounter")} <span style={{ color: "var(--color-neutral-500)" }}>{t("guide.fetalMovement")}</span></span>
      </div>
      <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-500)" }}>{t("guide.kickInstructions").replace("{n}", KICK_TARGET)}</p>
      <button
        type="button"
        onClick={tap}
        style={{
          justifySelf: "center",
          width: 140,
          height: 140,
          borderRadius: "50%",
          border: "1px solid var(--color-accent)",
          background: count >= KICK_TARGET ? "var(--color-accent-900)" : "var(--color-surface)",
          boxShadow: "0 0 30px rgba(145,132,217,0.2)",
          cursor: "pointer",
          display: "grid",
          placeContent: "center",
          gap: 2,
        }}
      >
        <span style={{ fontSize: "2.5rem", fontWeight: 500, lineHeight: 1, color: "var(--color-text)" }}>{count}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--color-accent-300)" }}>{t("guide.tapOnMovement")}</span>
      </button>
      {count >= KICK_TARGET && (
        <div style={{ fontSize: "0.8125rem", lineHeight: 1.5, padding: "10px 12px", borderRadius: 10, background: "var(--color-good-soft)", color: "var(--color-good)" }}>
          {t("guide.kickGoodPattern").replace("{n}", KICK_TARGET)}
        </div>
      )}
      {saved && count > 0 && count < KICK_TARGET && (
        <div style={{ fontSize: "0.8125rem", lineHeight: 1.5, padding: "10px 12px", borderRadius: 10, background: "var(--color-warning-soft)", color: "var(--color-warning)" }}>
          {t("guide.kickFewerThan").replace("{n}", KICK_TARGET)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" onClick={save} className="btn btn-primary" style={{ fontSize: "0.8125rem" }}>
          <i className="ph ph-floppy-disk" /> {t("guide.save")}
        </button>
        <button type="button" onClick={reset} className="btn btn-secondary" style={{ fontSize: "0.8125rem" }}>{t("guide.reset")}</button>
      </div>
      {log.length > 0 && (
        <div style={{ display: "grid", gap: 4, borderTop: "1px solid var(--color-neutral-800)", paddingTop: 10 }}>
          {log.slice(0, 5).map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>
              <span>{new Date(l.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span>{l.count} {t("guide.movements")}{l.minutes ? ` ${t("guide.inAboutMin").replace("{n}", l.minutes)}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuidePage() {
  const { t } = useLang();
  const [mode, setMode] = useState("lmp");
  const [lmp, setLmp] = useState("");
  const [week, setWeek] = useState(20);
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Browsing a different week's ANC/danger-sign/nutrition content than
  // the saved profile week - a real fetch of that week's real guide data
  // (the backend already supports any week), never persisted to the
  // profile, so "your" week on Home/elsewhere is untouched.
  const [browsedGuide, setBrowsedGuide] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const shown = browsedGuide || guide;

  async function handleSubmit() {
    setError("");
    if (mode === "lmp" && !lmp) return;
    setBusy(true);
    try {
      const data = await api.pregnancyGuide(mode === "lmp" ? { lmp } : { week: Number(week) });
      setGuide(data);
      setBrowsedGuide(null);
      scopedSet(KEYS.GUIDE, { ...data, savedAt: new Date().toISOString() });
    } catch (err) {
      setError(err.message || t("guide.loadError"));
    } finally {
      setBusy(false);
    }
  }

  async function browseWeek(delta) {
    const targetWeek = Math.max(4, Math.min(40, shown.week + delta));
    if (targetWeek === guide.week) {
      setBrowsedGuide(null);
      return;
    }
    setBrowsing(true);
    try {
      const data = await api.pregnancyGuide({ week: targetWeek });
      setBrowsedGuide(data);
    } catch {
      /* keep showing whatever was already loaded */
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card style={{ maxWidth: guide ? "none" : 640 }}>
        <h1 className="text-xl font-bold text-ink">{t("guide.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("guide.subtitle")}</p>

        <div className="mt-4 flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "lmp"} onChange={() => setMode("lmp")} />
            {t("guide.byLmp")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "week"} onChange={() => setMode("week")} />
            {t("guide.byWeek")}
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {mode === "lmp" ? (
            <div>
              <label htmlFor="guide-lmp" className="mb-1 block text-sm font-medium text-muted">{t("guide.lmpDateLabel")}</label>
              <input
                id="guide-lmp"
                type="date"
                value={lmp}
                onChange={(e) => setLmp(e.target.value)}
                className="rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="guide-week" className="mb-1 block text-sm font-medium text-muted">{t("guide.currentWeekLabel")}</label>
              <input
                id="guide-week"
                type="number"
                min={0}
                max={42}
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                className="w-28 rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          )}
          <Button onClick={handleSubmit} disabled={busy}>{busy ? "…" : t("guide.getMyGuide")}</Button>
        </div>
        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      </Card>

      {guide && (
        <div className="mx-auto max-w-none" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => browseWeek(-1)} disabled={browsing} className="btn btn-secondary btn-icon" aria-label={t("guide.previousWeek")}>
                  <i className="ph ph-caret-left" />
                </button>
                <div style={{ borderRadius: 99, padding: "8px 16px", fontSize: "0.875rem", fontWeight: 600, background: "var(--color-accent-900)", color: "var(--color-accent-200)" }}>{t("guide.weekLabel")} {shown.week}</div>
                <button type="button" onClick={() => browseWeek(1)} disabled={browsing} className="btn btn-secondary btn-icon" aria-label={t("guide.nextWeek")}>
                  <i className="ph ph-caret-right" />
                </button>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{t("guide.trimesterLabel")} {shown.trimester}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>
                    {shown === guide && guide.estimatedDueDate
                      ? `${t("guide.estimatedDueDate")} ${guide.estimatedDueDate} · ${guide.weeksUntilDue} ${t("guide.weeksToGo")}`
                      : `${shown.weeksUntilDue} ${t("guide.weeksToGo")}`}
                  </div>
                </div>
              </div>
              {browsedGuide && (
                <button type="button" onClick={() => setBrowsedGuide(null)} className="btn btn-ghost mt-2" style={{ fontSize: "0.75rem" }}>
                  {t("guide.backToYourWeek").replace("{n}", guide.week)}
                </button>
              )}
              <div className="mt-5">
                <PregnancyTimeline week={shown.week} />
              </div>
            </div>

            <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8, boxShadow: "var(--shadow-sm)" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("guide.thisWeek")}</h3>
              <ThisWeekAccordion guide={shown} />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("guide.governmentSchemes")}</h3>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
                {Object.entries(guide.schemes).map(([name, desc]) => (
                  <div key={name} style={{ background: "var(--color-surface)", borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{name}</div>
                    <div style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 14 }}>
            <KickCounter />

            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("guide.clinicVisits")}</h3>
              {shown.ancSchedule.map((visit) => {
                const isNext = visit.visit === shown.nextAncVisit.visit;
                return (
                  <div
                    key={visit.visit}
                    style={{
                      display: "flex",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: `1px solid ${isNext ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
                      background: isNext ? "var(--color-accent-900)" : "var(--color-surface)",
                    }}
                  >
                    <i className={`ph ${isNext ? "ph-calendar-check" : "ph-calendar"}`} style={{ fontSize: "1.25rem", color: isNext ? "var(--color-accent-300)" : "var(--color-neutral-500)", marginTop: 1 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{t("guide.visitLabel")} {visit.visit} — {visit.window}</span>
                        {isNext && <span style={{ fontSize: "0.75rem", color: "var(--color-accent-300)" }}>{t("guide.nextUp")}</span>}
                      </div>
                      <ul className="mt-1 list-inside list-disc space-y-0.5" style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>
                        {visit.checks.map((c) => <li key={c}>{c}</li>)}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
