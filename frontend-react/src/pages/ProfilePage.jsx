import { useState } from "react";
import { api } from "../lib/api";
import { KEYS, scopedGet, scopedSet, scopedRemove } from "../lib/storage";

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
      setNote("Please enter your last menstrual period date.");
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

      setNote(`Profile saved - your Home dashboard, Assessment, and Nutrition are now personalized to week ${guideData.week}.`);
    } catch (err) {
      setNote(err.message || "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, alignItems: "start" }}>
      <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 16, boxShadow: "var(--shadow-sm)" }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--color-text)" }}>About You</h1>
          <p style={{ marginTop: 4, fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
            Personalizes your Home dashboard, Assessment, Nutrition targets, ANC checklist, and Pregnancy Guide.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <SegButton active={form.mode === "lmp"} onClick={() => set("mode", "lmp")}>By LMP</SegButton>
          <SegButton active={form.mode === "week"} onClick={() => set("mode", "week")}>By current week</SegButton>
        </div>

        {form.mode === "lmp" ? (
          <div className="field">
            <label htmlFor="profile-lmp">Last menstrual period date</label>
            <input id="profile-lmp" type="date" value={form.lmp} onChange={(e) => set("lmp", e.target.value)} className="input" style={{ maxWidth: 220 }} />
          </div>
        ) : (
          <div className="field">
            <label htmlFor="profile-week">Current gestational week</label>
            <input id="profile-week" type="number" min={0} max={42} value={form.week} onChange={(e) => set("week", e.target.value)} className="input" style={{ maxWidth: 120 }} />
          </div>
        )}

        <div className="field">
          <label>First pregnancy?</label>
          <div style={{ display: "flex", gap: 6 }}>
            <SegButton active={form.previousPregnancy === "no"} onClick={() => set("previousPregnancy", "no")}>Yes, first</SegButton>
            <SegButton active={form.previousPregnancy === "yes"} onClick={() => set("previousPregnancy", "yes")}>No, previous pregnancy</SegButton>
          </div>
        </div>

        <div className="field">
          <label htmlFor="profile-conditions">Existing medical conditions (optional)</label>
          <textarea id="profile-conditions" rows={2} placeholder="e.g. thyroid, diabetes, hypertension - leave blank if none" value={form.conditions} onChange={(e) => set("conditions", e.target.value)} className="input" style={{ width: "100%" }} />
        </div>

        <div className="field">
          <label htmlFor="profile-medications">Current medications / supplements (optional)</label>
          <textarea id="profile-medications" rows={2} placeholder="e.g. iron-folic acid, calcium, thyroid medication - leave blank if none" value={form.medications} onChange={(e) => set("medications", e.target.value)} className="input" style={{ width: "100%" }} />
        </div>

        <div className="field">
          <label htmlFor="profile-anc-visits">ANC visits completed so far</label>
          <input id="profile-anc-visits" type="number" min={0} max={12} placeholder="e.g. 3" value={form.ancVisitsCompleted} onChange={(e) => set("ancVisitsCompleted", e.target.value)} className="input" style={{ maxWidth: 120 }} />
          <p style={{ marginTop: 4, fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>Helps Today's Care know whether an ANC visit reminder is still relevant.</p>
        </div>

        <div className="field">
          <label>Td/TT Vaccination</label>
          <label className="flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <input type="checkbox" checked={form.vaccineDose1} onChange={(e) => set("vaccineDose1", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
            Dose 1 given
          </label>
          <label className="mt-1 flex items-center gap-2" style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>
            <input type="checkbox" checked={form.vaccineDose2} onChange={(e) => set("vaccineDose2", e.target.checked)} style={{ accentColor: "var(--color-accent)" }} />
            Dose 2 given
          </label>
        </div>

        <div className="field">
          <label htmlFor="profile-delivery-date">Delivery date (only if you've already delivered)</label>
          <input id="profile-delivery-date" type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} className="input" style={{ maxWidth: 220 }} />
          <p style={{ marginTop: 4, fontSize: "0.6875rem", color: "var(--color-neutral-600)" }}>Setting this switches your Home dashboard and This Week to Postpartum Care instead of pregnancy-week content.</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 14, boxShadow: "var(--shadow-sm)" }}>
          <div>
            <h2 style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-text)" }}>Contacts</h2>
            <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>Used by Home, Postpartum, and Helplines to show quick call/WhatsApp actions.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <div className="field">
              <label htmlFor="profile-asha-name">ASHA worker's name</label>
              <input id="profile-asha-name" value={form.ashaName} onChange={(e) => set("ashaName", e.target.value)} placeholder="e.g. Sunita Devi" className="input" />
            </div>
            <div className="field">
              <label htmlFor="profile-asha-phone">ASHA worker's phone</label>
              <input id="profile-asha-phone" value={form.ashaPhone} onChange={(e) => set("ashaPhone", e.target.value)} placeholder="e.g. +91 98390 12345" className="input" />
            </div>
            <div className="field">
              <label htmlFor="profile-family-name">Family contact's name (optional)</label>
              <input id="profile-family-name" value={form.familyName} onChange={(e) => set("familyName", e.target.value)} placeholder="e.g. Ramesh (husband)" className="input" />
            </div>
            <div className="field">
              <label htmlFor="profile-family-phone">Family contact's phone (optional)</label>
              <input id="profile-family-phone" value={form.familyPhone} onChange={(e) => set("familyPhone", e.target.value)} placeholder="e.g. +91 94150 67890" className="input" />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={handleSave} disabled={busy} className="btn btn-primary">
            <i className="ph ph-check" /> {busy ? "…" : "Save My Profile"}
          </button>
          {note && <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{note}</p>}
        </div>

        {summary && (
          <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 6, boxShadow: "var(--shadow-sm)" }}>
            <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--color-text)" }}>Current Profile</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-text)" }}>{summary.week}</span>
              <span style={{ fontSize: "0.875rem", color: "var(--color-neutral-400)" }}>weeks · Trimester {summary.trimester}</span>
            </div>
            {summary.estimatedDueDate && <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>Estimated due date: {summary.estimatedDueDate}</p>}
            <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{form.previousPregnancy === "yes" ? "Previous pregnancy: Yes" : "Previous pregnancy: No / first pregnancy"}</p>
            {form.conditions && <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>Existing conditions: {form.conditions}</p>}
            {form.medications && <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>Medications/supplements: {form.medications}</p>}
            {form.ancVisitsCompleted !== "" && <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>ANC visits completed: {form.ancVisitsCompleted}</p>}
            <p style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>Td/TT: {form.vaccineDose1 ? "Dose 1 ✓" : "Dose 1 pending"}{form.vaccineDose2 ? ", Dose 2 ✓" : ", Dose 2 pending"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
