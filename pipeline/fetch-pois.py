# Stage 10: find places worth stopping at along each demo route.
# Run: python pipeline/fetch-pois.py

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
ROUTES = HERE.parent / "public" / "demo-routes.json"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
]
USER_AGENT = "trailblaze-az pipeline (https://github.com/HarianthK)"

# How far off the road counts as "on the way".
RADIUS_M = 1500

# Viewpoints first — this is a scenic route planner, and a marked viewpoint is
# the most on-topic thing OSM knows about. Food and fuel are the practical rest.
KINDS = {
    "viewpoint": '["tourism"="viewpoint"]',
    "food": '["amenity"~"^(restaurant|cafe)$"]',
    "fuel": '["amenity"="fuel"]',
}

# Overpass takes the route as a list of coordinates, so it has to be short
# enough to put in a request. Sixty points across a 180-mile drive is a point
# every three miles, which at a 1.5 km radius leaves no meaningful gaps.
MAX_POINTS = 60

# Enough to choose from, few enough to keep the file small and the map readable.
PER_KIND = 12


def haversine(a, b):
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def thin(coords, limit=MAX_POINTS):
    if len(coords) <= limit:
        return coords
    step = len(coords) / limit
    return [coords[int(i * step)] for i in range(limit)]


def overpass(query, label):
    last = "unknown"
    for attempt in range(1, 4):
        for mirror in MIRRORS:
            try:
                req = urllib.request.Request(
                    mirror,
                    data=urllib.parse.urlencode({"data": query}).encode(),
                    headers={"User-Agent": USER_AGENT},
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    return json.loads(resp.read().decode())
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as err:
                last = str(err)
        if attempt < 3:
            wait = attempt * 15
            print(f"    {label}: all mirrors busy ({last}); retrying in {wait}s")
            time.sleep(wait)
    raise SystemExit(f"{label}: every mirror failed ({last})")


def nearest_offset(point, line):
    """Metres from the route, and how far along it, so stops can be listed in
    the order you would actually drive past them."""
    best_d = float("inf")
    best_along = 0.0
    along = 0.0
    for i, node in enumerate(line):
        d = haversine(point, node)
        if d < best_d:
            best_d, best_along = d, along
        if i + 1 < len(line):
            along += haversine(node, line[i + 1])
    return best_d, best_along


def main():
    if not ROUTES.exists():
        raise SystemExit(f"missing {ROUTES} — run make-demo-routes.py first")

    trips = json.loads(ROUTES.read_text(encoding="utf-8"))
    print(f"Stage 10 — stops along {len(trips)} routes")

    for trip in trips:
        line = trip["scenic"]["coordinates"]
        sample = thin(line)
        coords = ",".join(f"{lat},{lon}" for lon, lat in sample)

        blocks = "\n".join(
            f'  node(around:{RADIUS_M},{coords}){tags};' for tags in KINDS.values()
        )
        query = f"[out:json][timeout:180];\n(\n{blocks}\n);\nout body;"

        print(f"  {trip['key']} …", end="", flush=True)
        started = time.time()

        # A mirror answering 200 with an empty body is the failure mode here,
        # not an error. Every one of these routes passes through a town, so no
        # results at all means the answer was bad rather than the road empty.
        data = {}
        for attempt in range(3):
            data = overpass(query, trip["key"])
            if data.get("elements"):
                break
            print(" empty, retrying …", end="", flush=True)
            time.sleep(10)

        found = {kind: [] for kind in KINDS}
        for el in data.get("elements", []):
            tags = el.get("tags", {})
            name = tags.get("name")
            if not name:
                continue  # An unnamed restaurant is no use as a suggestion.

            if tags.get("tourism") == "viewpoint":
                kind = "viewpoint"
            elif tags.get("amenity") == "fuel":
                kind = "fuel"
            elif tags.get("amenity") in ("restaurant", "cafe"):
                kind = "food"
            else:
                continue

            offset, along = nearest_offset((el["lon"], el["lat"]), line)
            found[kind].append({
                "name": name,
                "kind": kind,
                "coord": [round(el["lon"], 5), round(el["lat"], 5)],
                "detourM": round(offset),
                "alongM": round(along),
            })

        stops = []
        for kind, items in found.items():
            # Closest to the road first, then trimmed, then put back in the
            # order you would drive past them.
            items.sort(key=lambda p: p["detourM"])
            stops.extend(items[:PER_KIND])
        stops.sort(key=lambda p: p["alongM"])
        trip["stops"] = stops

        counts = {k: sum(1 for s in stops if s["kind"] == k) for k in KINDS}
        print(f" {len(stops)} stops in {time.time() - started:.0f}s  {counts}")

        # These are free shared servers; do not hammer them.
        time.sleep(3)

    ROUTES.write_text(json.dumps(trips, separators=(",", ":")), encoding="utf-8")
    total = sum(len(t["stops"]) for t in trips)
    print(f"\n  wrote {ROUTES.name} ({ROUTES.stat().st_size / 1024:.0f} KB, {total} stops)")

    empty = [t["key"] for t in trips if not t["stops"]]
    if empty:
        raise SystemExit(f"no stops found for {', '.join(empty)} — every route passes a town, so this is wrong")
    if total < 20:
        raise SystemExit("suspiciously few stops — check the query")


if __name__ == "__main__":
    main()
