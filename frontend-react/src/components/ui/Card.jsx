// Nocturne's own card shape (14px radius, no border, --shadow-sm) instead
// of Tailwind's generic rounded-lg/border/shadow recomposition. Plain
// Tailwind classes (not inline style) so a caller's className can still
// override background/border for semantic states (e.g. "border-critical/40
// bg-critical-soft") the way every existing call site already does.
export default function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-[14px] bg-surface p-4 shadow-[0_0_0_1px_var(--color-neutral-800)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
