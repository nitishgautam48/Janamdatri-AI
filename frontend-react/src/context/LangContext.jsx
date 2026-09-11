import { createContext, useContext, useMemo, useState } from "react";
import { LANG_KEY, translations } from "../lib/i18n";

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || "en");

  const value = useMemo(() => {
    const dict = translations[lang] || translations.en;
    return {
      lang,
      toggleLang: () => {
        const next = lang === "en" ? "hi" : "en";
        localStorage.setItem(LANG_KEY, next);
        setLang(next);
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
