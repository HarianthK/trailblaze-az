# Stage 3: rasterise scenic features to a proximity grid. See README Phase 2.
# Run: python pipeline/build-grid.py

import json
import os
import time
from pathlib import Path

import numpy as np
import osmium

HERE = Path(__file__).parent
PBF = HERE / "extract" / "arizona-latest.osm.pbf"
IDX = HERE / "extract" / "nodes.idx"
OUT = HERE / "data" / "scenic-grid.npz"
STAMP = HERE / "data" / "scenic-grid.json"

# Arizona, same box stage 1 queries.
MIN_LAT, MAX_LAT = 31.33, 37.00
MIN_LON, MAX_LON = -114.82, -109.04

# 200 m is finer than any routing decision this feeds, and keeps each layer
# under 10 MB — which matters more than resolution on this machine.
CELL_M = 200
DEG_LAT = CELL_M / 111_320
DEG_LON = CELL_M / (111_320 * np.cos(np.radians((MIN_LAT + MAX_LAT) / 2)))

ROWS = int((MAX_LAT - MIN_LAT) / DEG_LAT) + 1
COLS = int((MAX_LON - MIN_LON) / DEG_LON) + 1

# How far out proximity is tracked, in cells. Beyond ~2 km a feature stops
# meaningfully affecting whether a drive is pleasant.
REACH = 10

LAYERS = ("park", "water", "wood")


def classify(tags):
    # Coconino and Tonto are tagged as protected areas, not as woodland. Left
    # in the park layer they take the trees with them, and "prefer woodland"
    # and "prefer parks" collapse into the same knob.
    name = (tags.get("name") or "").lower()
    if tags.get("boundary") == "protected_area" and "national forest" in name:
        return "wood"
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return "wood"

    if tags.get("leisure") == "park" or tags.get("boundary") in ("national_park", "protected_area"):
        return "park"

    # Arizona tags thousands of dry desert washes as waterway=stream. They are
    # sand for most of the year, and counting them put 58% of the state "near
    # water", which is no signal at all. Perennial rivers and real water only.
    if tags.get("intermittent") == "yes" or tags.get("seasonal") == "yes":
        return None
    if tags.get("natural") == "water" or tags.get("waterway") in ("river", "riverbank"):
        return "water"
    return None


def to_cells(points):
    """Lon/lat pairs to fractional grid coordinates, clipped to the box."""
    arr = np.asarray(points, dtype=np.float64)
    if arr.size == 0:
        return arr.reshape(0, 2)
    x = (arr[:, 0] - MIN_LON) / DEG_LON
    y = (arr[:, 1] - MIN_LAT) / DEG_LAT
    return np.column_stack([x, y])


def fill_polygon(grid, pts):
    """Even-odd scanline fill, driven by edges rather than by rows.

    Walking every row and testing every edge is O(rows x edges), which on a
    national forest spanning 3,000 rows with 50,000 edges is 150 million
    operations for one shape — it took hours. Each edge instead emits only the
    crossings it actually makes, which is the number of rows it spans."""
    if len(pts) < 3:
        return
    x0, y0 = pts[:, 0], pts[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)

    # Horizontal edges cross no scanline and would divide by zero.
    live = y0 != y1
    if not live.any():
        return
    x0, y0, x1, y1 = x0[live], y0[live], x1[live], y1[live]

    ymin = np.minimum(y0, y1)
    ymax = np.maximum(y0, y1)

    # Rows whose centre falls in [ymin, ymax), clipped to the grid.
    lo = np.clip(np.ceil(ymin - 0.5), 0, ROWS).astype(np.int64)
    hi = np.clip(np.ceil(ymax - 0.5), 0, ROWS).astype(np.int64)
    spans = hi - lo
    np.maximum(spans, 0, out=spans)
    total = int(spans.sum())
    if total == 0:
        return

    edge = np.repeat(np.arange(x0.size), spans)
    offset = np.arange(total) - np.repeat(np.cumsum(spans) - spans, spans)
    rows = np.repeat(lo, spans) + offset

    slope = (x1 - x0) / (y1 - y0)
    xs = x0[edge] + ((rows + 0.5) - y0[edge]) * slope[edge]

    # Sorting by row then x puts each row's crossings next to each other, so
    # consecutive pairs bound the inside.
    order = np.lexsort((xs, rows))
    rows, xs = rows[order], xs[order]

    starts = np.clip(np.floor(xs[0::2]), 0, COLS - 1).astype(np.int64)
    ends = np.clip(np.ceil(xs[1::2]), 0, COLS - 1).astype(np.int64)
    for row, a, b in zip(rows[0::2], starts, ends):
        if b >= a:
            grid[row, a : b + 1] = 1


