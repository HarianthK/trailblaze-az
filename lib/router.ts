// Loads the routing graph once, on demand. It is nearly two megabytes, so it is
// never fetched just to look at the preset trips.

import { parseGraph, nearestNode, route, haversine, BOOST_PER_POINT, type Graph } from "@/lib/graph"
import type { RouteResult } from "@/lib/types"

const GZIP_MAGIC = [0x1f, 0x8b]

/**
 * A `.gz` file served as a static asset arrives still compressed, with no
 * Content-Encoding header for the browser to act on — but a CDN may decide to
 * decompress it. Rather than assume either, look at the bytes.
 */
async function unpack(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buffer, 0, 2)
  if (head[0] !== GZIP_MAGIC[0] || head[1] !== GZIP_MAGIC[1]) return buffer

  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Response(stream).arrayBuffer()
}

let loading: Promise<Graph> | null = null

export function loadGraph(): Promise<Graph> {
  if (!loading) {
    loading = fetch("/graph.bin.gz")
      .then((r) => {
        if (!r.ok) throw new Error(`graph ${r.status}`)
        return r.arrayBuffer()
      })
      .then(unpack)
      .then(parseGraph)
      .catch((err) => {
        loading = null // so a later attempt can retry rather than fail forever
        throw err
      })
  }
  return loading
}

export type LocalRoutes = { fastest: RouteResult; scenic: RouteResult } | null

// How far a typed place can sit from the nearest road before the answer would
// be a fiction. The graph covers a corridor, not the state.
const MAX_SNAP_M = 15_000

export async function routeLocally(
  from: [number, number],
  to: [number, number],
): Promise<LocalRoutes> {
  const graph = await loadGraph()

  const a = nearestNode(graph, from[0], from[1])
  const b = nearestNode(graph, to[0], to[1])
  const snapA = haversine(from[0], from[1], graph.lon[a], graph.lat[a])
  const snapB = haversine(to[0], to[1], graph.lon[b], graph.lat[b])
  if (snapA > MAX_SNAP_M || snapB > MAX_SNAP_M) return null

  const fastest = route(graph, a, b, 0)
  const scenic = route(graph, a, b, BOOST_PER_POINT)
  if (!fastest || !scenic) return null

  return { fastest, scenic }
}
