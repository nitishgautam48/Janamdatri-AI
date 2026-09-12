import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useHistory } from "../../lib/useHistory";
import { loadSavedEpds, scopedKey } from "../../lib/storage";

// A danger sign shouldn't only be visible on the Home tab - ported from
// the vanilla-JS app's checkGlobalEmergencyBanner(), this stays sticky
// under the header on every view for as long as the most recent result is
// unresolved (Critical/Severe, or a self-harm flag). Dismissing hides it
// for THIS specific result only (tracked by its timestamp) - a session-
// only choice, not a persistent one, so a fresh page load still shows it
// if nothing has actually changed.
export default function GlobalEmergencyBanner() {
  const { hasIdentity, identityKey } = useAuth();
  const { history } = useHistory();
  const [dismissedFor, setDismissedFor] = useState(null);

  const latest = history[0];
  const isDanger = !!(latest && (latest.severityLevel === "Critical" || latest.severityLevel === "Severe"));
  const assessSelfHarm = !!latest?.result?.psychologicalEvaluation?.selfHarmFlagged;
  // The standalone Mental Health Check never creates an assessment-history
  // entry, so a self-harm flag from THAT flow has to be checked separately.
  const savedEpds = loadSavedEpds();
  const standaloneSelfHarm = !!savedEpds?.result?.selfHarmFlagged;
  const selfHarm = assessSelfHarm || standaloneSelfHarm;

  const dismissKey = `${latest ? latest.timestamp : ""}|${savedEpds ? savedEpds.savedAt : ""}`;
  const storageKey = scopedKey("janamdatri_emergency_banner_dismissed");

  useEffect(() => {
    try {
      setDismissedFor(sessionStorage.getItem(storageKey));
    } catch {
      setDismissedFor(null);
    }
    // identityKey ensures this re-reads when switching between accounts/guest.
  }, [storageKey, identityKey]);

  if (!hasIdentity || (!isDanger && !selfHarm) || dismissedFor === dismissKey) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(storageKey, dismissKey);
    } catch {
      /* non-fatal */
    }
    setDismissedFor(dismissKey);
  }

  return (
    <div
      style={{ top: "var(--app-header-h, 5rem)" }}
      data-print-hide
      className="sticky z-30 border-b border-critical/40 bg-critical px-4 py-3 text-white"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">
          {selfHarm
            ? "🚨 A Mental Health Check flagged thoughts of self-harm — please reach out to someone you trust or KIRAN now."
            : `🚨 Your last assessment (${latest.severityLevel}) flagged something that needs prompt attention.`}
        </p>
        <a href="tel:108" className="whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-bold text-critical">
          🚨 Call 108
        </a>
        {selfHarm && (
          <a href="tel:1800-599-0019" className="whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-bold text-critical">
            KIRAN 1800-599-0019
          </a>
        )}
        <Link to="/history" className="whitespace-nowrap text-xs font-semibold text-white underline">
          View details
        </Link>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-white/80 hover:text-white">
          ✕
        </button>
      </div>
    </div>
  );
}
