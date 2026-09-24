import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { KEYS, scopedGet } from "../lib/storage";
import { getUserLocation, geocodePlace, fetchNearbyFacilities } from "../lib/geo";

const SCHEMES = {
  PMSMA: "Pradhan Mantri Surakshit Matritva Abhiyan - free ANC checkup on the 9th of every month at government health facilities, from the 2nd trimester.",
  JSY: "Janani Suraksha Yojana - cash assistance for institutional delivery. Ask your ASHA worker about eligibility.",
  PMMVY: "Pradhan Mantri Matru Vandana Yojana - cash incentive in installments for ANC registration, checkups, and institutional delivery of the first living child.",
  AnemiaMuktBharat: "National programme for iron-folic acid supplementation and anemia screening/treatment during pregnancy.",
};

const TIPS = [
  { q: "How often should I feel the baby move?", a: "From week 28, count movements once a day. You should feel at least 10 in 2 hours. If fewer, lie on your left side and count again, then tell your ASHA." },
  { q: "Why is BP checked at every visit?", a: "High BP in pregnancy can harm you and the baby without any pain. A reading of 140/90 or more needs a doctor." },
  { q: "What's free for me at government facilities?", a: "Under JSSK, delivery, medicines, tests, food, and the 102 ride are free at government health facilities." },
];

const FILTERS = [
  { key: "all", label: "All" },
  { key: "hospital", label: "Hospitals" },
  { key: "clinic", label: "Clinics" },
  { key: "pharmacy", label: "Pharmacies" },
];

function QuickDial({ icon, number, label, tel, tone }) {
  return (
    <a
      href={`tel:${tel}`}
      className={tone === "critical" ? "jd-dial-critical" : "jd-dial"}
      style={{ borderRadius: 14, padding: 14, display: "grid", gap: 4, textAlign: "left", cursor: "pointer", textDecoration: "none" }}
    >
      <i className={`ph ${icon}`} style={{ fontSize: 22 }} />
      <span style={{ fontSize: 24, fontWeight: 500 }}>{number}</span>
      <span style={{ fontSize: 12 }}>{label}</span>
    </a>
  );
}

