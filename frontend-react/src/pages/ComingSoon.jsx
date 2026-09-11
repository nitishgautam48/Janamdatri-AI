import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Pill from "../components/ui/Pill";

// This is the Vite+React rewrite's honest placeholder for a screen not
// ported yet - it says so plainly rather than silently 404ing or, worse,
// faking a page with no real data behind it.
export default function ComingSoon({ title }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <Pill className="mb-4">Rebuild in progress</Pill>
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        This screen is being rebuilt in the new Vite+React interface and isn't ready yet. It still works in the original app.
      </p>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
        ← Back to Home
      </Link>
    </div>
  );
}
