# Trailblaze AZ

A route planner for Arizona that can optimize for something other than speed.

Google/Apple Maps only really answer "what's the fastest way there." This
answers a different question: **what's the best way there, given what you
actually care about right now** — more scenery, fewer highways, a stop at a
good restaurant along the way, whatever the trip calls for.

## The two scenarios this exists for

1. **Scenic vs. fastest** — going from Tempe to Gilbert, you have time to
   spare and would rather see something on the way, even if it takes longer.
   Or the opposite: you're in a hurry and want the fastest path, full stop.
2. **Route through points of interest** — same trip, but you want the route
   to favor passing good restaurants, gas stations, or hotels along the way,
   not just the shortest line between two points.

Neither of these is something a generic Directions API can do — "prefer
scenery" or "pass through good food" isn't a knob Google or Apple expose.
Answering them means owning the routing cost function, not just calling one.

## Why this is buildable (and why it doesn't exist yet)

The closest thing on the market is [Porsche
ROADS](https://roads.porsche.com/en/porsche-roads-scenic-route-planner), a
commercial scenic-route planner — which validates the idea, but it's
closed-source and not Arizona/POI-focused. Nothing open-source does this
specific combination.

It's buildable because the pieces exist as open infrastructure:

- **[OpenStreetMap](https://www.openstreetmap.org/)** already has Arizona's
  official Scenic Byways tagged, plus parks/water/POI data — no data
  collection needed to start.
- **[Valhalla](https://github.com/valhalla/valhalla)** (open-source routing
  engine) supports fully custom costing models per edge — this is exactly
  where "prefer scenic roads" becomes a real, tunable cost function instead
  of a fake alternate-route hack.
- Self-hostable for free on **Oracle Cloud's Always Free tier** (not a
  trial — genuinely free forever), which is plenty of RAM for an
  Arizona-only OSM extract.

## Plan

**Phase 0 (done):** app shell, map, route search UI.

**Phase 1 (done):** real point-to-point routing, end-to-end, with no API key
or signup required — [Nominatim](https://nominatim.org/) for geocoding and
the [OSRM](https://project-osrm.org/) demo server for directions, both
proxied through this app's own API routes (keeps us off CORS and lets us set
the User-Agent Nominatim's usage policy asks for).

Caveats worth knowing, since they're what Phase 2 exists to fix:

- The OSRM demo server has no uptime guarantee and only optimizes for speed.
- The "scenic" toggle is a **placeholder**. OSRM only ranks by travel time,
  so scenic currently just picks its second alternative, which is usually
  barely different. The UI says so rather than pretending otherwise.
- Geocoding is restricted to an Arizona bounding box, so an out-of-state
  search can fuzzy-match something odd inside the state ("Boston, MA" finds
  "Boston Tank, Mohave County"). The app shows what it actually matched so
  that's visible rather than silently wrong.

**Phase 2 (in progress):** self-host Valhalla on an Arizona OSM extract,
with a precomputed attribute table per road segment (proximity to Scenic
Byways, parks, water, elevation change) feeding its custom costing model.
This is the actual differentiator — everything before this phase is table
stakes. See [Data pipeline](#data-pipeline) below.

**Phase 3:** POI-aware routing — given a computed route, surface
restaurants/hotels/gas stations within a small detour-time buffer of the
corridor, and let the user insert one as a waypoint.

## Data pipeline

Offline tooling in `pipeline/`. It never ships with the app — it produces the
data the routing engine is built from. Each stage is separately runnable and
writes a stamped artifact, so a route can be traced back to the data behind it.

| Stage | Command | Output |
|---|---|---|
| 1. Designated byways | `node pipeline/fetch-byways.mjs` | `pipeline/data/byways.json` |
| 2. Arizona extract | `node pipeline/fetch-extract.mjs` | `pipeline/extract/*.osm.pbf` (gitignored) |

**Artifacts are committed, inputs are not.** The JSON summaries in
`pipeline/data/` are small and versioned on purpose, so a bad run shows up as a
diff. The 287 MB extract is gitignored and re-fetchable; what's committed
instead is its checksum.

Stage 1 uses the [Overpass API](https://overpass-api.de/) rather than the
extract, because the route relations that carry Arizona's official
`US:AZ:Scenic` designation are awkward to reassemble from a PBF, and it's a
list of 28 things. Everything else comes from the extract — parks, water and
woodland are all in the same file as the roads, so querying a free shared
server for them would be both wasteful and rude.

### What's actually in the extract

Measured by a full pass over the file (65s), and it's what stage 3 is sized for:

| | Count |
|---|---|
| Ways, all kinds | 4,640,267 |
| **Drivable ways** — the attribute table's row count | **931,043** |
| …of those, carrying a `surface` tag | 353,827 (38%) |
| Waterways / water bodies | 130,200 / 36,301 |
| Woodland / forest | 112,909 / 1,094 |
| Parks / protected areas / national parks | 7,179 / 276 / 30 |

Three consequences worth recording, all of them Arizona-specific.

**Surface is tagged on only 38% of drivable roads**, so a future "avoid dirt"
option has to infer from `highway=track` and friends rather than trust the tag
— treating untagged as paved would route people onto dirt.

**`waterway=stream` in Arizona is mostly dry washes.** They are sand for most
of the year. Counting them as water put 11% of the state "inside" water and
58% within 2 km of it, which is no signal at all — the state's real surface
water is well under 1%. The grid now takes perennial rivers and actual water
bodies only, and drops anything tagged `intermittent` or `seasonal`.

**National forests are not tagged as woodland.** Coconino, Tonto and the rest
carry `boundary=protected_area`, so a naive classifier files Arizona's trees
under "parks" — which makes *prefer woodland* and *prefer parks* the same knob
while reporting the state as 5.8% wooded, against a true figure near a quarter.

### Toolchain notes

- **Python** (`pip install osmium`) for the stages that read the extract.
  Native osmium is an order of magnitude faster than parsing 287 MB in JS, and
  it needs no container.
- **Valhalla tiles are built on the server, not locally.** The tile build is
  Linux-only and memory-hungry; running it through a VM on a laptop, when the
  Oracle instance it will run on can build it directly, is the worst of both
  worlds. This machine's job ends at producing the tagged PBF.
- Overpass mirrors return `504` under load and sometimes `200` with an empty
  body, so stage 1 tries three mirrors, backs off, and validates the result
  rather than trusting the first success.
- **Scanline fill is driven by edges, not by rows.** The obvious loop — walk
  every scanline, test every edge — is O(rows x edges), which for a national
  forest with ~50,000 edges spanning ~3,000 grid rows is 150 million operations
  for a single shape. The first version of stage 3 took 6 h 38 m, nearly all of
  it in a handful of such polygons. Having each edge emit only the crossings it
  actually makes does the same shape in 0.03 s. This matters because the stage
  has to be re-runnable whenever the scenic weights change.
- **The dev machine has ~1.2 GB of RAM free**, which is the binding constraint
  on stage 3. Holding Arizona's node coordinates in memory to give road
  segments their geometry is the standard approach and does not fit. Stage 3
  therefore uses a disk-backed node index, rasterises the scenic features to a
  coarse grid instead of doing a polygon join, and streams its output rows
  rather than accumulating them.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- [MapLibre GL JS](https://maplibre.org/) for the map (open-source, no
  vendor lock-in)
- Tiles currently via [OpenFreeMap](https://openfreemap.org/) (free, no API
  key, no rate limit) — may move to a self-hosted
  [Protomaps](https://protomaps.com/)/PMTiles Arizona-only extract later for
  full control
- Geocoding: [Nominatim](https://nominatim.org/) (free, no key), proxied via
  `/api/geocode`
- Routing: [OSRM](https://project-osrm.org/) demo server (free, no key),
  proxied via `/api/directions` → self-hosted Valhalla in Phase 2

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Status

Working end-to-end for real point-to-point routing: enter two Arizona
places, get an actual driving route drawn on the map with distance and
time. The scenic option is still a placeholder — that's Phase 2, and it's
the part that makes this project worth building.
