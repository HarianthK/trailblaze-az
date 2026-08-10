import type { GeocodeResult } from "@/lib/types"

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

// Arizona bounding box as Nominatim wants it: left,top,right,bottom.
// Paired with bounded=1 so "Tempe" can't resolve to a Tempe somewhere else.
const ARIZONA_VIEWBOX = "-114.82,37.00,-109.04,31.33"

/**
 * Proxied server-side rather than called straight from the browser for two
 * reasons: Nominatim's usage policy wants an identifying User-Agent (which a
 * browser won't let us set), and going through our own origin sidesteps CORS.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim()

  if (!query) {
    return Response.json({ error: "Missing ?q parameter" }, { status: 400 })
  }

  const url = new URL(NOMINATIM_URL)
  url.searchParams.set("q", query)
  url.searchParams.set("format", "json")
  url.searchParams.set("limit", "1")
  url.searchParams.set("countrycodes", "us")
  url.searchParams.set("viewbox", ARIZONA_VIEWBOX)
  url.searchParams.set("bounded", "1")

  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: { "User-Agent": "trailblaze-az (https://github.com/HarianthK)" },
    })
  } catch {
    return Response.json({ error: "Could not reach the geocoding service." }, { status: 502 })
  }

  if (!upstream.ok) {
    return Response.json({ error: "Geocoding service returned an error." }, { status: 502 })
  }

  const results = (await upstream.json()) as Array<{
    display_name: string
    lat: string
    lon: string
  }>

  const first = results[0]
  if (!first) {
    return Response.json({ error: `No place in Arizona matched "${query}".` }, { status: 404 })
  }

  const result: GeocodeResult = {
    label: first.display_name,
    coords: [Number(first.lon), Number(first.lat)],
  }

  return Response.json(result)
}
