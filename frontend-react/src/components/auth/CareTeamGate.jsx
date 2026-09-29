import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import Button from "../ui/Button";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Counsellor/doctor sign-in - a real account (unlike /provider and
// /caregiver, which use a patient's share code as the sole credential).
// Self-registration here has NO vetting step confirming the signer-upper
// is an actual trained staff member - see src/auth.py's own docstring.
// Fine for a small known pilot team; a real deployment needs an
// invite/approval flow in front of this before it's safe to open up.
export default function CareTeamGate() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [role, setRole] = useState("counsellor");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [fieldError, setFieldError] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldError(null);
    if (!EMAIL_RE.test(form.email)) return setFieldError("email");
    if (form.password.length < 6) return setFieldError("pw");
    setBusy(true);
    try {
      const user = tab === "login" ? await login(form.email, form.password) : await register(form.email, form.password, form.name || null, role);
      navigate(user.role === "doctor" ? "/doctor" : "/counsellor");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-soft px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-xl shadow-black/5">
        <div className="mb-8 text-center">
          <span style={{ display: "inline-flex", width: 48, height: 48, borderRadius: 14, border: "1px solid var(--color-primary)", color: "var(--color-primary)", alignItems: "center", justifyContent: "center" }}>
            <i className="ph ph-headset" style={{ fontSize: 22 }} />
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink">Care Team</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">Sign in as a counsellor or doctor to see live cases and forwarded reviews.</p>
        </div>

        <div className="mb-6 flex rounded-full border border-border-strong p-1">
          {["login", "signup"].map((tb) => (
            <button key={tb} type="button" onClick={() => { setTab(tb); setError(""); setFieldError(null); }} className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${tab === tb ? "bg-primary text-paper-ink" : "text-muted hover:text-ink"}`}>
              {tb === "login" ? "Log In" : "Sign Up"}
            </button>
          ))}
        </div>

        {tab === "signup" && (
          <div className="mb-4 flex rounded-full border border-border-strong p-1">
            {[["counsellor", "Counsellor"], ["doctor", "Doctor"]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setRole(id)} className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${role === id ? "bg-primary text-paper-ink" : "text-muted hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          {tab === "signup" && (
            <input
              aria-label="Name" placeholder="Your name" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          )}
          <input
            type="email" required aria-label="Email" placeholder="name@example.com" value={form.email}
            onChange={(e) => { setForm((f) => ({ ...f, email: e.target.value })); setFieldError(null); }}
            className="w-full rounded-md border bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/25"
            style={{ borderColor: fieldError === "email" ? "var(--color-critical)" : "var(--color-border-strong)" }}
          />
          <input
            type="password" required aria-label="Password" placeholder="Password" value={form.password}
            onChange={(e) => { setForm((f) => ({ ...f, password: e.target.value })); setFieldError(null); }}
            className="w-full rounded-md border bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/25"
            style={{ borderColor: fieldError === "pw" ? "var(--color-critical)" : "var(--color-border-strong)" }}
          />
          {fieldError && <p className="text-sm text-critical">{fieldError === "email" ? "Enter a valid email." : "Password must be 6 or more characters."}</p>}
          {error && <p className="text-sm text-critical">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? "…" : tab === "login" ? "Log In" : "Sign Up"}</Button>
        </form>

        <button type="button" onClick={() => navigate("/")} className="mt-5 w-full text-center text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline">
          ← Back to the patient app
        </button>
      </div>
    </div>
  );
}
