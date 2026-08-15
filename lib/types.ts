/** [longitude, latitude] — the order MapLibre, GeoJSON, and OSRM all use. */
export type Coords = [number, number]

export type RoutePreference = "fastest" | "scenic"

// Routes worked out offline by the pipeline, so the site can show real scenic
// routing without a routing server. See pipeline/make-demo-routes.py.
export type DemoTrip = {
  key: string
  from: string
  to: string
  fastest: RouteResult & { scenicScore: number }
  scenic: RouteResult & { scenicScore: number }
}

export type GeocodeResult = {
  label: string
  coords: Coords
}

export type RouteResult = {
  coordinates: Coords[]
  distanceMeters: number
  durationSeconds: number
}
