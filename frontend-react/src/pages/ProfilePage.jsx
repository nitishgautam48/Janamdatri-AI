import { useState } from "react";
import { api } from "../lib/api";
import { KEYS, scopedGet, scopedSet, scopedRemove } from "../lib/storage";
import { useLang } from "../context/LangContext";

function loadInitialForm() {
  const guide = scopedGet(KEYS.GUIDE);
  const extra = scopedGet(KEYS.PROFILE_EXTRA);
  const postpartum = scopedGet(KEYS.POSTPARTUM_GUIDE);
  return {
    mode: guide?.lmp ? "lmp" : "week",
    lmp: guide?.lmp || "",
    week: guide?.week ?? 20,
    previousPregnancy: extra?.previousPregnancy || "no",
    conditions: extra?.conditions || "",
    medications: extra?.medications || "",
    ancVisitsCompleted: extra?.ancVisitsCompleted ?? "",
    vaccineDose1: !!extra?.vaccineDose1,
    vaccineDose2: !!extra?.vaccineDose2,
    deliveryDate: postpartum?.deliveryDate || "",
    ashaName: extra?.ashaName || "",
    ashaPhone: extra?.ashaPhone || "",
    familyName: extra?.familyName || "",
    familyPhone: extra?.familyPhone || "",
  };
}

function SegButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px", whiteSpace: "nowrap", borderRadius: 8,
        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-neutral-800)"}`,
        background: active ? "var(--color-accent-900)" : "transparent",
        color: active ? "var(--color-accent-200)" : "var(--color-neutral-400)",
        fontSize: "0.8125rem", cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export default function ProfilePage() {
  const { t } = useLang();
  const [form, setForm] = useState(loadInitialForm);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(() => scopedGet(KEYS.GUIDE));

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setNote("");
    if (form.mode === "lmp" && !form.lmp) {
      setNote(t("profile.lmpRequired"));
      return;
    }

    setBusy(true);
    try {
      const guideData = await api.pregnancyGuide(form.mode === "lmp" ? { lmp: form.lmp } : { week: Number(form.week) });
      scopedSet(KEYS.GUIDE, { ...guideData, savedAt: new Date().toISOString() });
      setSummary(guideData);

      scopedSet(KEYS.PROFILE_EXTRA, {
        previousPregnancy: form.previousPregnancy,
        conditions: form.conditions,
        medications: form.medications,
        ancVisitsCompleted: form.ancVisitsCompleted === "" ? null : Number(form.ancVisitsCompleted),
        vaccineDose1: form.vaccineDose1,
        vaccineDose2: form.vaccineDose2,
        ashaName: form.ashaName,
        ashaPhone: form.ashaPhone,
        familyName: form.familyName,
        familyPhone: form.familyPhone,
        updatedAt: new Date().toISOString(),
      });

      if (form.deliveryDate) {
        const ppData = await api.postpartumGuide(form.deliveryDate);
        scopedSet(KEYS.POSTPARTUM_GUIDE, { ...ppData, savedAt: new Date().toISOString() });
      } else {
        scopedRemove(KEYS.POSTPARTUM_GUIDE);
      }

      setNote(t("profile.savedNote").replace("{week}", guideData.week));
    } catch (err) {
      setNote(err.message || t("profile.saveError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, alignItems: "start" }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 16, boxShadow: "var(--shadow-sm)" }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--color-text)" }}>{t("profile.title")}</h1>
          <p style={{ marginTop: 4, fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
            {t("profile.subtitle")}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <SegButton active={form.mode === "lmp"} onClick={() => set("mode", "lmp")}>{t("profile.byLmp")}</SegButton>
          <SegButton active={form.mode === "week"} onClick={() => set("mode", "week")}>{t("profile.byWeek")}</SegButton>
        </div>

        {form.mode === "lmp" ? (
          <div className="field">
            <label htmlFor="profile-lmp">{t("profile.lmpLabel")}</label>
            <input id="profile-lmp" type="date" value={form.lmp} onChange={(e) => set("lmp", e.target.value)} className="input" style={{ maxWidth: 220 }} />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="profile-week">{t("profile.weekLabel")}</label>
            <input id="profile-week" type="number" min={0} max={42} value={form.week} onChange={(e) => set("week", e.target.value)} className="input" style={{ maxWidth: 120 }} />
          </div>
        )}

        <div className="field">
          <label>{t("profile.firstPregnancyLabel")}</label>
          <div style={{ display: "flex", gap: 6 }}>
            <SegButton active={form.previousPregnancy === "no"} onClick={() => set("previousPregnancy", "no")}>{t("profile.firstYes")}</SegButton>
            <SegButton active={form.previousPregnancy === "yes"} onClick={() => set("previousPregnancy", "yes")}>{t("profile.firstNo")}</SegButton>
          </div>
        </div>

        <div className="field">
          <label htmlFor="profile-conditions">{t("profile.conditionsLabel")}</label>
          <textarea id="profile-conditions" rows={2} placeholder={t("profile.conditionsPlaceholder")} value={form.conditions} onChange={(e) => set("conditions", e.target.value)} className="input" style={{ width: "100%" }} />
        </div>

        <div className="field">
          <label htmlFor="profile-medications">{t("profile.medicationsLabel")}</label>
          <textarea id="profile-medications" rows={2} placeholder={t("profile.medicationsPlaceholder")} value={form.medications} onChange={(e) => set("medications", e.target.value)} className="input" style={{ width: "100%" }} />
        </div>

        <div className="field">
          <label htmlFor="profile-anc-visits">{t("profile.ancVisitsLabel")}</label>
          <input id="profile-anc-visits" type="number" min={0} max={12} placeholder={t("profile.ancVisitsPlaceholder")} value={form.ancVisitsCompleted} onChange={(e) => set("ancVisitsCompleted", e.target.value)} className="input" style={{ maxWidth: 120 }} />
          <p style={{ marginTop: 4, fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{t("profile.ancVisitsHint")}</p>
        </div>

        <div className="field">
          <label>{t("profile.vaccineLabel")}</label>
          <label className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <input type="checkbox" checked={form.vaccineDose1} onChange={(e) => set("vaccineDose1", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
            {t("profile.dose1Given")}
          </label>
          <label className="mt-1 flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <input type="checkbox" checked={form.vaccineDose2} onChange={(e) => set("vaccineDose2", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
            {t("profile.dose2Given")}
          </label>
        </div>

        <div className="field">
          <label htmlFor="profile-delivery-date">{t("profile.deliveryDateLabel")}</label>
          <input id="profile-delivery-date" type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} className="input" style={{ maxWidth: 220 }} />
          <p style={{ marginTop: 4, fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>{t("profile.deliveryDateHint")}</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 14, boxShadow: "var(--shadow-sm)" }}>
          <div>
            <h2 style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>{t("profile.contactsTitle")}</h2>
            <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("profile.contactsDesc")}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <div className="field">
              <label htmlFor="profile-asha-name">{t("profile.ashaNameLabel")}</label>
              <input id="profile-asha-name" value={form.ashaName} onChange={(e) => set("ashaName", e.target.value)} placeholder={t("profile.ashaNamePlaceholder")} className="input" />
            </div>
            <div className="field">
              <label htmlFor="profile-asha-phone">{t("profile.ashaPhoneLabel")}</label>
              <input id="profile-asha-phone" value={form.ashaPhone} onChange={(e) => set("ashaPhone", e.target.value)} placeholder={t("profile.ashaPhonePlaceholder")} className="input" />
            </div>
            <div className="field">
              <label htmlFor="profile-family-name">{t("profile.familyNameLabel")}</label>
              <input id="profile-family-name" value={form.familyName} onChange={(e) => set("familyName", e.target.value)} placeholder={t("profile.familyNamePlaceholder")} className="input" />
            </div>
            <div className="field">
              <label htmlFor="profile-family-phone">{t("profile.familyPhoneLabel")}</label>
              <input id="profile-family-phone" value={form.familyPhone} onChange={(e) => set("familyPhone", e.target.value)} placeholder={t("profile.familyPhonePlaceholder")} className="input" />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={handleSave} disabled={busy} className="btn btn-primary">
            <i className="ph ph-check" /> {busy ? "…" : t("profile.saveButton")}
          </button>
          {note && <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{note}</p>}
        </div>

        {summary && (
          <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 6, boxShadow: "var(--shadow-sm)" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>{t("profile.currentProfileTitle")}</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>{summary.week}</span>
              <span style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>{t("profile.weeksTrimester").replace("{trimester}", summary.trimester)}</span>
            </div>
            {summary.estimatedDueDate && <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("profile.dueDate").replace("{date}", summary.estimatedDueDate)}</p>}
            <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{form.previousPregnancy === "yes" ? t("profile.prevPregnancyYes") : t("profile.prevPregnancyNo")}</p>
            {form.conditions && <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{t("profile.conditionsSummary").replace("{conditions}", form.conditions)}</p>}
            {form.medications && <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{t("profile.medicationsSummary").replace("{medications}", form.medications)}</p>}
            {form.ancVisitsCompleted !== "" && <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{t("profile.ancVisitsSummary").replace("{count}", form.ancVisitsCompleted)}</p>}
            <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
              {t("profile.tdttPrefix")}
              {form.vaccineDose1 ? t("profile.dose1Done") : t("profile.dose1Pending")}
              {form.vaccineDose2 ? t("profile.dose2Done") : t("profile.dose2Pending")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
