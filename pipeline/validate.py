# Stage 5: assert the attribute table says true things. See README Phase 2.
# Run: python pipeline/validate.py

import csv
import gzip
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).parent
ATTRS = HERE / "data" / "attributes.csv.gz"
BYWAYS = HERE / "data" / "byways.json"
GRID_META = HERE / "data" / "scenic-grid.json"
REPORT = HERE / "data" / "validation.json"

LAYERS = ("park", "wilderness", "water", "wood")

# Roads Arizona designated as scenic must come out looking scenic. If they do
# not, the scoring is wrong no matter how cleanly the pipeline ran.
NAMED = [
    "Sedona – Oak Creek Canyon Scenic Road",
    "Red Rock Scenic Road",
    "Mingus Mountain Scenic Road",
    "San Francisco Peaks Scenic Road",
]


def load():
    rows = {}
    with gzip.open(ATTRS, "rt", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows[int(r["way_id"])] = r
    return rows


def mean(rows, field):
    return statistics.mean(float(r[field]) for r in rows) if rows else float("nan")


def main():
    for path in (ATTRS, BYWAYS, GRID_META):
        if not path.exists():
            raise SystemExit(f"missing input: {path} — run the earlier stages first")

    print("Stage 5 — validation")
    rows = load()
    byways = json.loads(BYWAYS.read_text(encoding="utf-8"))
    reach = json.loads(GRID_META.read_text(encoding="utf-8"))["reachCells"]

    checks = []

    def check(name, ok, detail):
        checks.append({"check": name, "pass": bool(ok), "detail": detail})
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {detail}")

    # Shape.
    check("row count", 500_000 < len(rows) < 2_000_000, f"{len(rows):,} drivable ways")
    fields = set(next(iter(rows.values())).keys())
    check("columns present", all(f"{l}_prox" in fields for l in LAYERS), ", ".join(sorted(fields)))

    flagged = [r for r in rows.values() if r["byway"] == "1"]
    others = [r for r in rows.values() if r["byway"] == "0"]
    check("byways flagged", 500 < len(flagged) < 5_000, f"{len(flagged):,} rows on designated byways")

    # Direction of each signal. Positive gap means byways score closer.
    gaps = {}
    for layer in LAYERS:
        field = f"{layer}_prox"
        gaps[layer] = mean(others, field) - mean(flagged, field)

    check(
        "woodland separates byways from ordinary roads",
        gaps["wood"] > 2.0,
        f"gap {gaps['wood']:+.2f} cells (byways {mean(flagged,'wood_prox'):.2f} vs {mean(others,'wood_prox'):.2f})",
    )
    check(
        "wilderness points the right way",
        gaps["wilderness"] > 0,
        f"gap {gaps['wilderness']:+.2f} cells",
    )
    # Municipal parks are an urbanness proxy: city streets sit closest to them
    # and designated byways furthest. Asserted negative so that a change which
    # accidentally makes it look scenic gets caught rather than adopted.
    check(
        "municipal parks stay an urbanness proxy, not a scenic one",
        gaps["park"] < 0,
        f"gap {gaps['park']:+.2f} cells — must not be weighted as scenic",
    )

    # Named roads. Each must beat the statewide average on woodland.
    baseline = mean(others, "wood_prox")
    by_name = {b["name"]: b for b in byways["byways"]}
    for name in NAMED:
        entry = by_name.get(name)
        if not entry:
            check(f"known byway present: {name}", False, "not in byways.json")
            continue
        mine = [rows[w] for w in entry.get("wayIds", []) if w in rows]
        if not mine:
            check(f"{name}", False, "no drivable ways matched")
            continue
        score = mean(mine, "wood_prox")
        check(
            f"{name} scores scenic",
            score < baseline,
            f"wood {score:.2f} vs statewide {baseline:.2f} over {len(mine)} ways",
        )

    # Nothing should sit beyond reach on every layer at once and still be a byway.
    stranded = sum(1 for r in flagged if all(float(r[f"{l}_prox"]) >= reach for l in LAYERS))
    check(
        "byways are near something",
        stranded < len(flagged) * 0.25,
        f"{stranded} of {len(flagged)} byway ways are beyond reach of every layer",
    )

    failed = [c for c in checks if not c["pass"]]
    REPORT.write_text(
        json.dumps({"checks": checks, "gaps": gaps, "rows": len(rows)}, indent=2),
        encoding="utf-8",
    )
    print(f"\n  {len(checks) - len(failed)}/{len(checks)} passed — wrote {REPORT.name}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
