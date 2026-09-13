// A small animated loading indicator, used in place of bare "Loading…"
// text - every page that fetches history/profile/roster data on mount had
// its own plain-text loading state with no visual motion, which read as
// the page having stalled rather than actively working. One shared
// component keeps that "still working" signal consistent everywhere.
export default function Spinner({ label = "Loading…", className = "" }) {
  return (
    <div className={`flex items-center gap-2 text-sm text-muted ${className}`} role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-primary" />
      <span>{label}</span>
    </div>
  );
}
