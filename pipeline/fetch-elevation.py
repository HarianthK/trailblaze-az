# Stage 11: height profile for each route, so the climb is visible.
# Run: python pipeline/fetch-elevation.py

import io
import json
import math
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
ROUTES = HERE.parent / "public" / "demo-routes.json"

TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
USER_AGENT = "trailblaze-az pipeline (https://github.com/HarianthK)"

# At this zoom one pixel is roughly 60 m on the ground in Arizona, which is
# finer than any hill this needs to show and keeps the tile count small.
ZOOM = 11
TILE_PX = 256

# Enough points to draw a smooth climb, few enough to keep the file small.
SAMPLES = 120


def to_pixel(lon, lat, zoom=ZOOM):
    """Web-mercator: which tile a point is in, and where inside it."""
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    tx, ty = int(x), int(y)
    return tx, ty, min(int((x - tx) * TILE_PX), TILE_PX - 1), min(int((y - ty) * TILE_PX), TILE_PX - 1)


def thin(coords, limit=SAMPLES):
    if len(coords) <= limit:
        return coords
    step = (len(coords) - 1) / (limit - 1)
    return [coords[round(i * step)] for i in range(limit)]


class Tiles:
    """Fetches each tile once. A route crosses the same tile many times, and
    these are somebody else's servers."""

    def __init__(self):
        self.cache = {}
        self.fetched = 0

    def get(self, tx, ty):
        key = (tx, ty)
        if key in self.cache:
            return self.cache[key]

        url = TILES.format(z=ZOOM, x=tx, y=ty)
        last = None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    img = Image.open(io.BytesIO(resp.read())).convert("RGB")
                self.cache[key] = img
                self.fetched += 1
                return img
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as err:
                last = err
                time.sleep(2 * (attempt + 1))
        raise SystemExit(f"tile {tx},{ty} failed: {last}")

    def elevation(self, lon, lat):
        tx, ty, px, py = to_pixel(lon, lat)
        r, g, b = self.get(tx, ty).getpixel((px, py))
        # Terrarium encoding, metres above sea level.
        return (r * 256 + g + b / 256) - 32768


def profile_for(coords, tiles):
    points = thin(coords)
    metres = [round(tiles.elevation(lon, lat)) for lon, lat in points]

    # Total climb, ignoring the noise that comes from sampling a road that runs
    # along a hillside rather than over it.
    ascent = 0
    for a, b in zip(metres, metres[1:]):
        if b - a > 5:
            ascent += b - a

    return {
        "elevM": metres,
        "ascentM": ascent,
        "minM": min(metres),
        "maxM": max(metres),
    }


def main():
    if not ROUTES.exists():
        raise SystemExit(f"missing {ROUTES} — run make-demo-routes.py first")

    trips = json.loads(ROUTES.read_text(encoding="utf-8"))
    tiles = Tiles()
    print(f"Stage 11 — height profiles for {len(trips)} trips")

    for trip in trips:
        started = time.time()
        line = []
        for kind in ("fastest", "scenic"):
            trip[kind]["profile"] = profile_for(trip[kind]["coordinates"], tiles)
            line.append(f"{kind} climbs {trip[kind]['profile']['ascentM']:,} m")
        print(f"  {trip['key']:18} {' | '.join(line)}   ({time.time() - started:.0f}s)")

    ROUTES.write_text(json.dumps(trips, separators=(",", ":")), encoding="utf-8")
    print(f"\n  {tiles.fetched} tiles fetched")
    print(f"  wrote {ROUTES.name} ({ROUTES.stat().st_size / 1024:.0f} KB)")

    # The whole point is that the pretty way goes over the mountains. If it
    # climbs no more than the fast way, either the data or the routing is wrong.
    flat = [t["key"] for t in trips
            if t["scenic"]["profile"]["ascentM"] <= t["fastest"]["profile"]["ascentM"]]
    if len(flat) > 1:
        raise SystemExit(f"scenic route climbs no more than fastest on {', '.join(flat)}")
    if flat:
        print(f"  note: {flat[0]} climbs no more the scenic way")


if __name__ == "__main__":
    main()
