import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import Button from "../ui/Button";
import Pill from "../ui/Pill";

const LANGS = [
  { code: "en", key: "lang.en" },
  { code: "hi", key: "lang.hi" },
  { code: "hinglish", key: "lang.hinglish" },
];

const ROLES = [
  { icon: "ph-stethoscope", labelKey: "welcome.roleProvider", linkKey: "welcome.providerLink", to: "/provider" },
  { icon: "ph-users-three", labelKey: "welcome.roleCaregiver", linkKey: "welcome.caregiverLink", to: "/caregiver" },
  { icon: "ph-headset", labelKey: "welcome.roleCounsellor", linkKey: "welcome.counsellorLink", to: "/care-team" },
];

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function WelcomeGate() {
  const { login, register, continueAsGuest } = useAuth();
  const { lang, setLangDirect, t } = useLang();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [showPw, setShowPw] = useState(false);
  // Touched fields get validated live (on blur, and as you keep typing once
  // touched) instead of only after a failed submit - so a typo in the email
  // is flagged, or a long-enough password is confirmed, while you're still
  // filling the form rather than after you hit the button.
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailValid = EMAIL_RE.test(form.email);
  const pwValid = form.password.length >= 6;
  const fieldError = touched.email && form.email && !emailValid
    ? "email"
    : touched.password && form.password && !pwValid
      ? "pw"
      : null;

  async function doSubmit() {
    setError("");
    setIsOffline(false);
    setTouched({ email: true, password: true });
    if (!emailValid || !pwValid) return;
    setBusy(true);
    try {
      if (tab === "login") await login(form.email, form.password);
      else await register(form.email, form.password, form.name || null, "patient");
    } catch (err) {
      // Mirrors the offline handling in lib/api.js/AssessPage: a login
      // can't be queued for later like an assessment can (there's nothing
      // useful to do with a password offline), but the user should still
      // see a localized "you're offline" message rather than api.js's
      // hardcoded English one, with an easy way to retry once they're back.
      if (err.isNetworkError) {
        setIsOffline(true);
        setError(t("welcome.offline"));
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    doSubmit();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-soft px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8 shadow-xl shadow-black/5">
        <div className="mb-6 flex items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Language" style={{ display: "flex", border: "1px solid var(--color-border)", borderRadius: 99, overflow: "hidden", padding: 2, gap: 2 }}>
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                role="radio"
                aria-checked={lang === l.code}
                onClick={() => setLangDirect(l.code)}
                style={{
                  padding: "7px 14px", minHeight: 36, border: 0, borderRadius: 99, cursor: "pointer", fontSize: 13,
                  background: lang === l.code ? "var(--color-primary-soft)" : "transparent",
                  color: lang === l.code ? "var(--color-primary)" : "var(--color-muted)",
                }}
              >
                {t(l.key)}
              </button>
            ))}
          </div>
          <i className="ph ph-translate" style={{ fontSize: 18, color: "var(--color-faint)" }} aria-hidden="true" />
        </div>

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
              onClick={() => { setTab(tb); setTouched({ email: false, password: false }); setError(""); setIsOffline(false); }}
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
            <div className="field">
              <label htmlFor="welcome-name">{t("welcome.name")} <span style={{ color: "var(--color-faint)" }}>{t("welcome.optional")}</span></label>
              <input
                id="welcome-name"
                aria-label="Name (optional)"
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-border-strong bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
                style={{ height: 44 }}
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="welcome-email">{t("welcome.email")}</label>
            <input
              id="welcome-email"
              type="email"
              required
              autoComplete="email"
              aria-label="Email"
              placeholder="name@example.com"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              onBlur={() => setTouched((t2) => ({ ...t2, email: true }))}
              className="w-full rounded-md border bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/25"
              style={{
                height: 44,
                borderColor: fieldError === "email" ? "var(--color-critical)"
                  : touched.email && emailValid ? "var(--color-good)"
                    : "var(--color-border-strong)",
              }}
            />
            {touched.email && emailValid && (
              <p style={{ fontSize: 12, color: "var(--color-good)", display: "flex", gap: 5, alignItems: "center", marginTop: 4 }}>
                <i className="ph ph-check-circle" />{t("welcome.emailValid")}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="welcome-password">{t("welcome.password")}</label>
            <div style={{ position: "relative" }}>
              <input
                id="welcome-password"
                type={showPw ? "text" : "password"}
                required
                autoComplete="current-password"
                aria-label="Password"
                minLength={tab === "signup" ? 6 : undefined}
                placeholder={tab === "signup" ? "Password (min 6 characters)" : "Password"}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                onBlur={() => setTouched((t2) => ({ ...t2, password: true }))}
                className="w-full rounded-md border bg-bg px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/25"
                style={{
                  height: 44, width: "100%", paddingRight: 44,
                  borderColor: fieldError === "pw" ? "var(--color-critical)"
                    : touched.password && pwValid ? "var(--color-good)"
                      : "var(--color-border-strong)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={t("welcome.showPassword")}
                style={{ position: "absolute", right: 2, top: 2, width: 40, height: 40, border: 0, background: "none", cursor: "pointer", color: "var(--color-muted)" }}
              >
                <i className={`ph ${showPw ? "ph-eye-slash" : "ph-eye"}`} style={{ fontSize: 18 }} />
              </button>
            </div>
            {touched.password && pwValid && (
              <p style={{ fontSize: 12, color: "var(--color-good)", display: "flex", gap: 5, alignItems: "center", marginTop: 4 }}>
                <i className="ph ph-check-circle" />{t("welcome.pwHintOk")}
              </p>
            )}
          </div>
          {fieldError && (
            <p style={{ fontSize: 13, color: "var(--color-critical)", display: "flex", gap: 6, alignItems: "center" }}>
              <i className="ph ph-warning-circle" />{fieldError === "email" ? t("welcome.errEmail") : t("welcome.errPassword")}
            </p>
          )}
          {error && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ fontSize: 13, color: "var(--color-critical)", display: "flex", gap: 6, alignItems: "center" }}>
                <i className={`ph ${isOffline ? "ph-wifi-slash" : "ph-warning-circle"}`} />{error}
              </p>
              {isOffline && (
                <button
                  type="button"
                  onClick={doSubmit}
                  disabled={busy}
                  style={{
                    alignSelf: "flex-start", fontSize: 13, fontWeight: 600, color: "var(--color-primary)",
                    background: "none", border: 0, cursor: "pointer", padding: 0,
                  }}
                >
                  {t("welcome.retry")}
                </button>
              )}
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "…" : tab === "login" ? t("welcome.login") : t("welcome.signup")}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-border" />
          {t("welcome.or")}
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="ghost" onClick={continueAsGuest} className="w-full">
          {t("welcome.guest")}
        </Button>
        <p className="mt-3 text-center text-xs leading-relaxed text-faint">{t("welcome.guestNote")}</p>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 8, background: "rgba(233,233,237,0.03)", boxShadow: "0 0 0 1px rgba(233,233,237,0.08)", marginTop: 16 }}>
          <i className="ph ph-shield-check" style={{ fontSize: 18, color: "var(--color-muted)", marginTop: 1 }} />
          <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45, color: "var(--color-muted)" }}>
            {t("welcome.safety")} <a href="tel:108" style={{ color: "oklch(0.85 0.08 25)", whiteSpace: "nowrap" }}>{t("welcome.call108")}</a>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: "var(--color-faint)" }}>{t("welcome.notPatient")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
            {ROLES.map((r) => (
              <button
                key={r.to}
                type="button"
                title={t(r.linkKey)}
                onClick={() => navigate(r.to)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", minHeight: 44,
                  borderRadius: 8, border: "1px solid var(--color-border)", background: "none", cursor: "pointer",
                  textAlign: "left", fontSize: 13, color: "var(--color-neutral-300, var(--color-ink))",
                }}
              >
                <i className={`ph ${r.icon}`} style={{ fontSize: 17, color: "var(--color-primary)", flex: "none" }} />
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>{t(r.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
