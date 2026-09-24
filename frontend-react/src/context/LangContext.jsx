import { createContext, useContext, useMemo, useState } from "react";
import { LANG_KEY, LANG_CYCLE, LANG_LABELS, translations } from "../lib/i18n";

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return LANG_CYCLE.includes(saved) ? saved : "en";
  });

  const value = useMemo(() => {
    const dict = translations[lang] || translations.en;
    return {
      lang,
      // Cycles en -> hi -> hinglish -> en, so the existing single toggle
      // button reaches all three without adding a picker UI.
      toggleLang: () => {
        const next = LANG_CYCLE[(LANG_CYCLE.indexOf(lang) + 1) % LANG_CYCLE.length];
        localStorage.setItem(LANG_KEY, next);
        setLang(next);
      },
      nextLangLabel: LANG_LABELS[LANG_CYCLE[(LANG_CYCLE.indexOf(lang) + 1) % LANG_CYCLE.length]],
      // Direct 3-way picker (the mockup's segmented EN/HI/Hinglish control),
      // alongside the single-button cycle above which some callers still use.
      setLangDirect: (code) => {
        if (!LANG_CYCLE.includes(code)) return;
        localStorage.setItem(LANG_KEY, code);
        setLang(code);
      },
      t: (key) => dict[key] ?? translations.en[key] ?? key,
    };
  }, [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}
