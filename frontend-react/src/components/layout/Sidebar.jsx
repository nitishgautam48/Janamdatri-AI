import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { ALL_LINKS } from "./navLinks";

export default function Sidebar() {
  const { hasIdentity } = useAuth();
  const { t } = useLang();
  if (!hasIdentity) return null;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
      <NavLink to="/" className="mb-6 flex items-center gap-2 px-2">
        <span className="text-2xl leading-none">🤰</span>
        <div className="flex flex-col leading-tight">
          <strong className="text-sm font-bold text-ink">Janamdatri AI</strong>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">Maternal Health Command Centre</span>
        </div>
      </NavLink>

      <nav className="flex flex-1 flex-col gap-0.5">
        {ALL_LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-hover hover:text-ink"
              }`
            }
          >
            <span className="text-base">{l.icon}</span>
            {t(l.label)}
          </NavLink>
        ))}
      </nav>

      <a
        href="tel:108"
        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-critical px-4 py-2.5 text-sm font-bold text-white hover:bg-critical/90"
      >
        🚨 {t("common.call108")}
      </a>
    </aside>
  );
}
