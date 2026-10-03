import { authHeaders, clearSession, getOrCreateGuestChatId, getToken } from "./storage";

async function request(path, { method = "GET", body, auth = false, guestFallback = false } = {}) {
  const headers = { "Content-Type": "application/json", ...(auth ? authHeaders() : {}) };
  // A live-chat call identifies the caller by x-user-token when logged
  // in, or x-guest-id otherwise - never both, and never neither, since
  // the backend needs exactly one way to know whose conversation this is.
  if (guestFallback && !headers["x-user-token"]) headers["x-guest-id"] = getOrCreateGuestChatId();
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
  register: (email, password, name, role, inviteCode) => request("/auth/register", { method: "POST", body: { email, password, name, role, inviteCode } }),
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
  psychAssess: (responses, language) => request("/psych-assess", { method: "POST", body: { responses, language } }),

  pregnancyGuide: (body) => request("/pregnancy-guide", { method: "POST", body }),
  postpartumGuide: (deliveryDate) => request("/postpartum-guide", { method: "POST", body: { deliveryDate } }),

  nutritionItems: () => request("/nutrition/items"),
  nutritionAssess: (body) => request("/nutrition-assess", { method: "POST", body, auth: true }),
  nutritionChecksMine: () => request("/nutrition-checks/mine", { auth: true }),

  // auth:true so a logged-in patient's danger-sign escalations (and saved
  // chat history) are correctly tied to their account instead of always
  // looking like an anonymous guest - previously missing here, so every
  // escalation from this endpoint landed in the queue as "Guest" regardless
  // of login state. Guests still identify via the body's own guestId field
  // (the /chat endpoint reads that, not the x-guest-id header).
  chat: (body) => request("/chat", { method: "POST", body: { ...body, guestId: getOrCreateGuestChatId() }, auth: true }),

  helplines: () => request("/helplines"),

  // --- Self-hosted speech-to-text (see src/stt.py) ---
  sttStatus: () => request("/stt/status"),
  transcribeAudio: async (blob) => {
    const form = new FormData();
    form.append("file", blob, "voice.webm");
    // Not routed through request() - that helper always JSON-encodes the
    // body, and a multipart upload needs the browser to set its own
    // Content-Type (with the multipart boundary) instead.
    const res = await fetch("/stt/transcribe", { method: "POST", body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.detail || `Transcription failed (${res.status}).`);
    return payload.data;
  },

  // --- Live counsellor chat: patient side ---
  liveStart: (body) => request("/live/start", { method: "POST", body: body || {}, auth: true, guestFallback: true }),
  liveMine: () => request("/live/mine", { auth: true, guestFallback: true }),
  liveGet: (id) => request(`/live/${id}`, { auth: true, guestFallback: true }),
  liveSend: (id, text) => request(`/live/${id}/messages`, { method: "POST", body: { text }, auth: true, guestFallback: true }),
  liveSendVoiceNote: (id, voiceNoteId, text) => request(`/live/${id}/messages`, { method: "POST", body: { text, voiceNoteId }, auth: true, guestFallback: true }),
  liveCancel: (id) => request(`/live/${id}/cancel`, { method: "POST", body: {}, auth: true, guestFallback: true }),

  // Voice notes (record -> preview -> send-or-discard, see src/live_chat.py).
  // Not routed through request() - a multipart upload needs the browser
  // to set its own Content-Type with the boundary, same reason
  // transcribeAudio isn't either.
  liveVoiceNoteUpload: async (convId, blob) => {
    const form = new FormData();
    form.append("file", blob, "voice-note.webm");
    const headers = authHeaders();
    if (!headers["x-user-token"]) headers["x-guest-id"] = getOrCreateGuestChatId();
    const res = await fetch(`/live/${convId}/voice-note`, { method: "POST", headers, body: form });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.detail || "Could not upload the voice note.");
    return payload.data;
  },
  liveVoiceNoteDiscard: (convId, noteId) => request(`/live/${convId}/voice-note/${noteId}`, { method: "DELETE", auth: true, guestFallback: true }),

  // --- Live counsellor chat: counsellor side ---
  counsellorDuty: (onDuty) => request("/counsellor/duty", { method: "POST", body: { onDuty }, auth: true }),
  counsellorQueue: () => request("/counsellor/queue", { auth: true }),
  counsellorMine: () => request("/counsellor/mine", { auth: true }),
  counsellorConversation: (id) => request(`/counsellor/${id}`, { auth: true }),
  counsellorClaim: (id) => request(`/counsellor/${id}/claim`, { method: "POST", auth: true }),
  counsellorSend: (id, text) => request(`/counsellor/${id}/messages`, { method: "POST", body: { text }, auth: true }),
  counsellorResolve: (id, outcome, note) => request(`/counsellor/${id}/resolve`, { method: "POST", body: { outcome, note }, auth: true }),
  counsellorHandoff: (id, note, urgency) => request(`/counsellor/${id}/handoff`, { method: "POST", body: { note, urgency }, auth: true }),

  // --- Forwarded-case queue: doctor side ---
  doctorQueue: (reviewed) => request(`/doctor/queue?reviewed=${reviewed ? "true" : "false"}`, { auth: true }),
  doctorConversation: (id) => request(`/doctor/${id}`, { auth: true }),
  doctorAdvice: (id, advice) => request(`/doctor/${id}/advice`, { method: "POST", body: { advice }, auth: true }),

  nearbyFacilities: (lat, lon) => request("/gis/nearby-facilities", { method: "POST", body: { lat, lon } }),
  geocodePlace: (q) => request(`/gis/geocode?q=${encodeURIComponent(q)}`),

  async analyzeDocument(formData) {
    const res = await fetch("/documents/analyze", { method: "POST", body: formData });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.detail || "Could not analyze this report.");
    return payload.data;
  },
};
