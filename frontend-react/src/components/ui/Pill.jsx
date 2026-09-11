const TONES = {
  neutral: "bg-surface-hover text-muted border-border-strong",
  primary: "bg-primary-soft text-primary border-primary/30",
  critical: "bg-critical-soft text-critical border-critical/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  good: "bg-good-soft text-good border-good/30",
};

export default function Pill({ tone = "neutral", className = "", children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
