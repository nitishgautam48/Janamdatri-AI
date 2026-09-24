import { useState } from "react";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
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
    <div className="mx-auto max-w-2xl space-y-5">
      <Card>
        <h1 className="text-xl font-bold text-ink">My Pregnancy Profile</h1>
        <p className="mt-1 text-sm text-muted">
          Enter this once - it personalizes your Home dashboard, Assessment, Nutrition targets, ANC checklist, and
          Pregnancy Guide, so you don't have to re-enter your week everywhere.
        </p>

        <div className="mt-4 flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="radio" checked={form.mode === "lmp"} onChange={() => set("mode", "lmp")} />
            By last menstrual period (LMP)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={form.mode === "week"} onChange={() => set("mode", "week")} />
            By current week
          </label>
        </div>

        <div className="mt-3">
          {form.mode === "lmp" ? (
            <div>
              <label htmlFor="profile-lmp" className="mb-1 block text-sm font-medium text-muted">Last menstrual period date</label>
              <input
                id="profile-lmp"
                type="date"
                value={form.lmp}
                onChange={(e) => set("lmp", e.target.value)}
                className="rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="profile-week" className="mb-1 block text-sm font-medium text-muted">Current gestational week</label>
              <input
                id="profile-week"
                type="number"
                min={0}
                max={42}
                value={form.week}
                onChange={(e) => set("week", e.target.value)}
                className="w-28 rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          )}
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-sm font-medium text-muted">Is this a previous pregnancy?</p>
          <div className="flex gap-4 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input type="radio" checked={form.previousPregnancy === "yes"} onChange={() => set("previousPregnancy", "yes")} />
              Yes
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={form.previousPregnancy === "no"} onChange={() => set("previousPregnancy", "no")} />
              No / first pregnancy
            </label>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="profile-conditions" className="mb-1 block text-sm font-medium text-muted">Existing medical conditions (optional)</label>
          <textarea
            id="profile-conditions"
            rows={2}
            placeholder="e.g. thyroid, diabetes, hypertension - leave blank if none"
            value={form.conditions}
            onChange={(e) => set("conditions", e.target.value)}
            className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </div>

        <div className="mt-5">
          <label htmlFor="profile-medications" className="mb-1 block text-sm font-medium text-muted">Current medications / supplements (optional)</label>
          <textarea
            id="profile-medications"
            rows={2}
            placeholder="e.g. iron-folic acid, calcium, thyroid medication - leave blank if none"
            value={form.medications}
            onChange={(e) => set("medications", e.target.value)}
            className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </div>

        <div className="mt-5">
          <label htmlFor="profile-anc-visits" className="mb-1 block text-sm font-medium text-muted">ANC visits completed so far</label>
          <input
            id="profile-anc-visits"
            type="number"
            min={0}
            max={12}
            placeholder="e.g. 3"
            value={form.ancVisitsCompleted}
            onChange={(e) => set("ancVisitsCompleted", e.target.value)}
            className="w-28 rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <p className="mt-1 text-xs text-faint">Helps Today's Care know whether an ANC visit reminder is still relevant.</p>
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-sm font-medium text-muted">Td/TT Vaccination</p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.vaccineDose1} onChange={(e) => set("vaccineDose1", e.target.checked)} />
            Dose 1 given
          </label>
          <label className="mt-1 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={form.vaccineDose2} onChange={(e) => set("vaccineDose2", e.target.checked)} />
            Dose 2 given
          </label>
        </div>

        <div className="mt-5">
          <label htmlFor="profile-delivery-date" className="mb-1 block text-sm font-medium text-muted">Delivery date (only if you've already delivered)</label>
          <input
            id="profile-delivery-date"
            type="date"
            value={form.deliveryDate}
            onChange={(e) => set("deliveryDate", e.target.value)}
            className="rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
          <p className="mt-1 text-xs text-faint">Setting this switches your Home dashboard and This Week to Postpartum Care instead of pregnancy-week content.</p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="profile-asha-name" className="mb-1 block text-sm font-medium text-muted">ASHA worker's name</label>
            <input
              id="profile-asha-name"
              value={form.ashaName}
              onChange={(e) => set("ashaName", e.target.value)}
              placeholder="e.g. Sunita Devi"
              className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div>
            <label htmlFor="profile-asha-phone" className="mb-1 block text-sm font-medium text-muted">ASHA worker's phone</label>
            <input
              id="profile-asha-phone"
              value={form.ashaPhone}
              onChange={(e) => set("ashaPhone", e.target.value)}
              placeholder="e.g. +91 98390 12345"
              className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div>
            <label htmlFor="profile-family-name" className="mb-1 block text-sm font-medium text-muted">Family contact's name (optional)</label>
            <input
              id="profile-family-name"
              value={form.familyName}
              onChange={(e) => set("familyName", e.target.value)}
              placeholder="e.g. Ramesh (husband)"
              className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div>
            <label htmlFor="profile-family-phone" className="mb-1 block text-sm font-medium text-muted">Family contact's phone (optional)</label>
            <input
              id="profile-family-phone"
              value={form.familyPhone}
              onChange={(e) => set("familyPhone", e.target.value)}
              placeholder="e.g. +91 94150 67890"
              className="w-full rounded-md border border-border-strong bg-bg px-3.5 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
        </div>

        <Button className="mt-6" onClick={handleSave} disabled={busy}>{busy ? "…" : "Save My Profile"}</Button>
        {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      </Card>

      {summary && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-ink">Current Profile</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-ink">{summary.week}</span>
            <span className="text-sm text-muted">weeks · Trimester {summary.trimester}</span>
          </div>
          {summary.estimatedDueDate && <p className="mt-1 text-xs text-faint">Estimated due date: {summary.estimatedDueDate}</p>}
          <p className="mt-2 text-sm text-ink">{form.previousPregnancy === "yes" ? "Previous pregnancy: Yes" : "Previous pregnancy: No / first pregnancy"}</p>
          {form.conditions && <p className="text-sm text-ink">Existing conditions: {form.conditions}</p>}
          {form.medications && <p className="text-sm text-ink">Medications/supplements: {form.medications}</p>}
          {form.ancVisitsCompleted !== "" && <p className="text-sm text-ink">ANC visits completed: {form.ancVisitsCompleted}</p>}
          <p className="text-sm text-ink">Td/TT: {form.vaccineDose1 ? "Dose 1 ✓" : "Dose 1 pending"}{form.vaccineDose2 ? ", Dose 2 ✓" : ", Dose 2 pending"}</p>
        </Card>
      )}
    </div>
  );
}
