import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { KEYS, scopedGet } from "../lib/storage";
import { getUserLocation, geocodePlace, fetchNearbyFacilities } from "../lib/geo";
import { useLang } from "../context/LangContext";

const SCHEME_KEYS = {
  PMSMA: "helplines.schemePmsma",
  JSY: "helplines.schemeJsy",
  PMMVY: "helplines.schemePmmvy",
  AnemiaMuktBharat: "helplines.schemeAnemia",
};

const TIP_KEYS = [
  { qKey: "helplines.tip1Q", aKey: "helplines.tip1A" },
  { qKey: "helplines.tip2Q", aKey: "helplines.tip2A" },
  { qKey: "helplines.tip3Q", aKey: "helplines.tip3A" },
];

const FILTER_KEYS = [
  { key: "all", labelKey: "helplines.filterAll" },
  { key: "hospital", labelKey: "helplines.filterHospitals" },
  { key: "clinic", labelKey: "helplines.filterClinics" },
  { key: "pharmacy", labelKey: "helplines.filterPharmacies" },
];

function QuickDial({ icon, number, label, tel, tone }) {
  return (
    <a
      href={`tel:${tel}`}
      className={tone === "critical" ? "jd-dial-critical" : "jd-dial"}
      style={{ borderRadius: 14, padding: 14, display: "grid", gap: 4, textAlign: "left", cursor: "pointer", textDecoration: "none" }}
    >
      <i className={`ph ${icon}`} style={{ fontSize: "1.375rem" }} />
      <span style={{ fontSize: "1.5rem", fontWeight: 500 }}>{number}</span>
      <span style={{ fontSize: "0.75rem" }}>{label}</span>
    </a>
  );
}

