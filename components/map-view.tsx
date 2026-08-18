"use client"

import { useEffect, useRef, useState } from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import type { RouteResult } from "@/lib/types"

// NOTE: pinned to maplibre-gl v5 — on v6.1.0 the map never finishes loading
// (`load` never fires, isStyleLoaded() stays false, canvas renders only the
// background color) with no console error. Reproduced against both this style
// and MapLibre's own demo style, so it isn't tile-provider specific. Retest
// before bumping to v6.

// Roughly centers the Phoenix-Tempe-Gilbert metro, where the first routing
// scenarios (Tempe -> Gilbert) live. Free public style, no API key needed —
// see README for the plan to move to a self-hosted Arizona-only tile set.
const ARIZONA_CENTER: [number, number] = [-111.83, 33.36]
const INITIAL_ZOOM = 9.5
// Dark, to match the panel. On the default light style the route had to
// compete with a hundred orange roads and every cafe in Phoenix.
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark"

const ROUTE_SOURCE = "route"
const ROUTE_CASING_LAYER = "route-casing"
const ROUTE_LINE_LAYER = "route-line"

// The route not currently chosen, drawn faintly underneath so the difference
// between fastest and scenic is visible at a glance rather than by toggling.
const COMPARE_SOURCE = "route-compare"
const COMPARE_LAYER = "route-compare-line"

// Free elevation tiles on AWS Open Data — no key, no limit, same as the map.
const DEM_SOURCE = "terrain-dem"
const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
const HILLSHADE_LAYER = "hillshade"

// Leaves room for the panel, which sits to the left on a desktop and along the
// bottom on a phone. Reserving 440px on the left of a 390px screen made the
// route impossible to fit, so the map just showed somewhere else entirely.
const isNarrow = () => typeof window !== "undefined" && window.innerWidth < 640

function fitPadding() {
  if (!isNarrow()) return { top: 90, bottom: 120, left: 440, right: 90 }
  // The sheet is capped at 60vh, so the route has to clear that much plus the
  // gap under it, or half the drive ends up hidden behind the panel.
  return { top: 70, bottom: Math.round(window.innerHeight * 0.6) + 30, left: 28, right: 28 }
}

// Matches the panel's palette in app/globals.css.
const SCENIC = "#e08a3c"
const FASTEST = "#6b8cae"

function emptyLine(coordinates: RouteResult["coordinates"]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  }
}

