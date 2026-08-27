# Precomputes fastest and scenic routes for a handful of trips, so the site can
# show real scenic routing with no server. Run: python pipeline/make-demo-routes.py

import importlib.util
import json
import time
from pathlib import Path

import osmium

HERE = Path(__file__).parent
# In public/ rather than lib/ so half a megabyte of coordinates stays out of
# the JavaScript bundle and is only fetched when someone picks a trip.
OUT = HERE.parent / "public" / "demo-routes.json"

spec = importlib.util.spec_from_file_location("check", HERE / "check-routing.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

# All inside the corridor extract. Each is a drive someone might actually make.
TRIPS = [
    ("phoenix-sedona", "Phoenix", (33.4484, -112.0740), "Sedona", (34.8697, -111.7610)),
    ("phoenix-jerome", "Phoenix", (33.4484, -112.0740), "Jerome", (34.7489, -112.1135)),
    ("phoenix-payson", "Phoenix", (33.4484, -112.0740), "Payson", (34.2308, -111.3251)),
    ("phoenix-prescott", "Phoenix", (33.4484, -112.0740), "Prescott", (34.5400, -112.4685)),
    ("sedona-prescott", "Sedona", (34.8697, -111.7610), "Prescott", (34.5400, -112.4685)),
    ("tempe-gilbert", "Tempe", (33.4255, -111.9400), "Gilbert", (33.3528, -111.7890)),
    # Shorter drives, and a couple that start somewhere other than Phoenix, so
    # the list is not five variations on leaving the same car park.
    ("phoenix-cottonwood", "Phoenix", (33.4484, -112.0740), "Cottonwood", (34.7392, -112.0093)),
    ("phoenix-campverde", "Phoenix", (33.4484, -112.0740), "Camp Verde", (34.5637, -111.8543)),
    ("scottsdale-payson", "Scottsdale", (33.4942, -111.9261), "Payson", (34.2308, -111.3251)),
    ("prescott-jerome", "Prescott", (34.5400, -112.4685), "Jerome", (34.7489, -112.1135)),
]


def build_with_speed():
    graph, coords, score = {}, {}, {}
    src = osmium.FileProcessor(str(check.PBF), osmium.osm.NODE | osmium.osm.WAY)
    for way in src.with_locations(f"sparse_file_array,{check.IDX}"):
        if not way.is_way() or way.tags.get("highway") not in check.MAJOR:
            continue
        oneway = way.tags.get("oneway") in ("yes", "true", "1")
        s = int(way.tags.get("scenic_score") or 0)
        kmh = check.SPEED.get(way.tags.get("highway"), 30)
        if way.tags.get("surface") in check.UNPAVED:
            kmh = min(kmh, 20)
        try:
            pts = [(n.ref, n.lat, n.lon) for n in way.nodes]
        except osmium.InvalidLocationError:
            continue
        for (a, alat, alon), (b, blat, blon) in zip(pts, pts[1:]):
            d = check.haversine((alat, alon), (blat, blon))
            if d <= 0:
                continue
            coords[a] = (alat, alon)
            coords[b] = (blat, blon)
            sec = d / (kmh / 3.6)
            graph.setdefault(a, []).append((b, d, sec))
            if not oneway:
                graph.setdefault(b, []).append((a, d, sec))
            score[(a, b)] = score[(b, a)] = s
    return graph, coords, score


def measure(graph, coords, path):
    metres = seconds = 0.0
    for a, b in zip(path, path[1:]):
        metres += check.haversine(coords[a], coords[b])
        for nxt, _d, sec in graph[a]:
            if nxt == b:
                seconds += sec
                break
    return metres, seconds


# Straight lines between junctions don't need every node; this keeps the files
# small without visibly changing the drawn line.
def simplify(points, tolerance=0.0005):
    kept = [points[0]]
    for p in points[1:-1]:
        if abs(p[0] - kept[-1][0]) > tolerance or abs(p[1] - kept[-1][1]) > tolerance:
            kept.append(p)
    kept.append(points[-1])
    return kept


def main():
    print("Precomputing demo routes")
    started = time.time()
    graph, coords, score = build_with_speed()
    print(f"  graph: {len(graph):,} nodes ({time.time() - started:.0f}s)")

    out = []
    for key, from_name, origin, to_name, destination in TRIPS:
        start, goal = check.nearest(coords, origin), check.nearest(coords, destination)
        routes = {}
        for label, boost in (("fastest", 0), ("scenic", check.BOOST_PER_POINT)):
            path = check.dijkstra(graph, score, start, goal, boost)
            if not path:
                break
            metres, seconds = measure(graph, coords, path)
            _, mean_score = check.describe(path, coords, score)
            routes[label] = {
                # [lng, lat], the order the map expects.
                "coordinates": simplify([[round(coords[n][1], 5), round(coords[n][0], 5)] for n in path]),
                "distanceMeters": round(metres),
                "durationSeconds": round(seconds),
                "scenicScore": round(mean_score, 2),
            }
        if len(routes) != 2:
            print(f"  {key}: no route, skipped")
            continue

        f, s = routes["fastest"], routes["scenic"]
        # A "scenic" route that scores worse than the fast one is not scenic.
        # Sedona -> Prescott does exactly that: the weighting finds a shorter
        # road whose lower time offsets its lower score.
        if s["scenicScore"] <= f["scenicScore"]:
            print(f"  {key:18} SKIPPED — scenic scores {s['scenicScore']} vs fastest {f['scenicScore']}")
            continue
        out.append({"key": key, "from": from_name, "to": to_name, **routes})
        print(
            f"  {key:18} fastest {f['distanceMeters']/1609:5.1f} mi / {f['durationSeconds']/3600:.2f} h"
            f"   scenic {s['distanceMeters']/1609:5.1f} mi / {s['durationSeconds']/3600:.2f} h"
            f"   score {f['scenicScore']} -> {s['scenicScore']}"
        )

    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"\n  wrote {OUT.name} ({OUT.stat().st_size / 1024:.0f} KB, {len(out)} trips)")


if __name__ == "__main__":
    main()
