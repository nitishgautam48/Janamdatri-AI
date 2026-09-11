import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import Button from "../ui/Button";

const PRIMARY_LINKS = [
  { to: "/", label: "nav.home" },
  { to: "/assess", label: "nav.assess" },
  { to: "/guide", label: "nav.guide" },
  { to: "/nutrition", label: "nav.nutrition" },
  { to: "/mental-wellness", label: "nav.psych" },
  { to: "/postpartum", label: "nav.postpartum" },
];

const SECONDARY_LINKS = [
  { to: "/history", label: "nav.history" },
  { to: "/reports", label: "nav.reports" },
  { to: "/profile", label: "nav.profile" },
  { to: "/help", label: "nav.help" },
  { to: "/privacy", label: "nav.privacy" },
];

function NavItem({ to, label }) {
  const { t } = useLang();
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
          isActive ? "bg-surface-hover text-ink" : "text-muted hover:text-ink"
        }`
      }
    >
      {t(label)}
    </NavLink>
  );
}

export default function TopNav() {
  const { user, hasIdentity, logout } = useAuth();
  const { lang, toggleLang, t } = useLang();
  const headerRef = useRef(null);

  // The chat widget anchors itself below this header (see ChatWidget's
  // use of --app-header-h) instead of a hardcoded pixel offset - the
  // header's real height changes (one row for a guest/logged-out visitor,
  // two rows once the nav row appears, and could change again later), and
  // a hardcoded offset is exactly the bug this rewrite was asked to fix.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty("--app-header-h", `${entry.target.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The nav gets its own full-width row rather than sharing the brand/
  // account row - cramming every link into one row alongside the account
  // area and Call 108 button meant links silently overflowed off-screen
  // with no scroll affordance once there were more than a handful of them.
  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-8">
        <NavLink to="/" className="flex items-center gap-2 shrink-0">
          <span className="text-2xl leading-none">🤰</span>
          <span className="hidden flex-col leading-tight sm:flex">
            <strong className="text-sm font-bold text-ink">Janamdatri AI</strong>
            <span className="eyebrow normal-case tracking-normal text-[11px]">{t("tagline")}</span>
          </span>
        </NavLink>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLang}
            className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            {lang === "en" ? "हिंदी" : "English"}
          </button>
          {user && (
            <>
              <span className="hidden max-w-[140px] truncate text-sm text-muted md:inline">Hi, {user.name || user.email.split("@")[0]}</span>
              <Button variant="ghost" onClick={logout}>
                {t("common.logout")}
              </Button>
            </>
          )}
          <a
            href="tel:108"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-critical px-4 py-2 text-sm font-bold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-critical/90"
          >
            🚨 {t("common.call108")}
          </a>
        </div>
      </div>

      {hasIdentity && (
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 lg:px-8">
          {PRIMARY_LINKS.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
          <span className="mx-2 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          {SECONDARY_LINKS.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
        </nav>
      )}
    </header>
  );
}
