"use client"

import { useState } from "react"
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

  return (
    <div className="relative flex-1">
      <MapView route={route} />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-start p-4 sm:p-6">
        <RouteForm onRouteChange={setRoute} />
      </div>
    </div>
  )
}
