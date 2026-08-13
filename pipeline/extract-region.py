# Cuts a small region out of the tagged extract, so OSRM can be built and the
# scenic route checked on a laptop. Run: python pipeline/extract-region.py

import sys
import time
from pathlib import Path

import osmium

HERE = Path(__file__).parent
SRC = HERE / "extract" / "arizona-scenic.osm.pbf"
OUT = HERE / "extract" / "corridor-scenic.osm.pbf"

# Phoenix up to Sedona, wide enough to hold both the I-17 and the AZ-89A route
# through Oak Creek Canyon, which is the comparison this exists to make.
MIN_LAT, MAX_LAT = 33.20, 35.10
MIN_LON, MAX_LON = -112.60, -111.30

# ponytail: no relations, so turn restrictions are dropped. Fine for comparing
# which corridor a route takes; rebuild full-state on the server for real use.


def inside(lon, lat):
    return MIN_LON <= lon <= MAX_LON and MIN_LAT <= lat <= MAX_LAT


def main():
    if not SRC.exists():
        raise SystemExit(f"missing {SRC} — run tag-pbf.py first")

    started = time.time()

    print("Pass 1 — nodes inside the box")
    seed = set()
    for node in osmium.FileProcessor(str(SRC), osmium.osm.NODE):
        if inside(node.location.lon, node.location.lat):
            seed.add(node.id)
    print(f"  {len(seed):,} nodes ({time.time() - started:.0f}s)")

    print("Pass 2 — ways touching them")
    keep_ways = set()
    needed = set()
    for way in osmium.FileProcessor(str(SRC), osmium.osm.WAY):
        if "highway" not in way.tags:
            continue
        refs = [n.ref for n in way.nodes]
        if any(r in seed for r in refs):
            keep_ways.add(way.id)
            needed.update(refs)
    print(f"  {len(keep_ways):,} ways, {len(needed):,} nodes needed ({time.time() - started:.0f}s)")

    print("Pass 3 — writing")
    if OUT.exists():
        OUT.unlink()
    writer = osmium.SimpleWriter(str(OUT))
    written_nodes = written_ways = 0
    for obj in osmium.FileProcessor(str(SRC), osmium.osm.NODE | osmium.osm.WAY):
        if obj.is_node() and obj.id in needed:
            writer.add_node(obj)
            written_nodes += 1
        elif obj.is_way() and obj.id in keep_ways:
            writer.add_way(obj)
            written_ways += 1
    writer.close()

    scenic = sum(1 for w in osmium.FileProcessor(str(OUT), osmium.osm.WAY)
                 if w.tags.get("scenic_score"))
    print(f"  {written_nodes:,} nodes, {written_ways:,} ways, {scenic:,} scored")
    print(f"  wrote {OUT.name} ({OUT.stat().st_size / 1e6:.1f} MB) in {time.time() - started:.0f}s")

    if written_ways < 10_000 or scenic < 500:
        print("  SUSPICIOUS: too little kept, check the bounding box")
        sys.exit(1)


if __name__ == "__main__":
    main()
