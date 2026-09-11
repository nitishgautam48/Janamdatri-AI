import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import Button from "../ui/Button";

// Utility-only top bar: brand, language toggle, user/logout, Call 108.
// Navigation itself now lives in Sidebar (desktop) and BottomNav (mobile)
// so this header no longer carries a links row.
export default function TopBar() {
  const { user, logout } = useAuth();
  const { lang, toggleLang, t } = useLang();
  const headerRef = useRef(null);

  // The chat widget anchors itself below this header (see ChatWidget's
  // use of --app-header-h) instead of a hardcoded pixel offset - the
  // header's real height can change (e.g. name truncation, a future
  // extra row), and a hardcoded offset is exactly the bug this rewrite
  // was asked to fix.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty("--app-header-h", `${entry.target.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-8">
        <NavLink to="/" className="flex items-center gap-2 shrink-0 lg:hidden">
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
    </header>
  );
}
