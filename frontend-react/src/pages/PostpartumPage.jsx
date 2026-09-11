import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { api } from "../lib/api";
import { KEYS, scopedGet, scopedRemove, scopedSet } from "../lib/storage";

export default function PostpartumPage() {
  const [guide, setGuide] = useState(() => scopedGet(KEYS.POSTPARTUM_GUIDE));
  const [deliveryDate, setDeliveryDate] = useState(guide?.deliveryDate || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!deliveryDate) return;
    setError("");
    setBusy(true);
    try {
      const data = await api.postpartumGuide(deliveryDate);
      scopedSet(KEYS.POSTPARTUM_GUIDE, { ...data, savedAt: new Date().toISOString() });
      setGuide(data);
    } catch (err) {
      setError(err.message || "Could not load your postpartum guide.");
    } finally {
      setBusy(false);
    }
  }

  function handleClear() {
    scopedRemove(KEYS.POSTPARTUM_GUIDE);
    setGuide(null);
    setDeliveryDate("");
  }

  const showResults = guide && guide.isWithin6Weeks;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <h1 className="text-xl font-bold text-ink">Postpartum Care</h1>
        <p className="mt-1 text-sm text-muted">
          Recovery, breastfeeding, and follow-up guidance for the 6 weeks after delivery.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Delivery date</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none"
            />
          </div>
          <Button onClick={handleSave} disabled={busy || !deliveryDate}>{busy ? "…" : "Save"}</Button>
          {guide && <Button variant="ghost" onClick={handleClear}>Clear</Button>}
        </div>
        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
        {guide && !guide.isWithin6Weeks && (
          <p className="mt-3 text-sm text-muted">More than 6 weeks have passed since this delivery date - postpartum guidance is most relevant in the first 6 weeks.</p>
        )}
      </Card>

      {showResults && (
        <>
          <Card>
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary-soft px-4 py-2 text-sm font-bold text-primary">Day {guide.daysPostpartum}</div>
              <div>
                <div className="text-sm font-semibold text-ink">Week {guide.weeksPostpartum} postpartum</div>
                <div className="text-xs text-muted">Next check-up: Visit {guide.nextVisit.visit} — {guide.nextVisit.window}</div>
              </div>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min((guide.daysPostpartum / 42) * 100, 100)}%` }} />
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Recovery</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink">
              {guide.recovery.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Breastfeeding</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink">
              {guide.breastfeeding.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-bold text-ink">Mental Well-being</h3>
            <p className="mb-3 text-sm text-muted">{guide.mentalHealthNote}</p>
            <Link to="/mental-wellness"><Button variant="ghost">💜 Take the Mental Health Check</Button></Link>
          </Card>

          <Card className="border-critical/30">
            <h3 className="mb-2 text-sm font-bold text-critical">Warning Signs — Seek Care Now</h3>
            <ul className="mb-3 list-inside list-disc space-y-1 text-sm text-critical">
              {guide.dangerSigns.map((d) => <li key={d}>{d}</li>)}
            </ul>
            <Link to="/assess"><Button variant="ghost">📝 Describe Symptoms in an Assessment</Button></Link>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-bold text-ink">Postnatal Check-up (PNC) Schedule</h3>
            <div className="space-y-3">
              {guide.pncSchedule.map((visit) => (
                <div
                  key={visit.visit}
                  className={`rounded-md border p-3.5 ${visit.visit === guide.nextVisit.visit ? "border-primary/40 bg-primary-soft" : "border-border"}`}
                >
                  <div className="flex items-center justify-between text-sm font-semibold text-ink">
                    <span>Visit {visit.visit} — {visit.window}</span>
                    {visit.visit === guide.nextVisit.visit && <span className="text-xs font-bold text-primary">Next up</span>}
                  </div>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm text-muted">
                    {visit.checks.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
