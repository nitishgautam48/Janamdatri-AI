import { createContext, useContext, useEffect, useState } from "react";

const AccessibilityContext = createContext(null);

const LARGE_TEXT_KEY = "janamdatri_large_text";
const HIGH_CONTRAST_KEY = "janamdatri_high_contrast";

// Two independent, persisted toggles applied as attributes on <html> so
// index.css can redefine the relevant tokens/sizing in one place (see
// data-text-scale and data-contrast there) rather than every component
// needing its own accessible variant.
export function AccessibilityProvider({ children }) {
  const [largeText, setLargeText] = useState(() => localStorage.getItem(LARGE_TEXT_KEY) === "true");
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem(HIGH_CONTRAST_KEY) === "true");

  useEffect(() => {
    document.documentElement.setAttribute("data-text-scale", largeText ? "large" : "normal");
    localStorage.setItem(LARGE_TEXT_KEY, String(largeText));
  }, [largeText]);

  useEffect(() => {
    document.documentElement.setAttribute("data-contrast", highContrast ? "high" : "normal");
    localStorage.setItem(HIGH_CONTRAST_KEY, String(highContrast));
  }, [highContrast]);

  const value = {
    largeText,
    toggleLargeText: () => setLargeText((v) => !v),
    highContrast,
    toggleHighContrast: () => setHighContrast((v) => !v),
  };

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error("useAccessibility must be used within AccessibilityProvider");
  return ctx;
}
