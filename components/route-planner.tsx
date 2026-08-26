"use client"

import { useCallback, useState } from "react"
import { MapView } from "@/components/map-view"
import { RouteForm } from "@/components/route-form"
import type { RoutePreference, RouteResult, Stop } from "@/lib/types"

/**
 * Owns the selected route so the form (which fetches it) and the map (which
 * draws it) stay in sync. Exists because `app/page.tsx` is a server component
 * and can't hold this state itself.
 */
export function RoutePlanner() {
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [compare, setCompare] = useState<RouteResult | null>(null)
  const [preference, setPreference] = useState<RoutePreference>("fastest")
  const [stops, setStops] = useState<Stop[]>([])
  const [focus, setFocus] = useState<Stop | null>(null)

  // Stable, because the form calls it from an effect — a fresh function each
  // render would make that effect loop.
  const handleRouteChange = useCallback(
    (
      next: RouteResult | null,
      other: RouteResult | null = null,
      pref: RoutePreference = "fastest",
      nextStops: Stop[] = [],
    ) => {
      setRoute(next)
      setCompare(other)
      setPreference(pref)
      setStops(nextStops)
      setFocus(null)
    },
    [],
  )

  return (
    <div className="relative flex-1">
      <MapView
        route={route}
        compare={compare}
        isScenic={preference === "scenic"}
        stops={stops}
        focus={focus}
      />
      {/* Bottom sheet on a phone, floating card on a desktop. */}
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-3 sm:items-start sm:justify-start sm:p-6">
        <RouteForm onRouteChange={handleRouteChange} onFocusStop={setFocus} />
      </div>
    </div>
  )
}