function FacilityCard({ f }) {
  const { t } = useLang();
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
      <i className={`ph ${f.icon}`} style={{ fontSize: "1.375rem", color: "var(--color-accent-400)", flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{f.name}</div>
        <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>
          {f.distanceKm.toFixed(1)} {t("helplines.km")} · {f.typeLabel}
          {f.emergency && ` · ${t("helplines.emergency24hr")}`}
          {f.openingHours ? ` · ${f.openingHours}` : ""}
        </div>
        {f.address && <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-600)" }}>{f.address}</div>}
      </div>
      {f.phone && (
        <a href={`tel:${f.phone}`} className="btn btn-secondary btn-icon" aria-label={t("helplines.call")}>
          <i className="ph ph-phone" style={{ fontSize: "1rem" }} />
        </a>
      )}
      <a href={f.mapsUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-icon" aria-label={t("helplines.directions")}>
        <i className="ph ph-navigation-arrow" style={{ fontSize: "1rem" }} />
      </a>
    </div>
  );
}

function NearbyCare() {
  const { t } = useLang();
  const [status, setStatus] = useState("idle"); // idle | locating | loading | ready | error
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState(null); // { lat, lon, label? }
  const [facilities, setFacilities] = useState([]);
  const [filter, setFilter] = useState("all");
  const [placeQuery, setPlaceQuery] = useState("");

  async function loadFacilities(loc) {
    setStatus("loading");
    setError("");
    try {
      const list = await fetchNearbyFacilities(loc.lat, loc.lon);
      setFacilities(list);
      setStatus("ready");
      if (list.length === 0) setError(t("helplines.noFacilitiesFound"));
    } catch (err) {
      setStatus("error");
      setError(err.message || t("helplines.couldNotLoadFacilities"));
    }
  }

  async function useMyLocation() {
    setStatus("locating");
    setError("");
    try {
      const loc = await getUserLocation();
      setOrigin(loc);
      await loadFacilities(loc);
    } catch (err) {
      setStatus("error");
      setError(err.message || t("helplines.couldNotGetLocation"));
    }
  }

  async function searchPlace(e) {
    e.preventDefault();
    if (!placeQuery.trim()) return;
    setStatus("locating");
    setError("");
    try {
      const loc = await geocodePlace(placeQuery.trim());
      setOrigin(loc);
      await loadFacilities(loc);
    } catch (err) {
      setStatus("error");
      setError(err.message || t("helplines.couldNotFindPlace"));
    }
  }

  const shown = filter === "all" ? facilities : facilities.filter((f) => f.kind === filter);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("helplines.nearbyCare")}</div>
        {facilities.length > 0 && (
          <div style={{ display: "flex", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
            {FILTER_KEYS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{ padding: "5px 10px", border: 0, cursor: "pointer", fontSize: "0.75rem", background: filter === f.key ? "var(--color-accent-900)" : "transparent", color: filter === f.key ? "var(--color-accent-200)" : "var(--color-neutral-400)" }}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {status === "idle" && (
        <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>{t("helplines.nearbyCareDesc")}</p>
          <button type="button" onClick={useMyLocation} className="btn btn-primary" style={{ justifySelf: "start" }}>
            <i className="ph ph-map-pin" /> {t("helplines.useMyLocation")}
          </button>
          <form onSubmit={searchPlace} style={{ display: "flex", gap: 8 }}>
            <input className="input" placeholder={t("helplines.searchPlacePlaceholder")} value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn btn-secondary">{t("helplines.search")}</button>
          </form>
        </div>
      )}

      {(status === "locating" || status === "loading") && (
        <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 10, fontSize: "0.8125rem", color: "var(--color-neutral-400)" }}>
          <i className="ph ph-spinner-gap" style={{ fontSize: "1.125rem", animation: "jd-spin 1s linear infinite" }} />
          {status === "locating" ? t("helplines.findingLocation") : t("helplines.lookingForCare")}
        </div>
      )}

      {error && status !== "locating" && status !== "loading" && (
        <div style={{ background: "var(--color-warning-soft)", border: "1px solid var(--color-warning)", borderRadius: 12, padding: 14, display: "grid", gap: 8 }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text)" }}>{error}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={useMyLocation} className="btn btn-secondary" style={{ fontSize: "0.75rem" }}>{t("helplines.tryAgain")}</button>
            <form onSubmit={searchPlace} style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder={t("helplines.searchPlaceInstead")} value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} style={{ fontSize: "0.75rem" }} />
              <button type="submit" className="btn btn-secondary" style={{ fontSize: "0.75rem" }}>{t("helplines.search")}</button>
            </form>
          </div>
        </div>
      )}

      {status === "ready" && shown.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {origin?.label && <p style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("helplines.near")} {origin.label}</p>}
          {shown.map((f) => (
            <FacilityCard key={f.id} f={f} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HelplinesPage() {
  const { t } = useLang();
  const [helplines, setHelplines] = useState(null);
  const [openTip, setOpenTip] = useState(null);
  const extra = scopedGet(KEYS.PROFILE_EXTRA);

  useEffect(() => {
    api.helplines().then(setHelplines);
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 24, alignItems: "start" }}>
      <style>{"@keyframes jd-spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          <QuickDial icon="ph-ambulance" number="108" label={t("helplines.dialEmergency")} tel="108" tone="critical" />
          <QuickDial icon="ph-car-profile" number="102" label={t("helplines.dialFreeRide")} tel="102" />
          <QuickDial icon="ph-headset" number="14416" label={t("helplines.dialTeleManas")} tel="14416" />
        </div>

        {(extra?.ashaName || extra?.ashaPhone) && (
          <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-accent-900)", color: "var(--color-accent-300)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, flex: "none" }}>
              {(extra.ashaName || "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t("helplines.yourAshaWorker")}</div>
              <div style={{ fontSize: "0.9375rem", color: "var(--color-text)" }}>{extra.ashaName || extra.ashaPhone}</div>
              {extra.ashaPhone && <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{extra.ashaPhone}</div>}
            </div>
            {extra.ashaPhone && (
              <a href={`tel:${extra.ashaPhone}`} className="btn btn-secondary btn-icon" aria-label={t("helplines.call")}><i className="ph ph-phone" style={{ fontSize: "1rem" }} /></a>
            )}
          </div>
        )}

        <NearbyCare />

        <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("helplines.emergencyNumbers")}</div>
          <div style={{ display: "grid", gap: 1, background: "var(--color-neutral-900)", borderRadius: 12, overflow: "hidden" }}>
            {(helplines
              ? [
                  { number: "104", labelKey: "helplines.nationalHealthHelpline", tel: "104" },
                  { number: "181", labelKey: "helplines.womensHelpline", tel: "181" },
                  { number: "1098", labelKey: "helplines.childHelpline", tel: "1098" },
                  { number: "1800-599-0019", labelKey: "helplines.kiranHelpline", tel: "1800-599-0019" },
                ]
              : []
            ).map((h) => (
              <a key={h.tel} href={`tel:${h.tel}`} style={{ background: "#1b1d2a", padding: "10px 14px", display: "flex", justifyContent: "space-between", fontSize: "0.875rem", textDecoration: "none", color: "var(--color-text)" }}>
                <span>{t(h.labelKey)}</span>
                <span style={{ color: "var(--color-accent-400)" }}>{h.number}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("helplines.goodToKnow")}</div>
          <div style={{ display: "grid", gap: 1, background: "var(--color-neutral-900)", borderRadius: 12, overflow: "hidden" }}>
            {TIP_KEYS.map((tip, i) => (
              <div key={tip.qKey} style={{ background: "#1b1d2a" }}>
                <button
                  type="button"
                  onClick={() => setOpenTip(openTip === i ? null : i)}
                  style={{ width: "100%", padding: 14, display: "flex", gap: 12, alignItems: "center", background: "none", border: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text)" }}>{t(tip.qKey)}</span>
                  <i className={`ph ${openTip === i ? "ph-caret-up" : "ph-caret-down"}`} style={{ color: "var(--color-neutral-500)" }} />
                </button>
                {openTip === i && <div style={{ padding: "0 14px 14px", fontSize: "0.875rem", lineHeight: 1.55, color: "var(--color-neutral-300)" }}>{t(tip.aKey)}</div>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--color-neutral-200)" }}>{t("helplines.governmentSchemes")}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(SCHEME_KEYS).map(([name, descKey]) => (
              <div key={name} style={{ background: "var(--color-surface)", borderRadius: 12, padding: 14 }}>
                <strong style={{ fontSize: "0.875rem", color: "var(--color-text)" }}>{name}</strong>
                <p style={{ marginTop: 4, fontSize: "0.75rem", color: "var(--color-neutral-500)" }}>{t(descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
