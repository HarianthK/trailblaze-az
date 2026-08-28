# Stage 12: export the road network as a compact graph the browser can route on.
# Run: python pipeline/build-graph.py

import array
import collections
import gzip
import importlib.util
import json
import struct
import time
from pathlib import Path

import osmium

HERE = Path(__file__).parent
OUT = HERE.parent / "public" / "graph.bin.gz"
STAMP = HERE / "data" / "graph.json"

spec = importlib.util.spec_from_file_location("check", HERE / "check-routing.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

# Only junctions go in the node table. Shape points, the wiggle between
# junctions, are stored inline on each edge as small offsets from the previous
# point. Storing them as nodes as well cost twelve bytes each for something the
# router never looks at, and 83% of the network is wiggle.
#
# Offsets are hundred-thousandths of a degree, a bit over a metre, which is
# finer than a drawn line needs and fits two shape points in the space one
# coordinate used to take.
SCALE = 100_000
# Points closer together than this add nothing to a drawn road.
SIMPLIFY_DEG = 0.00012
def main():
    print("Stage 12 — routable graph for the browser")
    started = time.time()

    uses = collections.Counter()
    for way in osmium.FileProcessor(str(check.PBF), osmium.osm.WAY):
        if way.tags.get("highway") not in check.MAJOR:
            continue
        refs = [n.ref for n in way.nodes]
        uses.update(refs)
        uses[refs[0]] += 1
        uses[refs[-1]] += 1
    junctions = {n for n, k in uses.items() if k > 1}
    print(f"  {len(uses):,} nodes, of which {len(junctions):,} are junctions ({time.time()-started:.0f}s)")

    # Second pass, now with coordinates, splitting each way at its junctions.
    index = {}
    lons = array.array("f")
    lats = array.array("f")

    def node_id(ref, lon, lat):
        got = index.get(ref)
        if got is None:
            got = index[ref] = len(lons)
            lons.append(lon)
            lats.append(lat)
        return got

    def thin(points):
        """Drops shape points too close to matter once drawn."""
        kept = []
        for lon, lat in points:
            if kept and abs(lon - kept[-1][0]) < SIMPLIFY_DEG and abs(lat - kept[-1][1]) < SIMPLIFY_DEG:
                continue
            kept.append((lon, lat))
        return kept

    edges = []          # (a, b, seconds, score, [shape point ids])
    src = osmium.FileProcessor(str(check.PBF), osmium.osm.NODE | osmium.osm.WAY)
    for way in src.with_locations(f"sparse_file_array,{check.IDX}"):
        if not way.is_way() or way.tags.get("highway") not in check.MAJOR:
            continue
        kmh = check.SPEED.get(way.tags.get("highway"), 30)
        if way.tags.get("surface") in check.UNPAVED:
            kmh = min(kmh, 20)
        score = int(way.tags.get("scenic_score") or 0)
        oneway = way.tags.get("oneway") in ("yes", "true", "1")

        try:
            pts = [(n.ref, n.lon, n.lat) for n in way.nodes]
        except osmium.InvalidLocationError:
            continue
        if len(pts) < 2:
            continue

        start = node_id(*pts[0])
        shape = []
        seconds = 0.0
        prev = pts[0]
        for ref, lon, lat in pts[1:]:
            # check.haversine takes (lat, lon), not (lon, lat). Passing them
            # the wrong way round made every distance, and so every travel
            # time, wrong — and every check I wrote copied the same call, so
            # they all agreed with each other and none of them noticed.
            d = check.haversine((prev[2], prev[1]), (lat, lon))
            seconds += d / (kmh / 3.6)
            prev = (ref, lon, lat)
            if ref in junctions:
                end = node_id(ref, lon, lat)
                if end != start:
                    edges.append((start, end, seconds, score, thin(shape), oneway))
                start = end
                shape = []
                seconds = 0.0
            else:
                shape.append((lon, lat))

    print(f"  {len(edges):,} edges ({time.time()-started:.0f}s)")

    # Layout: a small header, then coordinates, then edges. Fixed-width
    # throughout so the browser can read it with typed arrays and no parsing.
    shape_total = sum(len(e[4]) for e in edges)
    head = struct.pack("<4sIII", b"TBAZ", len(lons), len(edges), shape_total)

    edge_a = array.array("i", [e[0] for e in edges])
    edge_b = array.array("i", [e[1] for e in edges])
    edge_s = array.array("f", [e[2] for e in edges])
    edge_score = array.array("b", [e[3] for e in edges])
    edge_oneway = array.array("b", [1 if e[5] else 0 for e in edges])
    edge_shape_len = array.array("H", [len(e[4]) for e in edges])

    # Each shape point as an offset from the one before it, starting at the
    # edge's own first junction.
    deltas = array.array("h")
    for a, _b, _s, _sc, shape, _o in edges:
        plon, plat = lons[a], lats[a]
        for lon, lat in shape:
            deltas.append(max(-32768, min(32767, round((lon - plon) * SCALE))))
            deltas.append(max(-32768, min(32767, round((lat - plat) * SCALE))))
            plon, plat = lon, lat

    blob = b"".join([
        head, lons.tobytes(), lats.tobytes(),
        edge_a.tobytes(), edge_b.tobytes(), edge_s.tobytes(),
        edge_score.tobytes(), edge_oneway.tobytes(),
        edge_shape_len.tobytes(), deltas.tobytes(),
    ])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT, "wb", compresslevel=9) as fh:
        fh.write(blob)

    raw_mb = len(blob) / 1e6
    gz_mb = OUT.stat().st_size / 1e6
    print(f"  raw {raw_mb:.1f} MB, gzipped {gz_mb:.1f} MB")

    STAMP.write_text(json.dumps({
        "stage": "graph",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "nodes": len(lons),
        "edges": len(edges),
        "shapePoints": shape_total,
        "rawBytes": len(blob),
        "gzipBytes": OUT.stat().st_size,
    }, indent=2), encoding="utf-8")

    if gz_mb > 4:
        raise SystemExit(f"{gz_mb:.1f} MB is too big to ship to a browser")


if __name__ == "__main__":
    main()