def stroke_line(grid, pts):
    """Marks the cells a linear feature passes through — rivers and streams,
    which have no interior to fill."""
    if len(pts) < 2:
        return
    cols = np.clip(pts[:, 0].astype(np.int32), 0, COLS - 1)
    rows = np.clip(pts[:, 1].astype(np.int32), 0, ROWS - 1)
    inside = (
        (pts[:, 0] >= 0) & (pts[:, 0] < COLS) & (pts[:, 1] >= 0) & (pts[:, 1] < ROWS)
    )
    grid[rows[inside], cols[inside]] = 1


def proximity(seed):
    """Distance in cells from the nearest set cell, capped at REACH. Iterative
    four-way dilation: REACH passes over an 8 M array is a fraction of a second
    in numpy, and needs no scipy."""
    out = np.full(seed.shape, REACH, dtype=np.uint8)
    out[seed == 1] = 0
    front = seed == 1
    for step in range(1, REACH + 1):
        grown = front.copy()
        grown[1:, :] |= front[:-1, :]
        grown[:-1, :] |= front[1:, :]
        grown[:, 1:] |= front[:, :-1]
        grown[:, :-1] |= front[:, 1:]
        new = grown & (out == REACH)
        if not new.any():
            break
        out[new] = step
        front = grown
    return out


def main():
    print("Stage 3 — scenic proximity grid")
    print(f"  grid {ROWS} x {COLS} cells at ~{CELL_M} m ({ROWS * COLS / 1e6:.1f} M cells per layer)")

    if not PBF.exists():
        raise SystemExit(f"missing extract — run fetch-extract.mjs first ({PBF})")

    seeds = {name: np.zeros((ROWS, COLS), dtype=np.uint8) for name in LAYERS}
    counts = {name: 0 for name in LAYERS}
    started = time.time()
    seen = 0

    # Areas are assembled by osmium from closed ways and multipolygon relations
    # alike, so national forests split across dozens of members arrive whole.
    processor = (
        osmium.FileProcessor(str(PBF))
        .with_areas()
        .with_locations(f"sparse_file_array,{IDX}")
    )

    for obj in processor:
        tags = obj.tags
        layer = classify(tags)
        if layer is None:
            continue

        if isinstance(obj, osmium.osm.Area):
            for ring in obj.outer_rings():
                fill_polygon(seeds[layer], to_cells([(n.lon, n.lat) for n in ring]))
            counts[layer] += 1
        elif obj.is_way() and tags.get("waterway") == "river":
            try:
                stroke_line(seeds[layer], to_cells([(n.lon, n.lat) for n in obj.nodes]))
            except osmium.InvalidLocationError:
                continue
            counts[layer] += 1
        else:
            continue

        seen += 1
        if seen % 25_000 == 0:
            print(f"  {seen:,} features in {time.time() - started:.0f}s")

    print(f"  rasterised {seen:,} features in {time.time() - started:.0f}s")
    for name in LAYERS:
        covered = int((seeds[name] == 1).sum())
        print(f"    {name:6} {counts[name]:>7,} features, {covered:>9,} cells covered")

    print("  computing proximity")
    grids = {name: proximity(seeds[name]) for name in LAYERS}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT, **grids)

    meta = {
        "stage": "scenic-grid",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bbox": [MIN_LAT, MIN_LON, MAX_LAT, MAX_LON],
        "cellMeters": CELL_M,
        "rows": ROWS,
        "cols": COLS,
        "reachCells": REACH,
        "layers": {
            name: {
                "features": counts[name],
                "cellsInside": int((grids[name] == 0).sum()),
                "cellsWithinReach": int((grids[name] < REACH).sum()),
            }
            for name in LAYERS
        },
    }
    STAMP.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    print(f"  wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")
    for name in LAYERS:
        inside = meta["layers"][name]["cellsInside"]
        near = meta["layers"][name]["cellsWithinReach"]
        print(f"    {name:6} {inside / (ROWS * COLS) * 100:5.1f}% of Arizona inside, {near / (ROWS * COLS) * 100:5.1f}% within reach")


if __name__ == "__main__":
    main()