function FacilityCard({ f }) {
  return (
    <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
      <i className={`ph ${f.icon}`} style={{ fontSize: 22, color: "var(--color-accent-400)", flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, color: "var(--color-text)" }}>{f.name}</div>
        <div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>
          {f.distanceKm.toFixed(1)} km · {f.typeLabel}
          {f.emergency && " · 24hr emergency"}
          {f.openingHours ? ` · ${f.openingHours}` : ""}
        </div>
        {f.address && <div style={{ fontSize: 12, color: "var(--color-neutral-600)" }}>{f.address}</div>}
      </div>
      {f.phone && (
        <a href={`tel:${f.phone}`} className="btn btn-secondary btn-icon" aria-label="Call">
          <i className="ph ph-phone" style={{ fontSize: 16 }} />
        </a>
      )}
      <a href={f.mapsUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-icon" aria-label="Directions">
        <i className="ph ph-navigation-arrow" style={{ fontSize: 16 }} />
      </a>
    </div>
  );
}

function NearbyCare() {
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
      if (list.length === 0) setError("No health facilities found in OpenStreetMap's data near that location yet - try a nearby town, or use Call 108/102 for the nearest ambulance dispatch.");
    } catch (err) {
      setStatus("error");
      setError(err.message || "Couldn't load nearby facilities. Please try again.");
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
      setError(err.message || "Couldn't get your location.");
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
      setError(err.message || "Couldn't find that place.");
    }
  }

  const shown = filter === "all" ? facilities : facilities.filter((f) => f.kind === filter);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-neutral-200)" }}>Nearby care</div>
        {facilities.length > 0 && (
          <div style={{ display: "flex", border: "1px solid var(--color-neutral-800)", borderRadius: 8, overflow: "hidden" }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                style={{ padding: "5px 10px", border: 0, cursor: "pointer", fontSize: 12, background: filter === f.key ? "var(--color-accent-900)" : "transparent", color: filter === f.key ? "var(--color-accent-200)" : "var(--color-neutral-400)" }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {status === "idle" && (
        <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--color-neutral-400)" }}>
            Find hospitals, clinics, and pharmacies actually near you, using your phone's location and OpenStreetMap - free, and nothing is sent anywhere except the search itself.
          </p>
          <button type="button" onClick={useMyLocation} className="btn btn-primary" style={{ justifySelf: "start" }}>
            <i className="ph ph-map-pin" /> Use my location
          </button>
          <form onSubmit={searchPlace} style={{ display: "flex", gap: 8 }}>
            <input className="input" placeholder="Or search a place, e.g. Sitapur" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} style={{ flex: 1 }} />
            <button type="submit" className="btn btn-secondary">Search</button>
          </form>
        </div>
      )}

      {(status === "locating" || status === "loading") && (
        <div style={{ background: "var(--color-surface)", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--color-neutral-400)" }}>
          <i className="ph ph-spinner-gap" style={{ fontSize: 18, animation: "jd-spin 1s linear infinite" }} />
          {status === "locating" ? "Finding your location…" : "Looking for nearby care…"}
        </div>
      )}

      {error && status !== "locating" && status !== "loading" && (
        <div style={{ background: "var(--color-warning-soft)", border: "1px solid var(--color-warning)", borderRadius: 12, padding: 14, display: "grid", gap: 8 }}>
          <p style={{ fontSize: 13, color: "var(--color-text)" }}>{error}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={useMyLocation} className="btn btn-secondary" style={{ fontSize: 12 }}>Try again</button>
            <form onSubmit={searchPlace} style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder="Search a place instead" value={placeQuery} onChange={(e) => setPlaceQuery(e.target.value)} style={{ fontSize: 12 }} />
              <button type="submit" className="btn btn-secondary" style={{ fontSize: 12 }}>Search</button>
            </form>
          </div>
        </div>
      )}

      {status === "ready" && shown.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {origin?.label && <p style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>Near {origin.label}</p>}
          {shown.map((f) => (
            <FacilityCard key={f.id} f={f} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HelplinesPage() {
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
          <QuickDial icon="ph-ambulance" number="108" label="Emergency" tel="108" tone="critical" />
          <QuickDial icon="ph-car-profile" number="102" label="Free pregnancy ride" tel="102" />
          <QuickDial icon="ph-headset" number="14416" label="Tele-MANAS" tel="14416" />
        </div>

        {(extra?.ashaName || extra?.ashaPhone) && (
          <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-sm)" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--color-accent-900)", color: "var(--color-accent-300)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, flex: "none" }}>
              {(extra.ashaName || "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>Your ASHA worker</div>
              <div style={{ fontSize: 15, color: "var(--color-text)" }}>{extra.ashaName || extra.ashaPhone}</div>
              {extra.ashaPhone && <div style={{ fontSize: 12, color: "var(--color-neutral-500)" }}>{extra.ashaPhone}</div>}
            </div>
            {extra.ashaPhone && (
              <a href={`tel:${extra.ashaPhone}`} className="btn btn-secondary btn-icon" aria-label="Call"><i className="ph ph-phone" style={{ fontSize: 16 }} /></a>
            )}
          </div>
        )}

        <NearbyCare />

        <div style={{ background: "var(--color-surface)", borderRadius: 14, padding: 16, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-neutral-200)" }}>Emergency numbers</div>
          <div style={{ display: "grid", gap: 1, background: "var(--color-neutral-900)", borderRadius: 12, overflow: "hidden" }}>
            {(helplines
              ? [
                  { number: "104", label: "National Health Helpline", tel: "104" },
                  { number: "181", label: "Women's Helpline", tel: "181" },
                  { number: "1098", label: "Child Helpline", tel: "1098" },
                  { number: "1800-599-0019", label: "KIRAN Mental Health Helpline", tel: "1800-599-0019" },
                ]
              : []
            ).map((h) => (
              <a key={h.tel} href={`tel:${h.tel}`} style={{ background: "#1b1d2a", padding: "10px 14px", display: "flex", justifyContent: "space-between", fontSize: 14, textDecoration: "none", color: "var(--color-text)" }}>
                <span>{h.label}</span>
                <span style={{ color: "var(--color-accent-400)" }}>{h.number}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-neutral-200)" }}>Good to know</div>
          <div style={{ display: "grid", gap: 1, background: "var(--color-neutral-900)", borderRadius: 12, overflow: "hidden" }}>
            {TIPS.map((tip, i) => (
              <div key={tip.q} style={{ background: "#1b1d2a" }}>
                <button
                  type="button"
                  onClick={() => setOpenTip(openTip === i ? null : i)}
                  style={{ width: "100%", padding: 14, display: "flex", gap: 12, alignItems: "center", background: "none", border: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ flex: 1, fontSize: 15, color: "var(--color-text)" }}>{tip.q}</span>
                  <i className={`ph ${openTip === i ? "ph-caret-up" : "ph-caret-down"}`} style={{ color: "var(--color-neutral-500)" }} />
                </button>
                {openTip === i && <div style={{ padding: "0 14px 14px", fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-300)" }}>{tip.a}</div>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-neutral-200)" }}>Government schemes</div>
          <div style={{ display: "grid", gap: 8 }}>
            {Object.entries(SCHEMES).map(([name, desc]) => (
              <div key={name} style={{ background: "var(--color-surface)", borderRadius: 12, padding: 14 }}>
                <strong style={{ fontSize: 14, color: "var(--color-text)" }}>{name}</strong>
                <p style={{ marginTop: 4, fontSize: 12, color: "var(--color-neutral-500)" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
