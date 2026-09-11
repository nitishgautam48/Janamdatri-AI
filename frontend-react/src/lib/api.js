import { authHeaders } from "./storage";

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json", ...(auth ? authHeaders() : {}) };
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
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
};
