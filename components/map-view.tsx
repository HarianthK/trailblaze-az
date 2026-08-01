"use client"

import { useEffect, useRef } from "react"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

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

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: ARIZONA_CENTER,
      zoom: INITIAL_ZOOM,
    })

    map.addControl(new maplibregl.NavigationControl(), "top-right")
    mapRef.current = map

    // The container's flex-based height isn't always settled by the time
    // MapLibre measures it on construction, which leaves the canvas at the
    // wrong size until something explicitly tells it to re-measure.
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(containerRef.current)
    map.once("load", () => map.resize())

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Inline style, not a Tailwind class: MapLibre's own CSS sets `position:
  // relative` on this element (it needs that for its internal controls/canvas
  // layout), which has the same specificity as Tailwind's `.absolute` and can
  // win on source order, silently collapsing this to 0 height. Inline style
  // always wins over any stylesheet, so this can't lose that fight.
  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
}
