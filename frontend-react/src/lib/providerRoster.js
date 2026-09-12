// A provider's saved patient list lives entirely in THIS BROWSER's
// localStorage, unscoped to any patient identity (a provider has no
// account of their own - the whole point of the share-code model). This
// is deliberately NOT a new backend/auth feature: each entry is just a
// code the provider was already handed, and looking one up still only
// ever returns the one patient it belongs to via the existing, unchanged
// /provider/patient-summary endpoint. The roster is nothing more than a
// remembered list of codes plus a nickname - the same security boundary
// as before, just saving the provider from re-typing codes every visit.
const ROSTER_KEY = "janamdatri_provider_roster";

export function loadRoster() {
  try {
    return JSON.parse(localStorage.getItem(ROSTER_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRoster(roster) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
  } catch {
    /* non-fatal */
  }
}

export function addToRoster({ code, nickname, patientName }) {
  const roster = loadRoster();
  if (roster.some((r) => r.code === code)) return roster;
  const next = [...roster, { code, nickname: nickname || "", patientName, addedAt: new Date().toISOString() }];
  saveRoster(next);
  return next;
}

export function removeFromRoster(code) {
  const next = loadRoster().filter((r) => r.code !== code);
  saveRoster(next);
  return next;
}
