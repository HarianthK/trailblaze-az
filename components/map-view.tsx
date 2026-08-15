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
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty"

const ROUTE_SOURCE = "route"
const ROUTE_CASING_LAYER = "route-casing"
const ROUTE_LINE_LAYER = "route-line"

// The route not currently chosen, drawn faintly underneath so the difference
// between fastest and scenic is visible at a glance rather than by toggling.
const COMPARE_SOURCE = "route-compare"
const COMPARE_LAYER = "route-compare-line"

// Leaves room for the search panel, which floats over the map's left side.
const FIT_PADDING = { top: 80, bottom: 80, left: 440, right: 80 }

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
}: {
  route: RouteResult | null
  compare?: RouteResult | null
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
    })

    map.addControl(new maplibregl.NavigationControl(), "top-right")

    // The style credits OSM for the tiles; routing is a separate service with
    // its own attribution requirement under ODbL.
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          'Routing by <a href="https://project-osrm.org/">OSRM</a> · Geocoding by <a href="https://nominatim.org/">Nominatim</a> · Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
      }),
      "bottom-right",
    )

    mapRef.current = map

    map.on("load", () => {
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
        paint: { "line-color": "#71717a", "line-width": 4, "line-opacity": 0.55, "line-dasharray": [2, 1.5] },
      })
    }

    if (source) {
      source.setData(emptyLine(coordinates))
    } else {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyLine(coordinates) })

      // Two layers so the route reads clearly over both pale desert and dense
      // city blocks: a light casing underneath, the colored line on top.
      map.addLayer({
        id: ROUTE_CASING_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
      })
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#1d4ed8", "line-width": 5 },
      })
    }

    if (coordinates.length === 0) return

    // Framed around both routes, or the scenic detour falls off the screen.
    const all = [...coordinates, ...compareCoords]
    const bounds = all.reduce(
      (acc, coord) => acc.extend(coord),
      new maplibregl.LngLatBounds(all[0], all[0]),
    )
    map.fitBounds(bounds, { padding: FIT_PADDING, duration: 800 })
  }, [route, compare, styleReady])

  // Inline style, not a Tailwind class: MapLibre's own CSS sets `position:
  // relative` on this element (it needs that for its internal controls/canvas
  // layout), which has the same specificity as Tailwind's `.absolute` and can
  // win on source order, silently collapsing this to 0 height. Inline style
  // always wins over any stylesheet, so this can't lose that fight.
  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
}
