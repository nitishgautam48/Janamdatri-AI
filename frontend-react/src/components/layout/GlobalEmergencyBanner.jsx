import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { useHistory } from "../../lib/useHistory";
import { loadSavedEpds, scopedKey } from "../../lib/storage";
import { severityLabel } from "../../lib/severity";
import ReadAloudButton from "../ui/ReadAloudButton";
import CriticalFollowUp from "../shared/CriticalFollowUp";

// A danger sign shouldn't only be visible on the Home tab - ported from
// the vanilla-JS app's checkGlobalEmergencyBanner(), this stays sticky
// under the header on every OTHER view for as long as the most recent
// result is unresolved (Critical/Severe, or a self-harm flag). Home is
// excluded because it already shows this same alert inline, with its own
// copy of the "did you seek care" follow-up - showing both stacked one
// after another read as a visual glitch rather than two different pieces
// of information. That same follow-up (compact form) is included here
// too, so it's an actual cross-page reminder rather than something only
// visible to someone who happens to land back on Home.
// Dismissing hides it for THIS specific result only (tracked by its
// timestamp) - a session-only choice, not a persistent one, so a fresh
// page load still shows it if nothing has actually changed.
export default function GlobalEmergencyBanner() {
  const { hasIdentity, identityKey } = useAuth();
  const { t } = useLang();
  const { history } = useHistory();
  const location = useLocation();
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

  if (!hasIdentity || location.pathname === "/" || (!isDanger && !selfHarm) || dismissedFor === dismissKey) return null;

  const bannerText = selfHarm ? t("home.selfHarmAlert") : `${t("home.dangerAlertPrefix")}${severityLabel(t, latest.severityLevel)}${t("home.dangerAlertSuffix")}`;

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
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">🚨 {bannerText}</p>
        <ReadAloudButton text={bannerText} className="!border-white/50 !text-white hover:!border-white hover:!text-white" />
        <a href="tel:108" className="whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-bold text-critical">
          🚨 {t("common.call108")}
        </a>
        {selfHarm && (
          <a href="tel:1800-599-0019" className="whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-xs font-bold text-critical">
            KIRAN 1800-599-0019
          </a>
        )}
        <Link to="/history" className="whitespace-nowrap text-xs font-semibold text-white underline">
          {t("common.viewDetails")}
        </Link>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-white/80 hover:text-white">
          ✕
        </button>
        {isDanger && !selfHarm && <CriticalFollowUp assessmentTimestamp={latest.timestamp} severityLevel={latest.severityLevel} compact />}
      </div>
    </div>
  );
}
