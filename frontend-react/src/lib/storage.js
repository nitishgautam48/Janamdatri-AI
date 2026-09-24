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

// weightAssessment carries status/diffKg/flag but never the raw weight
// value itself (see clinical_inputs.assess_weight_change) - that lives
// alongside it on the same history entry as weightInput, so this merges
// the two rather than reporting a status with no number attached.
export function lastKnownWeightAssessment() {
  const history = scopedGet(KEYS.HISTORY) || [];
  for (const entry of history) {
    if (entry.result?.weightInput != null) {
      return { ...(entry.result.weightAssessment || {}), valueKg: entry.result.weightInput, timestamp: entry.timestamp };
    }
  }
  return null;
}

export function lastKnownHemoglobinAssessment() {
  const history = scopedGet(KEYS.HISTORY) || [];
  for (const entry of history) {
    if (entry.result?.hemoglobinAssessment) return { ...entry.result.hemoglobinAssessment, timestamp: entry.timestamp };
  }
  return null;
}

// The backend already echoes back the exact vitals it was given
// (main.py's triage_result["vitalsInput"]), so this just surfaces the
// most recent one instead of re-deriving BP/blood sugar some other way.
export function lastKnownVitals() {
  const history = scopedGet(KEYS.HISTORY) || [];
  for (const entry of history) {
    if (entry.result?.vitalsInput) return { ...entry.result.vitalsInput, timestamp: entry.timestamp };
  }
  return null;
}

export function loadSavedEpds() {
  return scopedGet(KEYS.EPDS);
}

const EPDS_FOLLOWUP_DAYS = 14;

export function epdsDaysSince(savedEpds) {
  if (!savedEpds) return null;
  return Math.floor((Date.now() - new Date(savedEpds.savedAt).getTime()) / 86400000);
}

// A real follow-up loop, not a one-time score: resolves itself the moment
// the person retakes the check (which resets savedAt) rather than needing
// to be manually dismissed.
export function epdsFollowUpDue(savedEpds) {
  if (!savedEpds || savedEpds.result.classification === "Low probability") return false;
  const days = epdsDaysSince(savedEpds);
  return days != null && days >= EPDS_FOLLOWUP_DAYS;
}

export function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// A day-by-day log of which food groups (the same ids nutrition_eval.py's
// QUESTIONS already score against - no new categories invented) were
// eaten - the "meal-based input" the product spec asks for, layered on
// TOP OF rather than replacing the existing frequency questionnaire: see
// mealLogFrequencyCounts(), which turns this log into a suggested answer
// for that questionnaire instead of a second, disconnected feature.
export function loadMealLog() {
  return scopedGet(KEYS.MEAL_LOG) || {};
}

export function toggleMealLogGroup(groupId) {
  const log = loadMealLog();
  const today = todayDateStr();
  const todayGroups = new Set(log[today] || []);
  if (todayGroups.has(groupId)) todayGroups.delete(groupId);
  else todayGroups.add(groupId);
  const next = { ...log, [today]: Array.from(todayGroups) };
  scopedSet(KEYS.MEAL_LOG, next);
  return next;
}

// How many of the last N days (today inclusive) each food group was
// logged - the raw material for suggesting a frequency-questionnaire
// answer ("Regularly" if logged 5-7 of the last 7 days, etc).
export function mealLogFrequencyCounts(days = 7) {
  const log = loadMealLog();
  const counts = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const groups = log[d.toISOString().slice(0, 10)] || [];
    groups.forEach((g) => {
      counts[g] = (counts[g] || 0) + 1;
    });
  }
  return counts;
}

// "supplement"/"hydration" are the only two Today's Care tasks that mean
// something different every day, so they're the only ones that reset when
// the stored checklist date rolls over; everything else keeps its checked
// state until the task itself is no longer relevant (e.g. a visit passes).
const DAILY_RESET_TASK_IDS = new Set(["supplement", "hydration"]);

export function loadTodayCareState() {
  const raw = scopedGet(KEYS.TODAY_CARE);
  if (!raw) return { date: todayDateStr(), checked: {} };
  if (raw.date !== todayDateStr()) {
    const kept = {};
    Object.keys(raw.checked || {}).forEach((id) => {
      if (!DAILY_RESET_TASK_IDS.has(id)) kept[id] = raw.checked[id];
    });
    return { date: todayDateStr(), checked: kept };
  }
  return raw;
}

export function saveTodayCareState(state) {
  scopedSet(KEYS.TODAY_CARE, state);
}

export function addReportVitalsToHealthRecord(vitals) {
  const log = scopedGet(KEYS.REPORT_VITALS_LOG) || [];
  log.push({ timestamp: new Date().toISOString(), source: "report", ...vitals });
  scopedSet(KEYS.REPORT_VITALS_LOG, log.slice(-50));
}

