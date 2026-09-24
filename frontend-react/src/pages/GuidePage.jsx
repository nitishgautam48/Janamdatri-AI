import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import PregnancyTimeline from "../components/ui/PregnancyTimeline";
import { api } from "../lib/api";
import { KEYS, scopedSet, loadKickLog, appendKickLog } from "../lib/storage";

function ThisWeekAccordion({ guide }) {
  const [open, setOpen] = useState(null);
  const sections = [
    { id: "mother", label: "Mother's Health", detail: <p>{guide.note}</p> },
    { id: "nutrition", label: "Nutrition Tips", detail: <ul className="list-inside list-disc space-y-1">{guide.nutrition.map((n) => <li key={n}>{n}</li>)}</ul> },
    { id: "tests", label: "Tests & Checkups", detail: <ul className="list-inside list-disc space-y-1">{guide.nextAncVisit.checks.map((c) => <li key={c}>{c}</li>)}</ul> },
    { id: "warning", label: "Warning Signs", detail: <ul className="list-inside list-disc space-y-1 text-critical">{guide.dangerSigns.map((d) => <li key={d}>{d}</li>)}</ul> },
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
        <span style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>Kick counter <span style={{ color: "var(--color-neutral-500)" }}>(fetal movement)</span></span>
      </div>
      <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-500)" }}>Lie on your left side and tap each time you feel a movement. Aim for {KICK_TARGET} in 2 hours.</p>
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
        <span style={{ fontSize: "0.75rem", color: "var(--color-accent-300)" }}>Tap on movement</span>
      </button>
      {count >= KICK_TARGET && (
        <div style={{ fontSize: "0.8125rem", lineHeight: 1.5, padding: "10px 12px", borderRadius: 10, background: "var(--color-good-soft)", color: "var(--color-good)" }}>
          {KICK_TARGET}+ movements — a reassuring pattern. Keep an eye out tomorrow too.
        </div>
      )}
      {saved && count > 0 && count < KICK_TARGET && (
        <div style={{ fontSize: "0.8125rem", lineHeight: 1.5, padding: "10px 12px", borderRadius: 10, background: "var(--color-warning-soft)", color: "var(--color-warning)" }}>
          Fewer than {KICK_TARGET} — if this continues, mention it to your ASHA or provider.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" onClick={save} className="btn btn-primary" style={{ fontSize: "0.8125rem" }}>
          <i className="ph ph-floppy-disk" /> Save
        </button>
        <button type="button" onClick={reset} className="btn btn-secondary" style={{ fontSize: "0.8125rem" }}>Reset</button>
      </div>
      {log.length > 0 && (
        <div style={{ display: "grid", gap: 4, borderTop: "1px solid var(--color-neutral-800)", paddingTop: 10 }}>
          {log.slice(0, 5).map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--color-neutral-400)" }}>
              <span>{new Date(l.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              <span>{l.count} movements{l.minutes ? ` in ~${l.minutes} min` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuidePage() {
  const [mode, setMode] = useState("lmp");
  const [lmp, setLmp] = useState("");
  const [week, setWeek] = useState(20);
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError("");
    if (mode === "lmp" && !lmp) return;
    setBusy(true);
    try {
      const data = await api.pregnancyGuide(mode === "lmp" ? { lmp } : { week: Number(week) });
      setGuide(data);
      scopedSet(KEYS.GUIDE, { ...data, savedAt: new Date().toISOString() });
    } catch (err) {
      setError(err.message || "Could not load your pregnancy guide.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card style={{ maxWidth: guide ? "none" : 640 }}>
        <h1 className="text-xl font-bold text-ink">Pregnancy Guide</h1>
        <p className="mt-1 text-sm text-muted">Week-by-week ANC visit schedule, nutrition tips, and danger signs — aligned with India's RCH programme.</p>

        <div className="mt-4 flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "lmp"} onChange={() => setMode("lmp")} />
            By last menstrual period (LMP)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "week"} onChange={() => setMode("week")} />
            By current week
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {mode === "lmp" ? (
            <div>
              <label htmlFor="guide-lmp" className="mb-1 block text-sm font-medium text-muted">Last menstrual period date</label>
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
              <label htmlFor="guide-week" className="mb-1 block text-sm font-medium text-muted">Current gestational week</label>
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
          <Button onClick={handleSubmit} disabled={busy}>{busy ? "…" : "Get My Guide"}</Button>
        </div>
        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      </Card>

      {guide && (
        <div className="mx-auto max-w-none" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, boxShadow: "var(--shadow-sm)" }}>
              <div className="flex items-center gap-4">
                <div style={{ borderRadius: 99, padding: "8px 16px", fontSize: "0.875rem", fontWeight: 600, background: "var(--color-accent-900)", color: "var(--color-accent-200)" }}>Week {guide.week}</div>
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>Trimester {guide.trimester}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>
                    {guide.estimatedDueDate ? `Estimated due date: ${guide.estimatedDueDate} · ${guide.weeksUntilDue} weeks to go` : `${guide.weeksUntilDue} weeks to go`}
                  </div>
                </div>
              </div>
              <div className="mt-5">
                <PregnancyTimeline week={guide.week} />
              </div>
            </div>

            <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8, boxShadow: "var(--shadow-sm)" }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>This Week</h3>
              <ThisWeekAccordion guide={guide} />
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>Government Schemes</h3>
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
              <h3 style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>Clinic visits (ANC)</h3>
              {guide.ancSchedule.map((visit) => {
                const isNext = visit.visit === guide.nextAncVisit.visit;
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
                        <span style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>Visit {visit.visit} — {visit.window}</span>
                        {isNext && <span style={{ fontSize: "0.75rem", color: "var(--color-accent-300)" }}>Next up</span>}
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
