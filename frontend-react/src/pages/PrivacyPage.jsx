import { useEffect, useState } from "react";
import Spinner from "../components/ui/Spinner";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { clearScopedLocalData, collectLocalExportData, getToken } from "../lib/storage";

function InfoCard({ title, children }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8, boxShadow: "var(--shadow-sm)" }}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>{title}</h3>
      {children}
    </div>
  );
}

export default function PrivacyPage() {
  const { user, logout } = useAuth();
  const [controlsNote, setControlsNote] = useState("");
  const [shareCode, setShareCode] = useState(null);
  const [shareCodeNote, setShareCodeNote] = useState("");
  const [shareCodeError, setShareCodeError] = useState(false);
  const [shareCodeLoaded, setShareCodeLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.getShareCode().then((data) => {
      setShareCode(data.code);
      setShareCodeLoaded(true);
    }).catch(() => setShareCodeLoaded(true));
  }, [user]);

  async function handleExport() {
    setControlsNote("Preparing your export…");
    const exportPayload = { exportedAt: new Date().toISOString(), local: collectLocalExportData() };

    if (getToken()) {
      try {
        const [assessments, nutritionChecks] = await Promise.all([
          api.assessmentsMine().catch(() => null),
          api.nutritionChecksMine().catch(() => null),
        ]);
        if (assessments) exportPayload.serverAssessments = assessments.assessments;
        if (nutritionChecks) exportPayload.serverNutritionChecks = nutritionChecks.checks;
      } catch {
        /* export whatever we have locally even if the server calls fail */
      }
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `janamdatri-my-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setControlsNote("Export downloaded.");
  }

  function handleClearLocal() {
    if (!window.confirm("This will erase your local assessment history, nutrition checks, chat, and checklist data on this device (your account itself, if you have one, is not deleted). Continue?")) return;
    clearScopedLocalData();
    setControlsNote("Local data cleared on this device.");
  }

  async function handleDeleteAccount() {
    if (!window.confirm("This will PERMANENTLY delete your account and everything tied to it on our server - assessments, chat messages, nutrition checks. This cannot be undone. Continue?")) return;
    try {
      await api.deleteAccount();
      clearScopedLocalData();
      logout();
      setControlsNote("");
    } catch (err) {
      setControlsNote(err.message);
    }
  }

  async function handleGenerateCode() {
    setShareCodeNote("");
    setShareCodeError(false);
    try {
      const data = await api.createShareCode();
      setShareCode(data.code);
      setShareCodeNote("New code generated - any earlier code you had no longer works.");
    } catch (err) {
      setShareCodeNote(err.message);
      setShareCodeError(true);
    }
  }

  async function handleRevokeCode() {
    setShareCodeNote("");
    setShareCodeError(false);
    try {
      await api.revokeShareCode();
      setShareCode(null);
      setShareCodeNote("Access revoked.");
    } catch (err) {
      setShareCodeNote(err.message);
      setShareCodeError(true);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, padding: "14px 16px", borderRadius: 14, border: "1px solid var(--color-accent-800)", background: "var(--color-accent-900)" }}>
          <i className="ph ph-shield-check" style={{ fontSize: "1.5rem", color: "var(--color-accent-300)", flex: "none" }} />
          <div style={{ fontSize: "0.875rem", lineHeight: 1.5, color: "var(--color-accent-100)" }}>
            What Janamdatri AI collects, why, who can see it, and how to export or delete it.
          </div>
        </div>

        <InfoCard title="What data is collected">
          <ul className="list-inside list-disc space-y-1" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <li>Assessment inputs you enter: vitals, symptom text, hemoglobin, and history flags</li>
            <li>Your Mental Health Check (EPDS) responses and score</li>
            <li>Your Nutrition Analysis questionnaire responses and results</li>
            <li>Messages you send to the Instant Help chat</li>
            <li>Text from any report/prescription you upload or paste (only while being analyzed - see below)</li>
            <li>Your name and email, only if you create an account</li>
          </ul>
        </InfoCard>

        <InfoCard title="Why it's collected">
          <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>
            Solely to compute your risk screening, nutrition, and mental-health results, and - if you choose to
            create an account - to show your own history and trends back to you across visits. Nothing here is used
            for advertising, and nothing is sold or shared with third parties.
          </p>
        </InfoCard>

        <InfoCard title="Who can access it">
          <ul className="list-inside list-disc space-y-1.5" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <li>Guest mode: your inputs are sent to our server only to compute a result, then the result is saved ONLY in your own browser (localStorage) - we do not keep guest data in our database at all.</li>
            <li>A logged-in account: your assessments, chat messages, and nutrition checks ARE stored in our database, tied to your account, so you can see them across visits/devices. Only your own account (via your login session) can retrieve them - there is no admin dashboard or third party that can browse other users' data in this application.</li>
            <li>A report you upload/paste is analyzed and the result is returned to you - the original file/text is not separately stored server-side beyond what's needed to process that one request.</li>
          </ul>
        </InfoCard>

        <InfoCard title="AI use disclosure">
          <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>
            Risk scoring uses a machine-learning classifier trained on the public UCI Maternal Health Risk dataset,
            combined with rule-based logic (danger-sign phrase matching, expert rules) - all of it runs on this
            application's own server. No external AI provider or third-party LLM API is called, and none of your
            data is sent anywhere outside this application to generate a result.
          </p>
        </InfoCard>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <InfoCard title="Your data">
          <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>These act on the data for however you're currently using the app (guest or your logged-in account).</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={handleExport} className="btn btn-secondary">
              <i className="ph ph-download-simple" /> Export My Data (JSON)
            </button>
            <button type="button" onClick={handleClearLocal} className="btn btn-secondary">
              <i className="ph ph-trash" /> Clear My Local Data
            </button>
          </div>
          {controlsNote && <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{controlsNote}</p>}
        </InfoCard>

        {user && (
          <InfoCard title="Delete everything">
            <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
              Permanently deletes your account and everything tied to it on our server - assessments, chat messages,
              nutrition checks. This cannot be undone.
            </p>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="btn btn-secondary"
              style={{ justifySelf: "start", borderColor: "var(--color-critical)", color: "var(--color-critical)" }}
            >
              <i className="ph ph-warning" /> Delete My Account &amp; All Data
            </button>
          </InfoCard>
        )}

        <InfoCard title="Share With a Doctor, Health Worker, or Family Member">
          <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
            Generate a one-time code that lets someone you share it with view a read-only summary of your latest
            result. A doctor or ASHA/ANM can open it on the Provider page for clinical detail; a family member can
            open the same code on the Caregiver page for a simpler "is she okay" view. Either way, they cannot see
            any other patient, cannot edit anything, and lose access the moment you revoke or regenerate the code.
          </p>

          {!user ? (
            <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
              Sign up or log in to generate a provider share code - guest data lives only on this device, so there's
              nothing on our server for a provider's code to point to.
            </p>
          ) : !shareCodeLoaded ? (
            <Spinner />
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {shareCode ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px dashed var(--color-accent)", background: "var(--color-accent-900)", padding: 16 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.15em", color: "var(--color-accent-200)" }}>{shareCode}</span>
                </div>
              ) : (
                <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>No active share code.</p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={handleGenerateCode} className="btn btn-secondary">
                  <i className="ph ph-key" /> Generate Share Code
                </button>
                {shareCode && (
                  <button type="button" onClick={handleRevokeCode} className="btn btn-secondary" style={{ borderColor: "var(--color-critical)", color: "var(--color-critical)" }}>
                    <i className="ph ph-x" /> Revoke Access
                  </button>
                )}
              </div>
              {shareCodeNote && (
                <p style={{ fontSize: "0.8125rem", fontWeight: shareCodeError ? 600 : 400, color: shareCodeError ? "var(--color-critical)" : "var(--color-neutral-400)" }}>{shareCodeNote}</p>
              )}
            </div>
          )}
        </InfoCard>
      </div>
    </div>
  );
}
