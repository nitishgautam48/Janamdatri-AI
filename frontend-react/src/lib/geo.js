// Real, free, no-API-key nearby-care lookup: the browser's own Geolocation
// API for "where is the patient", and OpenStreetMap's Overpass API for
// "what health facilities are near that point" - no Google Maps Platform
// billing, no server-side proxy needed. Distances are computed client-side
// with the haversine formula from each result's own coordinates.

const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export function getUserLocation({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser doesn't support location access."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("Location access was denied. Allow location access, or search by place name instead."));
        else if (err.code === err.TIMEOUT) reject(new Error("Finding your location timed out. Please try again."));
        else reject(new Error("Couldn't get your location. Please try again."));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
    );
  });
}

// Free-text place search (no key) - lets someone search "Sitapur" instead
// of granting live location, via OpenStreetMap's own geocoder.
export async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Place search failed. Please try again.");
  const rows = await res.json();
  if (!rows.length) throw new Error(`Couldn't find "${query}". Try a nearby town or district name.`);
  return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon), label: rows[0].display_name };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function classify(tags) {
  const a = tags.amenity, h = tags.healthcare;
  if (a === "hospital" || h === "hospital") return { kind: "hospital", icon: "ph-hospital", label: "Hospital" };
  if (a === "pharmacy" || h === "pharmacy") return { kind: "pharmacy", icon: "ph-first-aid-kit", label: "Pharmacy" };
  return { kind: "clinic", icon: "ph-first-aid", label: "Clinic" };
}

function overpassQuery(lat, lon, radiusM) {
  const filter = `["amenity"~"^(hospital|clinic|doctors|pharmacy)$"]|["healthcare"]`;
  return `[out:json][timeout:20];(node${filter}(around:${radiusM},${lat},${lon});way${filter}(around:${radiusM},${lat},${lon}););out center tags 80;`;
}

async function queryOverpass(lat, lon, radiusM) {
  const body = "data=" + encodeURIComponent(overpassQuery(lat, lon, radiusM));
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Could not reach the map data service.");
}

// Returns nearby health facilities sorted by distance, nearest first.
// Widens the search radius automatically if the first pass finds nothing
// (rural areas can be sparse in OSM), up to `maxRadiusM`.
export async function fetchNearbyFacilities(lat, lon, { radiusM = 8000, maxRadiusM = 30000 } = {}) {
  let r = radiusM;
  let elements = [];
  while (r <= maxRadiusM) {
    const data = await queryOverpass(lat, lon, r);
    elements = data.elements || [];
    if (elements.length > 0 || r >= maxRadiusM) break;
    r *= 3;
  }

  const seen = new Set();
  const facilities = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const name = tags.name || tags["name:en"];
    if (!name) continue; // unnamed points aren't useful/trustworthy to show
    const flat = el.lat ?? el.center?.lat;
    const flon = el.lon ?? el.center?.lon;
    if (flat == null || flon == null) continue;
    const dedupeKey = name.toLowerCase() + "|" + flat.toFixed(3) + "|" + flon.toFixed(3);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { kind, icon, label } = classify(tags);
    const addrParts = [tags["addr:housenumber"], tags["addr:street"] || tags["addr:place"], tags["addr:suburb"], tags["addr:city"] || tags["addr:town"] || tags["addr:village"]].filter(Boolean);
    facilities.push({
      id: `${el.type}/${el.id}`,
      name,
      kind,
      icon,
      typeLabel: label,
      lat: flat,
      lon: flon,
      distanceKm: haversineKm(lat, lon, flat, flon),
      address: addrParts.join(", "),
      phone: tags.phone || tags["contact:phone"] || null,
      emergency: tags.emergency === "yes",
      openingHours: tags.opening_hours || null,
      mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${flat},${flon}`,
    });
  }

  facilities.sort((a, b) => a.distanceKm - b.distanceKm);
  return facilities.slice(0, 30);
}
