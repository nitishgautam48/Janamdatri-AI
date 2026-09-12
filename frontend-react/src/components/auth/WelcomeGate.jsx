import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import Button from "../ui/Button";
import Pill from "../ui/Pill";

export default function WelcomeGate() {
  const { login, register, continueAsGuest } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (tab === "login") await login(form.email, form.password);
      else await register(form.email, form.password, form.name || null);
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
          <div className="mb-3 flex justify-center">
            <Pill tone="primary">WELCOME</Pill>
          </div>
          <span className="text-4xl">🤰</span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink">{t("welcome.title")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("welcome.tagline")}</p>
        </div>

        <div className="mb-6 flex rounded-full border border-border-strong p-1">
          {["login", "signup"].map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
                tab === tb ? "bg-primary text-paper-ink" : "text-muted hover:text-ink"
              }`}
            >
              {tb === "login" ? t("welcome.login") : t("welcome.signup")}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {tab === "signup" && (
            <input
              aria-label="Name (optional)"
              placeholder="Name (optional)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
            />
          )}
          <input
            type="email"
            required
            aria-label="Email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
          <input
            type="password"
            required
            aria-label="Password"
            minLength={tab === "signup" ? 6 : undefined}
            placeholder={tab === "signup" ? "Password (min 6 characters)" : "Password"}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-full rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none"
          />
          {error && <p className="text-sm text-critical">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "…" : tab === "login" ? t("welcome.login") : t("welcome.signup")}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="ghost" onClick={continueAsGuest} className="w-full">
          {t("welcome.guest")}
        </Button>
        <p className="mt-3 text-center text-xs leading-relaxed text-faint">{t("welcome.guestNote")}</p>

        <button
          type="button"
          onClick={() => navigate("/provider")}
          className="mt-5 w-full text-center text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          👩‍⚕️ {t("welcome.providerLink")}
        </button>
        <button
          type="button"
          onClick={() => navigate("/caregiver")}
          className="mt-2 w-full text-center text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          👪 I'm a family member with a share code →
        </button>
      </div>
    </div>
  );
}
