import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { NAV_GROUPS } from "./navLinks";

// Literal port of the mockup's desktop <aside> nav: brand button, then
// grouped sections each with a small uppercase group label above its
// items - not a flat list, so the structure matches "Janamdatri App
// v2.dc.html" lines 15-25 exactly, not a reinterpretation of it.
export default function Sidebar() {
  const { hasIdentity } = useAuth();
  const { t } = useLang();
  if (!hasIdentity) return null;

  return (
    <aside
      data-print-hide
      className="hidden lg:flex"
      style={{
        width: 232,
        flex: "none",
        borderRight: "1px solid var(--color-neutral-900)",
        flexDirection: "column",
        overflowY: "auto",
        padding: "18px 12px 16px",
      }}
    >
      <NavLink
        to="/"
        style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: 0, cursor: "pointer", padding: "0 10px 18px", textDecoration: "none" }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            border: "1px solid var(--color-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-accent-400)",
            boxShadow: "0 0 14px rgba(145,132,217,0.25)",
          }}
        >
          <i className="ph ph-heartbeat" />
        </span>
        <span style={{ textAlign: "left", lineHeight: 1.2 }}>
          <span style={{ display: "block", fontWeight: 500, fontSize: 15, color: "var(--color-text)" }}>Janamdatri AI</span>
          <span style={{ display: "block", fontSize: 12, color: "var(--color-neutral-500)" }}>जन्मदात्री</span>
        </span>
      </NavLink>

      <nav style={{ display: "grid", gap: 12 }}>
        {NAV_GROUPS.map((g) => (
          <div key={g.key} style={{ display: "grid", gap: 1 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-600)", padding: "0 10px 3px" }}>
              {t(g.labelKey)}
            </div>
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                className={({ isActive }) => `jd-navlink${isActive ? " jd-navlink-active" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, border: 0, cursor: "pointer", fontSize: 14, textAlign: "left", width: "100%", textDecoration: "none" }}
              >
                <i className={`ph ${it.icon}`} style={{ fontSize: 17 }} />
                {t(it.labelKey)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
