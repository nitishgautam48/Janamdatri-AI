// Nocturne's buttons are outlined (accent border + text on transparent),
// not filled - "primary" reads as an accent-colored action against the
// dark ground rather than needing a solid fill for contrast.
const VARIANTS = {
  primary: "bg-transparent text-primary border border-primary hover:bg-primary-soft",
  ghost: "bg-transparent text-ink border border-border-strong hover:bg-surface-hover",
  paper: "bg-paper text-paper-ink hover:bg-white/10",
  danger: "bg-transparent text-critical border border-critical/40 hover:bg-critical-soft",
};

export default function Button({ variant = "primary", className = "", children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold
        transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed
        disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
