/** [longitude, latitude] — the order MapLibre, GeoJSON, and OSRM all use. */
export type Coords = [number, number]

export type RoutePreference = "fastest" | "scenic"

export type GeocodeResult = {
  label: string
  coords: Coords
}

export type RouteResult = {
  coordinates: Coords[]
  distanceMeters: number
  durationSeconds: number
}
