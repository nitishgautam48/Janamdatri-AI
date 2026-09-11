import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLang } from "../../context/LangContext";
import { PRIMARY_LINKS, MORE_LINKS } from "./navLinks";

// Mobile-only tab bar (Home | Health | Nutrition | Reports | Profile) with
// a "More" tab opening a bottom sheet for the remaining sections. Hidden
// at the lg breakpoint, where Sidebar takes over navigation instead.
export default function BottomNav() {
  const { hasIdentity } = useAuth();
  const { t } = useLang();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!hasIdentity) return null;

  const tabClass = ({ isActive }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
      isActive ? "text-primary" : "text-muted"
    }`;

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-x-0 bottom-0 rounded-t-lg bg-surface p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-xl"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
            <div className="grid grid-cols-3 gap-2">
              {MORE_LINKS.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 rounded-md px-2 py-3 text-xs font-medium ${
                      isActive ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-hover hover:text-ink"
                    }`
                  }
                >
                  <span className="text-xl">{l.icon}</span>
                  {t(l.label)}
                </NavLink>
              ))}
            </div>
            <a
              href="tel:108"
              className="mt-3 flex items-center justify-center gap-2 rounded-full bg-critical px-4 py-3 text-sm font-bold text-white"
            >
              🚨 {t("common.call108")}
            </a>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {PRIMARY_LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={tabClass} end={l.to === "/"}>
            <span className="text-lg leading-none">{l.icon}</span>
            {t(l.label)}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted"
        >
          <span className="text-lg leading-none">⋯</span>
          {t("nav.more")}
        </button>
      </nav>
    </>
  );
}