export function MapView({
  route,
  compare = null,
  isScenic = false,
}: {
  route: RouteResult | null
  compare?: RouteResult | null
  isScenic?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [styleReady, setStyleReady] = useState(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: ARIZONA_CENTER,
      zoom: INITIAL_ZOOM,
      // The style ships its own attribution control, so the default one made
      // every credit appear twice. One control, all the credits.
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl(), "top-right")

    // The style credits OSM for the tiles; routing is a separate service with
    // its own attribution requirement under ODbL.
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          'Routing by <a href="https://project-osrm.org/">OSRM</a> · Geocoding by <a href="https://nominatim.org/">Nominatim</a> · Tiles <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
      }),
      // On a phone the sheet occupies the bottom, so the credits move to the
      // only free corner. They are required to stay visible.
      isNarrow() ? "top-left" : "bottom-right",
    )

    mapRef.current = map

    map.on("load", () => {
      // Shops, cafes and fuel stations are noise on a map about which highway
      // to take. Place names stay — they are how you read where a route goes.
      const layers = map.getStyle().layers ?? []
      for (const layer of layers) {
        if (layer.type === "symbol" && /poi|shop|amenity/i.test(layer.id)) {
          map.setLayoutProperty(layer.id, "visibility", "none")
        }
      }

      // Terrain is the point of the whole app: on a flat map there is no
      // visible reason why the scenic route goes the long way round. Shaded,
      // you can see the Mogollon Rim it climbs over and the interstate skirting it.
      map.addSource(DEM_SOURCE, {
        type: "raster-dem",
        tiles: [DEM_TILES],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 13,
        attribution:
          'Elevation <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> on AWS Open Data',
      })

      // Under the roads, so it reads as ground rather than an overlay on top.
      const firstLine = layers.find((l) => l.type === "line")?.id
      map.addLayer(
        {
          id: HILLSHADE_LAYER,
          type: "hillshade",
          source: DEM_SOURCE,
          paint: {
            "hillshade-exaggeration": 0.55,
            "hillshade-shadow-color": "#05070a",
            "hillshade-highlight-color": "#6d6552",
            "hillshade-accent-color": "#1b2028",
          },
        },
        firstLine,
      )
      // Compact mode starts expanded, which on a phone covers a quarter of the
      // map. Collapse it to the (i); tapping that still opens the credits.
      if (isNarrow()) {
        map
          .getContainer()
          .querySelector(".maplibregl-ctrl-attrib")
          ?.classList.remove("maplibregl-compact-show")
      }

      map.resize()
      setStyleReady(true)
    })

    // The container's flex-based height isn't always settled by the time
    // MapLibre measures it on construction, which leaves the canvas at the
    // wrong size until something explicitly tells it to re-measure.
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      setStyleReady(false)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    const coordinates = route?.coordinates ?? []
    const compareCoords = compare?.coordinates ?? []
    const source = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
    const compareSource = map.getSource(COMPARE_SOURCE) as maplibregl.GeoJSONSource | undefined

    if (compareSource) {
      compareSource.setData(emptyLine(compareCoords))
    } else {
      // Added before the chosen route so it always sits underneath it.
      map.addSource(COMPARE_SOURCE, { type: "geojson", data: emptyLine(compareCoords) })
      map.addLayer({
        id: COMPARE_LAYER,
        type: "line",
        source: COMPARE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          // Pale enough to read on a dark basemap, faint enough to stay behind
          // the route you actually chose.
          "line-color": "#c8cdd4",
          "line-width": 2.5,
          "line-opacity": 0.45,
          "line-dasharray": [2, 2],
        },
      })
    }

    if (source) {
      source.setData(emptyLine(coordinates))
    } else {
      // lineMetrics is what makes `line-progress` available, which is how the
      // draw-on animation below works.
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: emptyLine(coordinates),
        lineMetrics: true,
      })

      // Three layers: a dark casing so the line survives pale desert and dense
      // city blocks alike, a soft glow, then the line itself.
      map.addLayer({
        id: ROUTE_CASING_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        // A glow rather than a casing: on a dark map a dark outline does
        // nothing, but a soft bloom under the line makes it sit above.
        paint: { "line-color": SCENIC, "line-width": 14, "line-opacity": 0.16, "line-blur": 10 },
      })
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": SCENIC, "line-width": 5 },
      })
    }

    // Warm for scenic, cool for fastest — the same pairing as the panel, so the
    // colour alone says which route is on top.
    if (map.getLayer(ROUTE_CASING_LAYER)) {
      map.setPaintProperty(ROUTE_CASING_LAYER, "line-color", isScenic ? SCENIC : FASTEST)
    }

    if (coordinates.length === 0) return

    // Framed around both routes, or the scenic detour falls off the screen.
    const all = [...coordinates, ...compareCoords]
    const bounds = all.reduce(
      (acc, coord) => acc.extend(coord),
      new maplibregl.LngLatBounds(all[0], all[0]),
    )
    map.fitBounds(bounds, { padding: fitPadding(), duration: 900 })

    // Draws the line on rather than snapping it in, by sliding the point where
    // the gradient goes transparent from the start of the route to the end.
    // (Animating line-dasharray looks like the obvious way and is not: MapLibre
    // rebuilds a dash texture per value and throws on a zero-length dash.)
    const layer = ROUTE_LINE_LAYER
    if (!map.getLayer(layer)) return

    const colour = isScenic ? SCENIC : FASTEST
    const CLEAR = "rgba(0,0,0,0)"
    let frame = 0
    const started = performance.now()
    const DRAW_MS = 850

    const step = (now: number) => {
      const t = Math.min((now - started) / DRAW_MS, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      // Stops must strictly ascend, so keep the cut off both ends.
      const cut = Math.min(Math.max(eased, 0.002), 0.998)
      map.setPaintProperty(layer, "line-gradient", [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        colour,
        cut,
        colour,
        Math.min(cut + 0.001, 0.999),
        CLEAR,
        1,
        CLEAR,
      ])
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [route, compare, isScenic, styleReady])

  // Inline style, not a Tailwind class: MapLibre's own CSS sets `position:
  // relative` on this element (it needs that for its internal controls/canvas
  // layout), which has the same specificity as Tailwind's `.absolute` and can
  // win on source order, silently collapsing this to 0 height. Inline style
  // always wins over any stylesheet, so this can't lose that fight.
  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
}
