const VARIANTS = {
  primary: "bg-primary text-paper-ink hover:bg-primary-dark",
  ghost: "bg-transparent text-ink border border-border-strong hover:bg-surface-hover",
  paper: "bg-paper text-paper-ink hover:bg-white",
  danger: "bg-transparent text-critical border border-critical/40 hover:bg-critical-soft",
};

export default function Button({ variant = "primary", className = "", children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold
        transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
