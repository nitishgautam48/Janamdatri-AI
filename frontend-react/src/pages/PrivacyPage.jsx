import { useEffect, useState } from "react";
import Spinner from "../components/ui/Spinner";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { clearScopedLocalData, collectLocalExportData, getToken } from "../lib/storage";
import { useLang } from "../context/LangContext";

function InfoCard({ title, children }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8, boxShadow: "var(--shadow-sm)" }}>
      <h3 style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>{title}</h3>
      {children}
    </div>
  );
}

export default function PrivacyPage() {
  const { t } = useLang();
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
    setControlsNote(t("privacy.preparingExport"));
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
    setControlsNote(t("privacy.exportDownloaded"));
  }

  function handleClearLocal() {
    if (!window.confirm(t("privacy.clearConfirm"))) return;
    clearScopedLocalData();
    setControlsNote(t("privacy.clearedNote"));
  }

  async function handleDeleteAccount() {
    if (!window.confirm(t("privacy.deleteConfirm"))) return;
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
      setShareCodeNote(t("privacy.codeGeneratedNote"));
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
      setShareCodeNote(t("privacy.accessRevokedNote"));
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
            {t("privacy.intro")}
          </div>
        </div>

        <InfoCard title={t("privacy.whatCollectedTitle")}>
          <ul className="list-inside list-disc space-y-1" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <li>{t("privacy.collect1")}</li>
            <li>{t("privacy.collect2")}</li>
            <li>{t("privacy.collect3")}</li>
            <li>{t("privacy.collect4")}</li>
            <li>{t("privacy.collect5")}</li>
            <li>{t("privacy.collect6")}</li>
          </ul>
        </InfoCard>

        <InfoCard title={t("privacy.whyCollectedTitle")}>
          <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>
            {t("privacy.whyCollectedBody")}
          </p>
        </InfoCard>

        <InfoCard title={t("privacy.whoAccessTitle")}>
          <ul className="list-inside list-disc space-y-1.5" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <li>{t("privacy.access1")}</li>
            <li>{t("privacy.access2")}</li>
            <li>{t("privacy.access3")}</li>
          </ul>
        </InfoCard>

        <InfoCard title={t("privacy.aiDisclosureTitle")}>
          <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>
            {t("privacy.aiDisclosureBody")}
          </p>
        </InfoCard>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <InfoCard title={t("privacy.yourDataTitle")}>
          <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("privacy.yourDataDesc")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={handleExport} className="btn btn-secondary">
              <i className="ph ph-download-simple" /> {t("privacy.exportButton")}
            </button>
            <button type="button" onClick={handleClearLocal} className="btn btn-secondary">
              <i className="ph ph-trash" /> {t("privacy.clearButton")}
            </button>
          </div>
          {controlsNote && <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{controlsNote}</p>}
        </InfoCard>

        {user && (
          <InfoCard title={t("privacy.deleteEverythingTitle")}>
            <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
              {t("privacy.deleteEverythingBody")}
            </p>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="btn btn-secondary"
              style={{ justifySelf: "start", borderColor: "var(--color-critical)", color: "var(--color-critical)" }}
            >
              <i className="ph ph-warning" /> {t("privacy.deleteButton")}
            </button>
          </InfoCard>
        )}

        <InfoCard title={t("privacy.shareTitle")}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
            {t("privacy.shareBody")}
          </p>

          {!user ? (
            <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
              {t("privacy.shareNoAccountBody")}
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
                <p style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{t("privacy.noActiveCode")}</p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={handleGenerateCode} className="btn btn-secondary">
                  <i className="ph ph-key" /> {t("privacy.generateCodeButton")}
                </button>
                {shareCode && (
                  <button type="button" onClick={handleRevokeCode} className="btn btn-secondary" style={{ borderColor: "var(--color-critical)", color: "var(--color-critical)" }}>
                    <i className="ph ph-x" /> {t("privacy.revokeButton")}
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
