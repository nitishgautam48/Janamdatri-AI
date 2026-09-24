import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { NAV_GROUPS, MOBILE_TABS } from "./navLinks";

// Literal port of the mockup's mobile bottom tab bar + "More" bottom
// sheet (Janamdatri App v2.dc.html lines 463-477): 5-column tab row, and
// a sheet that renders the SAME grouped navGroups structure as the
// desktop sidebar (grouped sections, each a 3-column icon grid) rather
// than one flat grid of "more" links.
export default function BottomNav() {
  const { hasIdentity } = useAuth();
  const { t } = useLang();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!hasIdentity) return null;

  const isTabActive = (to) => (to === "/" ? location.pathname === "/" : location.pathname.startsWith(to));

  return (
    <>
      {moreOpen && (
        <div
          data-print-hide
          onClick={() => setMoreOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(16,18,28,0.72)", zIndex: 50, display: "flex", alignItems: "flex-end" }}
          className="lg:hidden"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "var(--color-surface)",
              borderRadius: "20px 20px 0 0",
              padding: "10px 16px calc(24px + env(safe-area-inset-bottom))",
              display: "grid",
              gap: 14,
              boxShadow: "var(--shadow-lg)",
              maxHeight: "85%",
              overflowY: "auto",
            }}
          >
            <div style={{ justifySelf: "center", width: 36, height: 4, borderRadius: 2, background: "var(--color-neutral-700)" }} />
            {NAV_GROUPS.map((g) => (
              <div key={g.key} style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>{t(g.labelKey)}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                  {g.items.map((it) => {
                    const active = isTabActive(it.to);
                    return (
                      <NavLink
                        key={it.to}
                        to={it.to}
                        end={it.to === "/"}
                        onClick={() => setMoreOpen(false)}
                        style={{
                          display: "grid",
                          justifyItems: "center",
                          gap: 4,
                          padding: "12px 4px",
                          borderRadius: 12,
                          border: `1px solid ${active ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
                          background: active ? "var(--color-accent-900)" : "transparent",
                          color: active ? "var(--color-accent-200)" : "var(--color-neutral-400)",
                          cursor: "pointer",
                          fontSize: 12,
                          minHeight: 72,
                          textDecoration: "none",
                        }}
                      >
                        <i className={`ph ${it.icon}`} style={{ fontSize: 22 }} />
                        {t(it.labelKey)}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav
        data-print-hide
        className="lg:hidden"
        style={{
          position: "fixed",
          insetInline: 0,
          bottom: 0,
          zIndex: 40,
          display: "grid",
          gridTemplateColumns: "repeat(5,1fr)",
          borderTop: "1px solid var(--color-neutral-900)",
          padding: "6px 6px calc(14px + env(safe-area-inset-bottom))",
          background: "var(--color-bg)",
        }}
      >
        {MOBILE_TABS.map((it) => {
          const active = isTabActive(it.to);
          return (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === "/"}
              style={{
                display: "grid",
                justifyItems: "center",
                gap: 2,
                padding: "6px 0",
                minHeight: 48,
                background: "none",
                border: 0,
                cursor: "pointer",
                fontSize: 11,
                color: active ? "var(--color-accent-400)" : "var(--color-neutral-500)",
                textDecoration: "none",
              }}
            >
              <i className={`ph ${it.icon}`} style={{ fontSize: 22 }} />
              {t(it.labelKey)}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          style={{
            display: "grid",
            justifyItems: "center",
            gap: 2,
            padding: "6px 0",
            minHeight: 48,
            background: "none",
            border: 0,
            cursor: "pointer",
            fontSize: 11,
            color: "var(--color-neutral-500)",
          }}
        >
          <i className="ph ph-dots-three" style={{ fontSize: 22 }} />
          {t("nav.more")}
        </button>
      </nav>
    </>
  );
}
