// Every piece of per-identity data is namespaced by the current user (or
// "guest") so nothing a previous account entered on this browser ever
// leaks into a different account or into guest mode - the same rule the
// original vanilla-JS frontend enforced (its own scopedKey helper).
const TOKEN_KEY = "janamdatri_token";
const USER_KEY = "janamdatri_user";
const GUEST_KEY = "janamdatri_guest";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function isGuest() {
  return !!localStorage.getItem(GUEST_KEY);
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.removeItem(GUEST_KEY);
}

export function setGuest() {
  localStorage.setItem(GUEST_KEY, "true");
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function authHeaders() {
  const token = getToken();
  return token ? { "x-user-token": token } : {};
}

function identityId() {
  const user = getSavedUser();
  if (user && getToken()) return `user_${user.id}`;
  return "guest";
}

// Matches the vanilla-JS app's own scopedKey format exactly (baseKey +
// "::" + scopeId) so a person's existing history/guide/profile data is
// still there when they land on this new frontend, not seemingly lost.
export function scopedKey(base) {
  return `${base}::${identityId()}`;
}

export function scopedGet(base) {
  try {
    return JSON.parse(localStorage.getItem(scopedKey(base)));
  } catch {
    return null;
  }
}

export function scopedSet(base, value) {
  try {
    localStorage.setItem(scopedKey(base), JSON.stringify(value));
  } catch {
    /* non-fatal */
  }
}

export function scopedRemove(base) {
  try {
    localStorage.removeItem(scopedKey(base));
  } catch {
    /* non-fatal */
  }
}

const MAX_HISTORY = 20;

// Mirrors the vanilla-JS app's saveToHistory() - always written locally
// even for a logged-in account (whose real history lives server-side),
// since local history is also what a few features fall back to reading
// synchronously (e.g. the last known weight below) without an extra
// network round trip.
export function appendHistoryEntry(result) {
  const history = scopedGet(KEYS.HISTORY) || [];
  history.unshift({ timestamp: new Date().toISOString(), severityLevel: result.severity.level, mri: result.mri, result });
  scopedSet(KEYS.HISTORY, history.slice(0, MAX_HISTORY));
}

export function lastKnownHemoglobin() {
  const history = scopedGet(KEYS.HISTORY) || [];
  for (const entry of history) {
    const hb = entry.result && entry.result.hemoglobinAssessment;
    if (hb) return hb.hemoglobin;
  }
  return null;
}

export function lastKnownWeight() {
  const history = scopedGet(KEYS.HISTORY) || [];
  for (const entry of history) {
    if (entry.result && entry.result.weightInput != null) return entry.result.weightInput;
  }
  return null;
}

export function loadSavedEpds() {
  return scopedGet(KEYS.EPDS);
}

export const KEYS = {
  HISTORY: "janamdatri_history",
  GUIDE: "janamdatri_last_guide",
  POSTPARTUM_GUIDE: "janamdatri_postpartum_guide",
  NUTRITION: "janamdatri_last_nutrition",
  EPDS: "janamdatri_last_epds",
  TODAY_CARE: "janamdatri_today_care",
  PROFILE_EXTRA: "janamdatri_pregnancy_profile_extra",
  CHAT_HISTORY: "janamdatri_chat",
  REPORT_VITALS_LOG: "janamdatri_report_vitals_log",
};
