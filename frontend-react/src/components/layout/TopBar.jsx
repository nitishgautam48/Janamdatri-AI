import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { useAccessibility } from "../../context/AccessibilityContext";
import { NAV_GROUPS } from "./navLinks";

const LANGS = [
  { code: "en", key: "lang.en" },
  { code: "hi", key: "lang.hi" },
  { code: "hinglish", key: "lang.hinglish" },
];

function LangSegment() {
  const { lang, setLangDirect, t } = useLang();
  return (
    <div style={{ display: "flex", flex: "none", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLangDirect(l.code)}
          style={{
            padding: "5px 10px",
            border: 0,
            cursor: "pointer",
            fontSize: 12,
            background: lang === l.code ? "var(--color-accent-900)" : "transparent",
            color: lang === l.code ? "var(--color-accent-200)" : "var(--color-neutral-400)",
          }}
        >
          {t(l.key)}
        </button>
      ))}
    </div>
  );
}

function IconToggle({ active, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      style={{
        flex: "none",
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-neutral-700)"}`,
        background: active ? "var(--color-accent-900)" : "var(--color-surface)",
        color: active ? "var(--color-accent-300)" : "var(--color-neutral-400)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

function Avatar() {
  const { user } = useAuth();
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <NavLink
      to="/profile"
      aria-label="Profile"
      style={{
        flex: "none",
        width: 32,
        height: 32,
        borderRadius: "50%",
        border: "1px solid var(--color-neutral-700)",
        background: "var(--color-surface)",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text)",
        textDecoration: "none",
      }}
    >
      {initial}
    </NavLink>
  );
}

// Literal port of the mockup's two headers: a desktop breadcrumb bar
// (group > page, language segment, Call 108, avatar) and a mobile brand
// header (brand, language segment, avatar) - see "Janamdatri App
// v2.dc.html" lines 29-48.
export default function TopBar() {
  const { hasIdentity } = useAuth();
  const { t } = useLang();
  const { largeText, toggleLargeText, highContrast, toggleHighContrast } = useAccessibility();
  const location = useLocation();
  const headerRef = useRef(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty("--app-header-h", `${entry.target.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const curGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.to === location.pathname));
  const curItem = curGroup?.items.find((i) => i.to === location.pathname);

  if (!hasIdentity) {
    return (
      <header ref={headerRef} data-print-hide style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px 18px", flex: "none" }}>
        <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: 0, cursor: "pointer", textDecoration: "none" }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              border: "1px solid var(--color-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-accent-400)",
            }}
          >
            <i className="ph ph-heartbeat" />
          </span>
          <span style={{ fontWeight: 500, fontSize: 14, color: "var(--color-text)" }}>Janamdatri</span>
        </NavLink>
      </header>
    );
  }

  return (
    <header ref={headerRef} data-print-hide>
      {/* Desktop breadcrumb bar */}
      <div
        className="hidden lg:flex"
        style={{ alignItems: "center", gap: 12, padding: "12px 32px", borderBottom: "1px solid var(--color-neutral-900)", flex: "none" }}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden" }}>
          <span style={{ color: "var(--color-neutral-600)" }}>{curGroup ? t(curGroup.labelKey) : ""}</span>
          <i className="ph ph-caret-right" style={{ fontSize: 11, color: "var(--color-neutral-700)" }} />
          <span style={{ color: "var(--color-neutral-300)" }}>{curItem ? t(curItem.labelKey) : ""}</span>
        </div>
        <IconToggle active={largeText} onClick={toggleLargeText} label="Large text">
          Aa
        </IconToggle>
        <IconToggle active={highContrast} onClick={toggleHighContrast} label="High contrast">
          ◐
        </IconToggle>
        <LangSegment />
        <a
          href="tel:108"
          style={{
            display: "flex",
            flex: "none",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            border: "1px solid oklch(0.72 0.13 25)",
            borderRadius: 8,
            fontSize: 13,
            color: "oklch(0.87 0.07 25)",
            background: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
            textDecoration: "none",
          }}
          className="jd-call108"
        >
          <i className="ph ph-phone-call" />
          {t("common.call108")}
        </a>
        <Avatar />
      </div>

      {/* Mobile header */}
      <div className="flex lg:hidden" style={{ justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px 18px", flex: "none" }}>
        <NavLink to="/" style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: 0, cursor: "pointer", textDecoration: "none" }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              border: "1px solid var(--color-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-accent-400)",
            }}
          >
            <i className="ph ph-heartbeat" />
          </span>
          <span style={{ fontWeight: 500, fontSize: 14, color: "var(--color-text)" }}>Janamdatri</span>
        </NavLink>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <LangSegment />
          <Avatar />
        </div>
      </div>
    </header>
  );
}
