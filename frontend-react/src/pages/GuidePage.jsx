import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import PregnancyTimeline from "../components/ui/PregnancyTimeline";
import { api } from "../lib/api";
import { KEYS, scopedSet } from "../lib/storage";

function ThisWeekAccordion({ guide }) {
  const [open, setOpen] = useState(null);
  const sections = [
    { id: "mother", label: "Mother's Health", detail: <p>{guide.note}</p> },
    { id: "nutrition", label: "Nutrition Tips", detail: <ul className="list-inside list-disc space-y-1">{guide.nutrition.map((n) => <li key={n}>{n}</li>)}</ul> },
    { id: "tests", label: "Tests & Checkups", detail: <ul className="list-inside list-disc space-y-1">{guide.nextAncVisit.checks.map((c) => <li key={c}>{c}</li>)}</ul> },
    { id: "warning", label: "Warning Signs", detail: <ul className="list-inside list-disc space-y-1 text-critical">{guide.dangerSigns.map((d) => <li key={d}>{d}</li>)}</ul> },
  ];

  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {sections.map((s) => (
        <div key={s.id}>
          <button
            type="button"
            onClick={() => setOpen(open === s.id ? null : s.id)}
            className="flex w-full items-center justify-between px-3.5 py-3 text-left text-sm font-medium text-ink hover:bg-surface-hover"
          >
            <span>{s.label}</span>
            <span className="text-muted">{open === s.id ? "−" : "→"}</span>
          </button>
          {open === s.id && <div className="px-3.5 pb-3.5 text-sm text-muted">{s.detail}</div>}
        </div>
      ))}
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
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
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
        <>
          <Card>
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary-soft px-4 py-2 text-sm font-bold text-primary">Week {guide.week}</div>
              <div>
                <div className="text-sm font-semibold text-ink">Trimester {guide.trimester}</div>
                <div className="text-xs text-muted">
                  {guide.estimatedDueDate ? `Estimated due date: ${guide.estimatedDueDate} · ${guide.weeksUntilDue} weeks to go` : `${guide.weeksUntilDue} weeks to go`}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <PregnancyTimeline week={guide.week} />
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">This Week</h3>
            <ThisWeekAccordion guide={guide} />
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-bold text-ink">Pregnancy Check-up Schedule (ANC)</h3>
            <div className="space-y-3">
              {guide.ancSchedule.map((visit) => (
                <div
                  key={visit.visit}
                  className={`rounded-md border p-3.5 ${visit.visit === guide.nextAncVisit.visit ? "border-primary/40 bg-primary-soft" : "border-border"}`}
                >
                  <div className="flex items-center justify-between text-sm font-semibold text-ink">
                    <span>Visit {visit.visit} — {visit.window}</span>
                    {visit.visit === guide.nextAncVisit.visit && <span className="text-xs font-bold text-primary">Next up</span>}
                  </div>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm text-muted">
                    {visit.checks.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-bold text-ink">Government Schemes</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(guide.schemes).map(([name, desc]) => (
                <div key={name} className="rounded-md border border-border p-3.5">
                  <div className="text-sm font-semibold text-ink">{name}</div>
                  <div className="mt-1 text-xs text-muted">{desc}</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
