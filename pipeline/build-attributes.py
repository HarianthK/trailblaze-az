# Stage 4: one attribute row per drivable road segment. See README Phase 2.
# Run: python pipeline/build-attributes.py

import csv
import gzip
import json
import math
import time
from pathlib import Path

import numpy as np
import osmium

HERE = Path(__file__).parent
PBF = HERE / "extract" / "arizona-latest.osm.pbf"
IDX = HERE / "extract" / "nodes-attr.idx"
GRID = HERE / "data" / "scenic-grid.npz"
GRID_META = HERE / "data" / "scenic-grid.json"
BYWAYS = HERE / "data" / "byways.json"
OUT = HERE / "data" / "attributes.csv.gz"
STAMP = HERE / "data" / "attributes.json"

# Classes a car can drive. Kept in step with the recon in the README.
DRIVABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
    "residential", "motorway_link", "trunk_link", "primary_link",
    "secondary_link", "tertiary_link", "living_street", "service", "track",
}

# Surface is tagged on only 38% of drivable roads, so absence is not evidence
# of paving. These classes are unpaved unless the tag says otherwise.
PRESUMED_UNPAVED = {"track"}
PAVED = {"asphalt", "concrete", "paved", "paving_stones", "chipseal"}
UNPAVED = {"unpaved", "dirt", "ground", "gravel", "compacted", "sand", "fine_gravel", "earth", "grass"}

# Long ways get sampled rather than walked node by node; a 500-node river road
# does not need 500 grid lookups to know it runs through forest.
MAX_SAMPLES = 24

FIELDS = [
    "way_id", "highway", "surface_class", "byway",
    "park_prox", "water_prox", "wood_prox",
    "length_m",
]


def surface_class(tags):
    raw = tags.get("surface")
    if raw in PAVED:
        return "paved"
    if raw in UNPAVED:
        return "unpaved"
    if raw:
        return "other"
    return "unpaved" if tags.get("highway") in PRESUMED_UNPAVED else "unknown"


def haversine(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def main():
    print("Stage 4 — road attribute table")

    for path in (PBF, GRID, BYWAYS):
        if not path.exists():
            raise SystemExit(f"missing input: {path} — run the earlier stages first")

    # Encoding is explicit throughout: Windows defaults these to cp1252, which
    # chokes on the non-ASCII characters in OSM place names.
    meta = json.loads(GRID_META.read_text(encoding="utf-8"))
    min_lat, min_lon = meta["bbox"][0], meta["bbox"][1]
    rows, cols, reach = meta["rows"], meta["cols"], meta["reachCells"]
    deg_lat = meta["cellMeters"] / 111_320
    deg_lon = meta["cellMeters"] / (111_320 * math.cos(math.radians((meta["bbox"][0] + meta["bbox"][2]) / 2)))

    grids = np.load(GRID)
    park, water, wood = grids["park"], grids["water"], grids["wood"]
    print(f"  grid {rows} x {cols}, reach {reach} cells")

    byway_ids = set(json.loads(BYWAYS.read_text(encoding="utf-8"))["wayIds"])
    print(f"  {len(byway_ids):,} byway way ids")

    started = time.time()
    written = 0
    skipped_no_geom = 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT, "wt", newline="", encoding="utf-8") as fh:
        out = csv.writer(fh)
        out.writerow(FIELDS)

        processor = osmium.FileProcessor(str(PBF), osmium.osm.WAY).with_locations(
            f"sparse_file_array,{IDX}"
        )

        for way in processor:
            hw = way.tags.get("highway")
            if hw not in DRIVABLE:
                continue

            try:
                pts = [(n.lon, n.lat) for n in way.nodes]
            except osmium.InvalidLocationError:
                skipped_no_geom += 1
                continue
            if len(pts) < 2:
                skipped_no_geom += 1
                continue

            length = sum(haversine(pts[i], pts[i + 1]) for i in range(len(pts) - 1))

            step = max(1, len(pts) // MAX_SAMPLES)
            sample = pts[::step]
            r = np.clip(((np.array([p[1] for p in sample]) - min_lat) / deg_lat).astype(np.int32), 0, rows - 1)
            c = np.clip(((np.array([p[0] for p in sample]) - min_lon) / deg_lon).astype(np.int32), 0, cols - 1)

            # The mean over the road, not the minimum: a road that only clips a
            # park corner should not score the same as one running through it.
            out.writerow([
                way.id, hw, surface_class(way.tags),
                1 if way.id in byway_ids else 0,
                round(float(park[r, c].mean()), 2),
                round(float(water[r, c].mean()), 2),
                round(float(wood[r, c].mean()), 2),
                round(length, 1),
            ])
            written += 1
            if written % 100_000 == 0:
                print(f"  {written:,} rows in {time.time() - started:.0f}s")

    elapsed = time.time() - started
    print(f"  wrote {written:,} rows in {elapsed:.0f}s ({OUT.stat().st_size / 1e6:.1f} MB gzipped)")
    if skipped_no_geom:
        print(f"  skipped {skipped_no_geom:,} ways with incomplete geometry")

    STAMP.write_text(json.dumps({
        "stage": "attributes",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": written,
        "skippedNoGeometry": skipped_no_geom,
        "fields": FIELDS,
        "maxSamplesPerWay": MAX_SAMPLES,
        "grid": {"cellMeters": meta["cellMeters"], "reachCells": reach},
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
