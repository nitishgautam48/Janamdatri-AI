// Backend-fixed severity enum ("Critical"/"Severe"/"Moderate"/"Mild"/"Minimal")
// - same enum-display-translation pattern as Nutrition's STATUS_LABEL_KEY and
// Wellness's CLASSIFICATION_LABEL_KEY. The raw English value stays the key
// for LEVEL_COLOR/LEVEL_TONE lookups and any backend comparison; only the
// displayed word is translated.
export const SEVERITY_LABEL_KEY = {
  Critical: "severity.critical",
  Severe: "severity.severe",
  Moderate: "severity.moderate",
  Mild: "severity.mild",
  Minimal: "severity.minimal",
};

export function severityLabel(t, level) {
  const key = SEVERITY_LABEL_KEY[level];
  return key ? t(key) : level;
}
