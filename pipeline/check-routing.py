# Does the scenic weighting actually change the road taken? Answers that from
# the tagged corridor without a routing engine. Run: python pipeline/check-routing.py

import heapq
import math
import sys
from pathlib import Path

import osmium

HERE = Path(__file__).parent
PBF = HERE / "extract" / "corridor-scenic.osm.pbf"
IDX = HERE / "extract" / "nodes-check.idx"

# Roads worth considering for a long drive. Leaving out service roads and
# residential keeps the graph inside this machine's memory.
MAJOR = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "unclassified",
}

# Must match routing/scenic.lua, or this proves nothing about the real engine.
BOOST_PER_POINT = 5.0

# Rough stand-in for what OSRM's car profile does, in km/h. Weighting by plain
# distance made a dirt forest track look as good as a highway, which sent the
# scenic route down Fossil Creek Road — an artefact of the measurement, not of
# the scoring.
SPEED = {
    "motorway": 90, "trunk": 85, "primary": 65, "secondary": 55, "tertiary": 40,
    "unclassified": 30, "motorway_link": 45, "trunk_link": 40,
    "primary_link": 35, "secondary_link": 30, "tertiary_link": 25,
}
UNPAVED = {"unpaved", "dirt", "ground", "gravel", "compacted", "sand", "fine_gravel", "earth", "grass"}

TRIPS = [
    ("Phoenix -> Sedona", (33.4484, -112.0740), (34.8697, -111.7610)),
    ("Tempe -> Gilbert", (33.4255, -111.9400), (33.3528, -111.7890)),
]


def haversine(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def build():
    graph = {}
    coords = {}
    edge_score = {}

    for way in osmium.FileProcessor(str(PBF), osmium.osm.NODE | osmium.osm.WAY).with_locations(
        f"sparse_file_array,{IDX}"
    ):
        if not way.is_way() or way.tags.get("highway") not in MAJOR:
            continue
        oneway = way.tags.get("oneway") in ("yes", "true", "1")
        score = int(way.tags.get("scenic_score") or 0)
        kmh = SPEED.get(way.tags.get("highway"), 30)
        if way.tags.get("surface") in UNPAVED:
            kmh = min(kmh, 20)
        try:
            pts = [(n.ref, n.lat, n.lon) for n in way.nodes]
        except osmium.InvalidLocationError:
            continue

        for (a, alat, alon), (b, blat, blon) in zip(pts, pts[1:]):
            d = haversine((alat, alon), (blat, blon))
            if d <= 0:
                continue
            coords[a] = (alat, alon)
            coords[b] = (blat, blon)
            seconds = d / (kmh / 3.6)
            graph.setdefault(a, []).append((b, d, seconds))
            if not oneway:
                graph.setdefault(b, []).append((a, d, seconds))
            edge_score[(a, b)] = edge_score[(b, a)] = score

    return graph, coords, edge_score


def nearest(coords, target):
    return min(coords, key=lambda n: haversine(coords[n], target))


def dijkstra(graph, edge_score, start, goal, boost):
    dist = {start: 0.0}
    prev = {}
    queue = [(0.0, start)]
    seen = set()

    while queue:
        cost, node = heapq.heappop(queue)
        if node in seen:
            continue
        seen.add(node)
        if node == goal:
            break
        for nxt, _length, seconds in graph.get(node, ()):
            # Same shape as the Lua: a higher rate makes a road cheaper. Cost is
            # travel time, so a slow dirt road is not mistaken for a highway.
            w = seconds / (1 + edge_score[(node, nxt)] * boost)
            nd = cost + w
            if nd < dist.get(nxt, float("inf")):
                dist[nxt] = nd
                prev[nxt] = node
                heapq.heappush(queue, (nd, nxt))

    if goal not in prev and goal != start:
        return None
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    return path[::-1]


def describe(path, coords, edge_score):
    metres = sum(haversine(coords[a], coords[b]) for a, b in zip(path, path[1:]))
    weighted = sum(
        edge_score[(a, b)] * haversine(coords[a], coords[b]) for a, b in zip(path, path[1:])
    )
    return metres, (weighted / metres if metres else 0)


def main():
    if not PBF.exists():
        raise SystemExit(f"missing {PBF} — run extract-region.py first")

    print("Building graph from the corridor")
    graph, coords, edge_score = build()
    print(f"  {len(graph):,} nodes, {sum(len(v) for v in graph.values()):,} edges\n")

    failures = 0
    for name, origin, destination in TRIPS:
        start, goal = nearest(coords, origin), nearest(coords, destination)
        fast = dijkstra(graph, edge_score, start, goal, 0)
        nice = dijkstra(graph, edge_score, start, goal, BOOST_PER_POINT)
        if not fast or not nice:
            print(f"{name}: no route found")
            failures += 1
            continue

        fm, fs = describe(fast, coords, edge_score)
        nm, ns = describe(nice, coords, edge_score)
        shared = len(set(zip(fast, fast[1:])) & set(zip(nice, nice[1:])))
        overlap = shared / max(len(fast) - 1, 1)

        print(f"{name}")
        print(f"  fastest : {fm/1609:6.1f} mi   mean scenic score {fs:4.2f}")
        print(f"  scenic  : {nm/1609:6.1f} mi   mean scenic score {ns:4.2f}")
        print(f"  detour  : {(nm/fm - 1) * 100:+5.1f}%   shared road: {overlap*100:.0f}%")

        if overlap > 0.95:
            print("  FAIL: scenic is the same road as fastest")
            failures += 1
        elif ns <= fs:
            print("  FAIL: the scenic route is not more scenic")
            failures += 1
        else:
            print("  PASS: different road, and a prettier one")
        print()

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
