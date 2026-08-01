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

**Phase 0 (now — this skeleton):** app shell, map, route search UI. No real
routing yet.

**Phase 1 (next):** wire up [OpenRouteService](https://openrouteservice.org/)'s
free public API for real point-to-point routing, so the whole app works
end-to-end before any infrastructure gets built. ORS also has some
elevation/avoid-features options that can approximate "scenic" as a
starting point.

**Phase 2:** self-host Valhalla on an Arizona OSM extract, with a
precomputed scenic score per road segment (proximity to Scenic Byways,
parks, water, elevation change) feeding its custom costing model. This is
the actual differentiator — everything before this phase is table stakes.

**Phase 3:** POI-aware routing — given a computed route, surface
restaurants/hotels/gas stations within a small detour-time buffer of the
corridor, and let the user insert one as a waypoint.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- [MapLibre GL JS](https://maplibre.org/) for the map (open-source, no
  vendor lock-in)
- Tiles currently via [OpenFreeMap](https://openfreemap.org/) (free, no API
  key, no rate limit) — may move to a self-hosted
  [Protomaps](https://protomaps.com/)/PMTiles Arizona-only extract later for
  full control
- Routing: none yet (Phase 0) → OpenRouteService (Phase 1) → self-hosted
  Valhalla (Phase 2)

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Status

Skeleton only. The route search form in the UI doesn't call anything real
yet — see Phase 1 above.
