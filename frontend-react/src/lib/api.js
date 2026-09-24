import { authHeaders, clearSession, getToken } from "./storage";

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json", ...(auth ? authHeaders() : {}) };
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // fetch() itself throws (rather than resolving with a response) when
    // there's no network path to the server at all - offline, DNS
    // failure, the connection dropping mid-request. Tagged distinctly
    // from a normal HTTP error below so callers (the Assessment submit
    // path in particular, for rural/poor-connectivity use) can tell "the
    // server said no" apart from "we couldn't reach it" and react
    // differently - retry automatically instead of just showing an error.
    const offlineErr = new Error("You appear to be offline. Please check your connection and try again.");
    offlineErr.isNetworkError = true;
    throw offlineErr;
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 401 on an authenticated call means the token this browser is
    // holding no longer resolves to a session server-side (expired, or -
    // on a host with an ephemeral filesystem - the account database itself
    // reset since the token was issued). Left alone, the UI stays stuck
    // "logged in" with a token that will never work again, so every
    // authenticated action from here on fails the same silent way. Clear
    // it and tell the rest of the app to drop back to a clean logged-out
    // state instead of leaving that stale, unrecoverable state in place.
    if (res.status === 401 && auth && getToken()) {
      clearSession();
      window.dispatchEvent(new Event("auth:expired"));
    }
    throw new Error(payload.detail || `Request to ${path} failed (${res.status}).`);
  }
  return payload.data;
}

export const api = {
  register: (email, password, name) => request("/auth/register", { method: "POST", body: { email, password, name } }),
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  me: () => request("/auth/me", { auth: true }),
  deleteAccount: () => request("/auth/account", { method: "DELETE", auth: true }),

  createShareCode: () => request("/auth/share-code", { method: "POST", auth: true }),
  getShareCode: () => request("/auth/share-code", { auth: true }),
  revokeShareCode: () => request("/auth/share-code", { method: "DELETE", auth: true }),
  providerSummary: (code) => request(`/provider/patient-summary?code=${encodeURIComponent(code)}`),

  assess: (body) => request("/assess", { method: "POST", body, auth: true }),
  assessmentsMine: () => request("/assessments/mine", { auth: true }),

  psychAssessItems: () => request("/psych-assess/items"),
  psychAssess: (responses) => request("/psych-assess", { method: "POST", body: { responses } }),

  pregnancyGuide: (body) => request("/pregnancy-guide", { method: "POST", body }),
  postpartumGuide: (deliveryDate) => request("/postpartum-guide", { method: "POST", body: { deliveryDate } }),

  nutritionItems: () => request("/nutrition/items"),
  nutritionAssess: (body) => request("/nutrition-assess", { method: "POST", body, auth: true }),
  nutritionChecksMine: () => request("/nutrition-checks/mine", { auth: true }),

  chat: (body) => request("/chat", { method: "POST", body }),

  helplines: () => request("/helplines"),

  nearbyFacilities: (lat, lon) => request("/gis/nearby-facilities", { method: "POST", body: { lat, lon } }),
  geocodePlace: (q) => request(`/gis/geocode?q=${encodeURIComponent(q)}`),

  async analyzeDocument(formData) {
    const res = await fetch("/documents/analyze", { method: "POST", body: formData });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.detail || "Could not analyze this report.");
    return payload.data;
  },
};
