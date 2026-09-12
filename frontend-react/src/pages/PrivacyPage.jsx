import { useEffect, useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { clearScopedLocalData, collectLocalExportData, getToken } from "../lib/storage";

export default function PrivacyPage() {
  const { user, logout } = useAuth();
  const [controlsNote, setControlsNote] = useState("");
  const [shareCode, setShareCode] = useState(null);
  const [shareCodeNote, setShareCodeNote] = useState("");
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
    try {
      const data = await api.createShareCode();
      setShareCode(data.code);
      setShareCodeNote("New code generated - any earlier code you had no longer works.");
    } catch (err) {
      setShareCodeNote(err.message);
    }
  }

  async function handleRevokeCode() {
    setShareCodeNote("");
    try {
      await api.revokeShareCode();
      setShareCode(null);
      setShareCodeNote("Access revoked.");
    } catch (err) {
      setShareCodeNote(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <h1 className="text-xl font-bold text-ink">Privacy &amp; Consent Centre</h1>
        <p className="mt-1 text-sm text-muted">What Janamdatri AI collects, why, who can see it, and how to export or delete it.</p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">What data is collected</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-ink">
          <li>Assessment inputs you enter: vitals, symptom text, hemoglobin, and history flags</li>
          <li>Your Mental Health Check (EPDS) responses and score</li>
          <li>Your Nutrition Analysis questionnaire responses and results</li>
          <li>Messages you send to the Instant Help chat</li>
          <li>Text from any report/prescription you upload or paste (only while being analyzed - see below)</li>
          <li>Your name and email, only if you create an account</li>
        </ul>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">Why it's collected</h3>
        <p className="text-sm text-muted">
          Solely to compute your risk screening, nutrition, and mental-health results, and - if you choose to
          create an account - to show your own history and trends back to you across visits. Nothing here is used
          for advertising, and nothing is sold or shared with third parties.
        </p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">Who can access it</h3>
        <ul className="list-inside list-disc space-y-1.5 text-sm text-ink">
          <li>Guest mode: your inputs are sent to our server only to compute a result, then the result is saved ONLY in your own browser (localStorage) - we do not keep guest data in our database at all.</li>
          <li>A logged-in account: your assessments, chat messages, and nutrition checks ARE stored in our database, tied to your account, so you can see them across visits/devices. Only your own account (via your login session) can retrieve them - there is no admin dashboard or third party that can browse other users' data in this application.</li>
          <li>A report you upload/paste is analyzed and the result is returned to you - the original file/text is not separately stored server-side beyond what's needed to process that one request.</li>
        </ul>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">AI use disclosure</h3>
        <p className="text-sm text-muted">
          Risk scoring uses a machine-learning classifier trained on the public UCI Maternal Health Risk dataset,
          combined with rule-based logic (danger-sign phrase matching, expert rules) - all of it runs on this
          application's own server. No external AI provider or third-party LLM API is called, and none of your
          data is sent anywhere outside this application to generate a result.
        </p>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">Your controls</h3>
        <p className="mb-3 text-xs text-muted">These act on the data for however you're currently using the app (guest or your logged-in account).</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={handleExport}>⬇ Export My Data (JSON)</Button>
          <Button variant="ghost" onClick={handleClearLocal}>🗑 Clear My Local Data</Button>
          {user && <Button variant="danger" onClick={handleDeleteAccount}>⚠ Delete My Account &amp; All Data</Button>}
        </div>
        {controlsNote && <p className="mt-2 text-sm text-muted">{controlsNote}</p>}
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">Share With a Doctor, Health Worker, or Family Member</h3>
        <p className="mb-3 text-sm text-muted">
          Generate a one-time code that lets someone you share it with view a read-only summary of your latest
          result. A doctor or ASHA/ANM can open it on the Provider page for clinical detail (vitals, hemoglobin,
          nutrition gaps, warning signs); a family member can open the same code on the Caregiver page for a
          simpler "is she okay" view. Either way, they cannot see any other patient, cannot edit anything, and lose
          access the moment you revoke or regenerate the code.
        </p>

        {!user ? (
          <p className="text-sm text-muted">
            Sign up or log in to generate a provider share code - guest data lives only on this device, so there's
            nothing on our server for a provider's code to point to.
          </p>
        ) : !shareCodeLoaded ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <div>
            {shareCode ? (
              <div className="mb-3 flex items-center justify-center rounded-md border border-dashed border-primary bg-primary-soft p-4">
                <span className="font-mono text-2xl font-extrabold tracking-widest text-primary">{shareCode}</span>
              </div>
            ) : (
              <p className="mb-3 text-sm text-muted">No active share code.</p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={handleGenerateCode}>🔑 Generate Share Code</Button>
              {shareCode && <Button variant="danger" onClick={handleRevokeCode}>✕ Revoke Access</Button>}
            </div>
            {shareCodeNote && <p className="mt-2 text-sm text-muted">{shareCodeNote}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}
