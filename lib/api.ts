import type { Coords, GeocodeResult, RouteResult } from "@/lib/types"

/** Thrown with a message that's safe to show the user directly. */
export class ApiError extends Error {}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const body = (await response.json()) as { error?: string }
    if (body.error) message = body.error
  } catch {
    // Non-JSON error body — stick with the fallback.
  }
  throw new ApiError(message)
}

export async function geocode(query: string): Promise<GeocodeResult> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
  if (!response.ok) {
    await readError(response, `Couldn't find "${query}".`)
  }
  return response.json()
}

export async function fetchRoutes(from: Coords, to: Coords): Promise<RouteResult[]> {
  const params = new URLSearchParams({
    from: `${from[0]},${from[1]}`,
    to: `${to[0]},${to[1]}`,
  })

  const response = await fetch(`/api/directions?${params}`)
  if (!response.ok) {
    await readError(response, "Couldn't find a route between those places.")
  }

  const { routes } = (await response.json()) as { routes: RouteResult[] }
  return routes
}
