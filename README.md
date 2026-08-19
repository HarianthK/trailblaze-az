# Trailblaze AZ

A route planner for Arizona that can optimize for something other than speed.

Google/Apple Maps only really answer "what's the fastest way there." This
answers a different question: **what's the best way there, given what you
actually care about right now** — more scenery, fewer highways, a stop at a
good restaurant along the way, whatever the trip calls for.

## The two scenarios this exists for

1. **Scenic vs. fastest** — driving Phoenix to Sedona, you have the day free
   and would rather go over the Mogollon Rim than up the interstate, even
   though it costs two hours. Or the opposite: you're in a hurry and want the
   fastest path, full stop.
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
- **[OSRM](https://project-osrm.org/)** (open-source routing engine) lets a
  Lua profile set a custom weight per road from any tag, separately from the
  reported travel time — this is exactly where "prefer scenic roads" becomes a
  real, tunable cost function instead of a fake alternate-route hack.
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

Caveats worth knowing, since they're what the rest of Phase 2 exists to fix:

- The OSRM demo server has no uptime guarantee and only optimizes for speed.
- **Scenic routing is real, but only on the listed trips.** Those routes are
  computed by the pipeline and shipped with the site (see stage 9), so they
  need no server. Type your own two places and you still get the public
  demo server, which ranks by time alone — the UI says which you are getting
  rather than implying the toggle does the same thing in both cases.
- Geocoding is restricted to an Arizona bounding box, so an out-of-state
  search can fuzzy-match something odd inside the state ("Boston, MA" finds
  "Boston Tank, Mohave County"). The app shows what it actually matched so
  that's visible rather than silently wrong.

**Phase 2 (in progress):** self-host OSRM on an Arizona OSM extract,
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
| 3. Scenic grid | `python pipeline/build-grid.py` | `pipeline/data/scenic-grid.npz` |
| 4. Attribute table | `python pipeline/build-attributes.py` | `pipeline/data/attributes.csv.gz` (gitignored) |
| 5. Validation | `python pipeline/validate.py` | `pipeline/data/validation.json` |
| 6. Tag the extract | `python pipeline/tag-pbf.py` | `pipeline/extract/arizona-scenic.osm.pbf` (gitignored) |
| 7. Cut a test region | `python pipeline/extract-region.py` | `pipeline/extract/corridor-scenic.osm.pbf` (gitignored) |
| 8. Check it changes the road | `python pipeline/check-routing.py` | pass/fail on both trips |
| 9. Precompute the demo | `python pipeline/make-demo-routes.py` | `public/demo-routes.json` |

Stage 7 cuts the Phoenix→Sedona corridor out of the tagged extract, 301 MB down
to 44 MB, which is what makes stages 8 and 9 runnable on a laptop.

### Routing engine: OSRM, not Valhalla

The plan called for Valhalla. Research says that was the wrong pick for this
job. Valhalla evaluates costing against edge attributes **baked into its tiles**
and the tile schema is fixed — there is no field for a custom scenic score, and
[no API for per-request per-edge penalties](https://github.com/valhalla/valhalla/issues/5699)
(open, unanswered). Getting a scenic score in would mean hijacking an attribute
that means something else.

OSRM does this as a first-class feature. Its profiles set `result.weight` per
way from any tag, and
[its own docs give this exact use case](https://project-osrm.org/docs/v26.4.0/profiles)
as the example — preferring a route through green areas even when it is longer.
Crucially `weight` (what routing minimises) is separate from `duration` (the
ETA), so the scenic route can be preferred *and* honestly reported as slower.
It is also already the engine the app talks to, so `/api/directions` barely
changes.

[`routing/scenic.lua`](routing/scenic.lua) wraps the stock car profile rather
than forking it, and multiplies the rate by `1 + score * 5.0`.

### Why the constant is 5.0

[`pipeline/check-routing.py`](pipeline/check-routing.py) answers "does this
actually change the road taken?" with a plain Dijkstra over the tagged corridor,
using the same weight formula as the Lua. It needs no routing engine, so the
question can be settled without Docker or a server.

The constant is not a free tuning range. A detour is only ever justified while
`t_scenic / t_fastest < (1 + s_scenic·k) / (1 + s_fastest·k)`, and as `k` grows
that bound converges on the **ratio of the two scores**. So past a point, more
`k` buys nothing. Measured on Phoenix → Sedona:

| `k` | Result |
|---|---|
| 0.15 | **identical to the fastest route** — the original value was a no-op |
| 2–3 | +15% time, mostly one freeway swapped for another |
| **5** | **Beeline Hwy → Payson → Mogollon Rim → Red Rock: +55% distance, +91% time** |
| 8–20 | identical to 5 — saturated |

At 5 it picks the drive an Arizonan would name: the Beeline over the Rim, all
paved. 4h03 against 2h07, and because OSRM keeps `duration` separate from
`weight`, the app reports that honestly rather than pretending it's quick.

**Cost must be travel time, not distance.** Weighting by distance alone made a
20 km/h dirt track look equal to a 90 km/h highway and sent the route down
Fossil Creek Road, an unpaved forest track. That was a flaw in the measurement,
not the scoring — and had it gone unnoticed, the constant would have been tuned
to compensate for it.

**Honest limit: Tempe → Gilbert barely moves** (+0.2 score, 79% shared road) at
any `k`. The urban tier gives it a gradient, but a grid of arterials through
Gilbert has no scenic alternative to find. This README opens with that trip as
the headline scenario; the data says it is the *weakest* case for the idea, and
long rural drives are where it earns its keep.

Building the graph, after stage 6 (needs Docker and a few GB of free RAM —
more than the dev laptop has, so this runs on the server):

```bash
cd pipeline/extract
OSRM="docker run -t -v $PWD:/data -v $PWD/../../routing:/profile ghcr.io/project-osrm/osrm-backend"
$OSRM osrm-extract -p /profile/scenic.lua /data/arizona-scenic.osm.pbf
$OSRM osrm-partition /data/arizona-scenic.osrm
$OSRM osrm-customize /data/arizona-scenic.osrm
docker run -t -p 5000:5000 -v $PWD:/data ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/arizona-scenic.osrm
```

Run the same three steps with `-p /opt/car.lua` into a second directory to get
the `fastest` engine. Two graphs, one scenic and one plain, is simpler than one
graph trying to serve both.

### What the scenic signals are actually worth

Stage 5 measures each signal against ground truth: roads Arizona has officially
designated as scenic should score better than ordinary roads. Gap is in 200 m
cells, positive meaning byways are closer.

| Signal | Gap | Use |
|---|---|---|
| `wood_prox` | **+4.16** | The scenic signal. Weight it heavily. |
| `wilderness_prox` | +0.62 | Real but weak. Modest weight. |
| `water_prox` | −0.25 | No signal — Arizona has almost no surface water. |
| `park_prox` | **−3.17** | **Not scenic.** Measures urbanness; see below. |

`leisure=park` is municipal playing fields, so city streets score *best* on it
and designated byways score *worst*. Weighted as a scenic positive **statewide**
it would steer scenic routes into Phoenix. Stage 5 asserts its sign stays
negative so a later change can't quietly adopt it as a statewide positive.

**But it is the only signal a city has.** Sampling the grid across the
Tempe → Gilbert corridor — the first scenario on this README — every point
scored 0 on woodland and wilderness, so scenic and fastest would have returned
the identical route for the project's own headline example. Both facts are
true at once: near a park is a poor proxy for scenic *across Arizona*, and the
best available answer *inside a city*, where there is no forest to prefer
instead.

So the urban signal is a fallback, used only where nothing natural is in reach,
and scaled so it tops out at **4** while a road inside forest scores 7–10. A
city street can't outrank a forest road; it can only beat another city street.
That restored a gradient across the metro (Gilbert 4, mid-corridor 3) without
touching any score in the north.

Sanity from the named assertions: Oak Creek Canyon, Red Rock and San Francisco
Peaks all score `0.00` on woodland, meaning every sampled point along them sits
inside forest, against a statewide mean of 8.43.

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
- **The routing graph is built on the server, not locally.** The build is
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
- Routing: precomputed scenic routes for the listed trips (see the pipeline),
  plus the [OSRM](https://project-osrm.org/) demo server (free, no key) for
  typed places, proxied via `/api/directions`
- Terrain: open [elevation tiles](https://registry.opendata.aws/terrain-tiles/)
  on AWS Open Data, hillshaded by MapLibre (free, no key)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Status

**Scenic routing works.** Pick one of the listed trips and the map draws both
the fast way and the pretty way, with the one you are not looking at left on
as a dashed line. Phoenix → Sedona comes back as the Beeline over the Mogollon
Rim and down into Sedona on the Red Rock byway: 179 mi and 4h03, against the
interstate's 115 mi and 2h07. The map is terrain-shaded, so the reason for the
detour is visible rather than merely asserted.

Those routes are precomputed by the pipeline and shipped as a file, which is
why the demo needs no routing server and cannot go down. Typing your own two
places still works and still returns the fastest route from the public server.

What is left is the server that would make scenic routing work for any two
places rather than the listed five. Everything it needs is built — the scored
map, the routing profile, and a check proving the weighting changes the road
taken — and the remaining step is standing OSRM up on the tagged extract.
