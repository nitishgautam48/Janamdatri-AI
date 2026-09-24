"""
Server-side proxy for the Nearby Care feature's map lookups.

The frontend originally called OpenStreetMap's Overpass and Nominatim
APIs directly from the browser. That works fine against a mocked network
(as this session's own Playwright tests were, since this sandbox's own
egress policy blocks those domains outright) but fails against the real
internet: Overpass does not send Access-Control-Allow-Origin on its
responses at all, so browsers block the fetch outright as a CORS
violation, and Nominatim only sends it when the request carries a
Referer header and isn't being rate-limited (403/429 responses drop the
header too, which browsers then also report as a generic CORS error).
Routing through this server sidesteps both: server-to-server HTTP
requests aren't subject to CORS, and the frontend's fetch to OUR api
is same-origin, exactly like every other endpoint already works.
"""

import json
import math
import urllib.error
import urllib.request

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"
# Nominatim's usage policy asks for an identifying User-Agent on
# non-browser clients - a real identifier, not a spoofed browser string.
USER_AGENT = "JanamdatriAI/1.0 (maternal health triage app; nearby-care lookup)"


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _classify(tags):
    amenity = tags.get("amenity")
    healthcare = tags.get("healthcare")
    if amenity == "hospital" or healthcare == "hospital":
        return "hospital", "ph-hospital", "Hospital"
    if amenity == "pharmacy" or healthcare == "pharmacy":
        return "pharmacy", "ph-first-aid-kit", "Pharmacy"
    return "clinic", "ph-first-aid", "Clinic"


def _overpass_query(lat, lon, radius_m):
    flt = '["amenity"~"^(hospital|clinic|doctors|pharmacy)$"]|["healthcare"]'
    return (
        f"[out:json][timeout:20];"
        f"(node{flt}(around:{radius_m},{lat},{lon});"
        f"way{flt}(around:{radius_m},{lat},{lon}););"
        f"out center tags 80;"
    )


def _post_json(url, data_bytes, headers, timeout=20):
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _query_overpass(lat, lon, radius_m):
    body = ("data=" + _overpass_query(lat, lon, radius_m)).encode("utf-8")
    headers = {"Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT}
    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            return _post_json(endpoint, body, headers)
        except Exception as exc:  # noqa: BLE001 - try the next mirror regardless of failure kind
            last_err = exc
    raise RuntimeError(f"Could not reach the map data service: {last_err}")


def fetch_nearby_facilities(lat, lon, radius_m=8000, max_radius_m=30000):
    """Real hospitals/clinics/pharmacies near (lat, lon), nearest first."""
    r = radius_m
    elements = []
    while r <= max_radius_m:
        data = _query_overpass(lat, lon, r)
        elements = data.get("elements", [])
        if elements or r >= max_radius_m:
            break
        r *= 3

    seen = set()
    facilities = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("name:en")
        if not name:
            continue
        flat = el.get("lat") if el.get("lat") is not None else (el.get("center") or {}).get("lat")
        flon = el.get("lon") if el.get("lon") is not None else (el.get("center") or {}).get("lon")
        if flat is None or flon is None:
            continue
        dedupe_key = f"{name.lower()}|{flat:.3f}|{flon:.3f}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        kind, icon, type_label = _classify(tags)
        addr_parts = [
            tags.get("addr:housenumber"),
            tags.get("addr:street") or tags.get("addr:place"),
            tags.get("addr:suburb"),
            tags.get("addr:city") or tags.get("addr:town") or tags.get("addr:village"),
        ]
        facilities.append({
            "id": f"{el.get('type')}/{el.get('id')}",
            "name": name,
            "kind": kind,
            "icon": icon,
            "typeLabel": type_label,
            "lat": flat,
            "lon": flon,
            "distanceKm": round(_haversine_km(lat, lon, flat, flon), 2),
            "address": ", ".join(p for p in addr_parts if p),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "emergency": tags.get("emergency") == "yes",
            "openingHours": tags.get("opening_hours"),
            "mapsUrl": f"https://www.google.com/maps/dir/?api=1&destination={flat},{flon}",
        })

    facilities.sort(key=lambda f: f["distanceKm"])
    return facilities[:30]


def geocode_place(query):
    """Free-text place search via Nominatim - returns {lat, lon, label} or None."""
    from urllib.parse import quote

    url = f"{NOMINATIM_ENDPOINT}?format=jsonv2&limit=1&q={quote(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Place search failed: {exc}") from exc
    if not rows:
        return None
    row = rows[0]
    return {"lat": float(row["lat"]), "lon": float(row["lon"]), "label": row.get("display_name", query)}
