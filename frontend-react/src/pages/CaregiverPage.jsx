import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Pill from "../components/ui/Pill";
import { api } from "../lib/api";

const LEVEL_TONE = { Critical: "critical", Severe: "critical", Moderate: "warning", Mild: "good", Minimal: "good" };
const LEVEL_LABEL = { Critical: "🔴 Needs urgent attention", Severe: "🔴 Needs urgent attention", Moderate: "🟡 Worth checking in on", Mild: "🟢 Doing okay", Minimal: "🟢 Doing okay" };

// Same share-code + same read-only endpoint as the Provider view - the
// code doesn't know or care who's holding it, so no backend change was
// needed for this. What differs is entirely presentation: a family
// member doesn't need MRI scores or vitals, they need "is she okay
// right now" in plain language, so this deliberately shows far less
// than ProviderPage does.
export default function CaregiverPage() {
  const [code, setCode] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    setData(null);
    try {
      const result = await api.providerSummary(code.trim());
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sev = data?.latestAssessment;
  const tone = sev ? LEVEL_TONE[sev.severityLevel] || "neutral" : "neutral";
  const isDanger = sev && (sev.severityLevel === "Critical" || sev.severityLevel === "Severe");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <h1 className="text-xl font-bold text-ink">Caregiver View</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the code your family member shared with you to see how they're doing. No account needed - the code
          itself is the access, and only they can create or revoke it.
        </p>
        <form onSubmit={lookup} className="mt-4 flex gap-2">
          <input
            aria-label="Share code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={8}
            placeholder="e.g. 8UDPF7AG"
            className="flex-1 rounded-md border border-border-strong bg-bg px-4 py-2.5 font-mono text-sm uppercase text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Check In"}
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      </Card>

      {data && (
        <Card className={isDanger ? "border-critical/40 bg-critical-soft" : ""}>
          <h2 className="break-words text-lg font-bold text-ink">{data.patientName}</h2>

          {sev ? (
            <>
              <div className="mt-3">
                <Pill tone={tone} className="text-sm">{LEVEL_LABEL[sev.severityLevel] || sev.severityLevel}</Pill>
              </div>
              <p className="mt-2 text-xs text-faint">Last checked: {new Date(sev.createdAt * 1000).toLocaleDateString()}</p>

              {isDanger ? (
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-semibold text-ink">
                    Their latest check flagged something that needs prompt medical attention. Please help them reach
                    care now if they haven't already.
                  </p>
                  <a href="tel:108" className="inline-block rounded-full bg-critical px-4 py-2 text-sm font-bold text-white">
                    🚨 Call 108
                  </a>
                </div>
              ) : (
                <p className="mt-3 text-sm text-good">✓ Nothing urgent flagged right now.</p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">No health check recorded yet.</p>
          )}

          <p className="mt-4 text-xs text-faint">
            This is a simplified view for family and caregivers. It shows overall status only, not clinical detail -
            a healthcare provider can view more using the same code on the Provider page.
          </p>
        </Card>
      )}
    </div>
  );
}
