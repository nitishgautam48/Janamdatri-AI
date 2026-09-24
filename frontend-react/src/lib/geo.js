// Real, free nearby-care lookup: the browser's own Geolocation API for
// "where is the patient" (no server involved, no CORS concern), and our
// own backend for "what's nearby" - which itself proxies OpenStreetMap's
// Overpass (facility search) and Nominatim (place search) APIs server-
// side. Those two can't be called directly from the browser in
// production: Overpass never sends Access-Control-Allow-Origin at all,
// and Nominatim only sends it on successful, non-rate-limited responses
// with a Referer header present - both look like a plain CORS failure
// to the browser, silently breaking a direct client-side fetch. Routing
// through our own API sidesteps that entirely, the same way every other
// feature in this app already talks to its own backend.
import { api } from "./api";

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

export async function geocodePlace(query) {
  return api.geocodePlace(query);
}

export async function fetchNearbyFacilities(lat, lon) {
  const data = await api.nearbyFacilities(lat, lon);
  return data.facilities;
}
