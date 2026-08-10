import type { Coords, RouteResult } from "@/lib/types"

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving"

/** Parses "lng,lat" and rejects anything that isn't two finite numbers. */
function parseCoords(raw: string | null): Coords | null {
  if (!raw) return null
  const parts = raw.split(",")
  if (parts.length !== 2) return null

  const lng = Number(parts[0])
  const lat = Number(parts[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null

  return [lng, lat]
}

/**
 * Proxies OSRM's public demo server. That server is fine for development but
 * has no uptime guarantee and only does fastest-path driving — replacing it
 * with self-hosted Valhalla is what makes real scenic costing possible
 * (see README, Phase 2).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = parseCoords(params.get("from"))
  const to = parseCoords(params.get("to"))

  if (!from || !to) {
    return Response.json(
      { error: "Both ?from and ?to are required as 'lng,lat'." },
      { status: 400 },
    )
  }

  const url =
    `${OSRM_URL}/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?overview=full&geometries=geojson&alternatives=true`

  let upstream: Response
  try {
    upstream = await fetch(url)
  } catch {
    return Response.json({ error: "Could not reach the routing service." }, { status: 502 })
  }

  if (!upstream.ok) {
    return Response.json({ error: "Routing service returned an error." }, { status: 502 })
  }

  const data = (await upstream.json()) as {
    code: string
    routes?: Array<{
      distance: number
      duration: number
      geometry: { coordinates: Coords[] }
    }>
  }

  if (data.code !== "Ok" || !data.routes?.length) {
    return Response.json({ error: "No driving route found between those points." }, { status: 404 })
  }

  const routes: RouteResult[] = data.routes.map((route) => ({
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  }))

  return Response.json({ routes })
}
