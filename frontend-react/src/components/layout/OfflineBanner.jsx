import { useOnlineStatus } from "../../lib/useOnlineStatus";

// Ambient, app-wide connectivity awareness - shown regardless of login
// state (even the pre-login Welcome Gate can't reach the backend while
// offline), so "why isn't this working" has an obvious answer instead of
// every page failing individually with its own generic error.
export default function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div
      data-print-hide
      className="sticky top-0 z-40 border-b border-warning/40 bg-warning-soft px-4 py-2 text-center text-xs font-medium text-ink"
    >
      <i className="ph ph-wifi-slash" /> You're offline - some features won't work right now. Anything you fill in on
      the Assessment is saved on this device and will submit automatically once you're back online.
    </div>
  );
}
