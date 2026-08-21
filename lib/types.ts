/** [longitude, latitude] — the order MapLibre, GeoJSON, and OSRM all use. */
export type Coords = [number, number]

export type RoutePreference = "fastest" | "scenic"

// Routes worked out offline by the pipeline, so the site can show real scenic
// routing without a routing server. See pipeline/make-demo-routes.py.
// Places worth stopping at, found near the scenic route by the pipeline.
// `alongM` is how far into the drive they are, so they list in the order you
// would pass them rather than alphabetically.
export type Stop = {
  name: string
  kind: "viewpoint" | "food" | "fuel"
  coord: [number, number]
  detourM: number
  alongM: number
}

export type DemoTrip = {
  key: string
  from: string
  to: string
  fastest: RouteResult & { scenicScore: number }
  scenic: RouteResult & { scenicScore: number }
  stops?: Stop[]
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
