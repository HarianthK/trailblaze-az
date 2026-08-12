# Stage 6: bake the scenic score into the PBF as a tag the OSRM profile reads.
# Run: python pipeline/tag-pbf.py

import csv
import gzip
import json
import time
from pathlib import Path

import osmium

HERE = Path(__file__).parent
PBF = HERE / "extract" / "arizona-latest.osm.pbf"
OUT = HERE / "extract" / "arizona-scenic.osm.pbf"
ATTRS = HERE / "data" / "attributes.csv.gz"
STAMP = HERE / "data" / "tagged.json"

TAG = "scenic_score"
REACH = 10

# Weights come straight from stage 5. Water measured -0.25 and municipal parks
# -3.16, so both are zero: weighting a signal that points the wrong way would
# steer scenic routes into Phoenix. Re-run validate.py before changing these.
W_WOOD = 0.7
W_WILDERNESS = 0.3
BYWAY_BONUS = 3


def score(row):
    wood = REACH - float(row["wood_prox"])
    wild = REACH - float(row["wilderness_prox"])
    s = W_WOOD * wood + W_WILDERNESS * wild
    if row["byway"] == "1":
        s += BYWAY_BONUS
    return max(0, min(10, round(s)))


def load_scores():
    scores = {}
    with gzip.open(ATTRS, "rt", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            s = score(row)
            # Untagged means zero to the Lua profile, so only carry the rest.
            if s:
                scores[int(row["way_id"])] = s
    return scores


def main():
    print("Stage 6 — tag the extract with scenic scores")
    for path in (PBF, ATTRS):
        if not path.exists():
            raise SystemExit(f"missing input: {path}")

    scores = load_scores()
    print(f"  {len(scores):,} ways carry a non-zero score")

    started = time.time()
    tagged = 0
    if OUT.exists():
        OUT.unlink()
    writer = osmium.SimpleWriter(str(OUT))

    for obj in osmium.FileProcessor(str(PBF)):
        if obj.is_way() and obj.id in scores:
            writer.add_way(obj.replace(tags=dict(obj.tags, **{TAG: str(scores[obj.id])})))
            tagged += 1
        else:
            writer.add(obj)
    writer.close()

    print(f"  tagged {tagged:,} ways in {time.time() - started:.0f}s")
    print(f"  wrote {OUT.name} ({OUT.stat().st_size / 1e6:.0f} MB)")

    verify(scores)

    STAMP.write_text(json.dumps({
        "stage": "tagged",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tag": TAG,
        "waysTagged": tagged,
        "weights": {"wood": W_WOOD, "wilderness": W_WILDERNESS, "bywayBonus": BYWAY_BONUS},
    }, indent=2), encoding="utf-8")


def verify(scores):
    """Reads the file back. A writer that silently drops tags would otherwise
    only surface as a routing engine that ignores scenery."""
    found = high = 0
    for obj in osmium.FileProcessor(str(OUT), osmium.osm.WAY):
        raw = obj.tags.get(TAG)
        if raw is None:
            continue
        found += 1
        assert int(raw) == scores[obj.id], f"way {obj.id}: wrote {scores[obj.id]}, read {raw}"
        if int(raw) >= 8:
            high += 1
    assert found == len(scores), f"wrote {len(scores):,} scored ways, read back {found:,}"
    assert high > 1000, f"only {high} ways scored 8+, expected the forested north"
    print(f"  verified {found:,} tags survived the round trip, {high:,} scoring 8+")


if __name__ == "__main__":
    main()