// Every piece of per-identity data this app keeps client-side, for the
// Privacy Centre's export/clear controls.
const EXPORTABLE_KEYS = [
  { key: "HISTORY", label: "assessmentHistory" },
  { key: "EPDS", label: "mentalHealthCheck" },
  { key: "GUIDE", label: "pregnancyGuide" },
  { key: "NUTRITION", label: "nutritionCheck" },
  { key: "MEAL_LOG", label: "mealLog" },
  { key: "REPORT_VITALS_LOG", label: "reportVitalsLog" },
  { key: "TODAY_CARE", label: "todayCareChecklist" },
  { key: "CHAT_HISTORY", label: "chatHistory" },
];

export function collectLocalExportData() {
  const data = {};
  EXPORTABLE_KEYS.forEach(({ key, label }) => {
    const value = scopedGet(KEYS[key]);
    if (value != null) data[label] = value;
  });
  return data;
}

export function clearScopedLocalData() {
  EXPORTABLE_KEYS.forEach(({ key }) => scopedRemove(KEYS[key]));
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
  MEAL_LOG: "janamdatri_meal_log",
  CRITICAL_FOLLOWUP: "janamdatri_critical_followup",
  KICK_LOG: "janamdatri_kick_log",
  WATER_LOG: "janamdatri_water_log",
  MOOD_LOG: "janamdatri_mood_log",
  PHQ2_LOG: "janamdatri_phq2_log",
  PP_VISITS: "janamdatri_pp_visits",
  PP_VAX: "janamdatri_pp_vaccines",
};

// Fetal kick counter (Pregnancy Guide) - a simple day-by-day log of
// completed counting sessions, so a pattern is visible over time instead
// of the count resetting to nothing after every visit to the page.
export function loadKickLog() {
  return scopedGet(KEYS.KICK_LOG) || [];
}
export function appendKickLog(count, minutes) {
  const log = loadKickLog();
  const entry = { date: new Date().toISOString(), count, minutes };
  const next = [entry, ...log].slice(0, 20);
  scopedSet(KEYS.KICK_LOG, next);
  return next;
}

// Daily water-glass tracker (Nutrition) - resets when the calendar date
// changes, same pattern as loadTodayCareState's date-keyed reset.
const todayKey = () => new Date().toLocaleDateString("en-CA");
export function loadWaterState() {
  const saved = scopedGet(KEYS.WATER_LOG);
  if (saved && saved.date === todayKey()) return saved;
  return { date: todayKey(), glasses: 0 };
}
export function saveWaterState(state) {
  scopedSet(KEYS.WATER_LOG, state);
}

// Daily mood picker (Mental Wellness) - one entry per calendar day, kept
// as a short trailing history so a week-view strip can render.
export function loadMoodLog() {
  return scopedGet(KEYS.MOOD_LOG) || {};
}
export function setTodayMood(moodKey) {
  const log = loadMoodLog();
  const next = { ...log, [todayKey()]: moodKey };
  scopedSet(KEYS.MOOD_LOG, next);
  return next;
}

// PHQ-2 quick check (Mental Wellness) - a lightweight, separate check-in
// from the full EPDS-10, companion rather than replacement.
export function loadPhq2() {
  return scopedGet(KEYS.PHQ2_LOG);
}
export function savePhq2(result) {
  scopedSet(KEYS.PHQ2_LOG, { ...result, savedAt: new Date().toISOString() });
}

// ASHA home-visit checkboxes and vaccine-given checkboxes (Postpartum) -
// keyed by a stable id (e.g. day offset, or vaccine milestone id) so
// toggling one doesn't disturb the others.
export function loadPpVisits() {
  return scopedGet(KEYS.PP_VISITS) || {};
}
export function togglePpVisit(id) {
  const cur = loadPpVisits();
  const next = { ...cur, [id]: !cur[id] };
  scopedSet(KEYS.PP_VISITS, next);
  return next;
}
export function loadPpVax() {
  return scopedGet(KEYS.PP_VAX) || {};
}
export function togglePpVax(id) {
  const cur = loadPpVax();
  const next = { ...cur, [id]: !cur[id] };
  scopedSet(KEYS.PP_VAX, next);
  return next;
}

// Closes the loop after a Critical/Severe result: not just an alert at
// the moment of assessment, but a tracked, self-reported check-in on
// whether the person actually got care - keyed by that specific result's
// timestamp so a NEW critical result always asks again, and an old
// acknowledgment never silently carries over.
export function loadCriticalFollowup() {
  return scopedGet(KEYS.CRITICAL_FOLLOWUP);
}

export function acknowledgeCriticalFollowup(assessmentTimestamp, soughtCare) {
  const record = { assessmentTimestamp, soughtCare, respondedAt: new Date().toISOString() };
  scopedSet(KEYS.CRITICAL_FOLLOWUP, record);
  return record;
}
