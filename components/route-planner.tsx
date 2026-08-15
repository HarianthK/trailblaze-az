"use client"

import { useCallback, useState } from "react"
import { MapView } from "@/components/map-view"
import { RouteForm } from "@/components/route-form"
import type { RouteResult } from "@/lib/types"

/**
 * Owns the selected route so the form (which fetches it) and the map (which
 * draws it) stay in sync. Exists because `app/page.tsx` is a server component
 * and can't hold this state itself.
 */
export function RoutePlanner() {
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [compare, setCompare] = useState<RouteResult | null>(null)

  // Stable, because the form calls it from an effect — a fresh function each
  // render would make that effect loop.
  const handleRouteChange = useCallback(
    (next: RouteResult | null, other: RouteResult | null = null) => {
      setRoute(next)
      setCompare(other)
    },
    [],
  )

  return (
    <div className="relative flex-1">
      <MapView route={route} compare={compare} />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-start p-4 sm:p-6">
        <RouteForm onRouteChange={handleRouteChange} />
      </div>
    </div>
  )
}
