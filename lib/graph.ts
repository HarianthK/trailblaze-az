// Routing in the browser, over a graph the pipeline exported. There is no
// routing server because this laptop cannot host one, and it turns out not to
// need one: the scenic scores are already baked into the edges, so the only
// thing left is a shortest path, which is milliseconds over this many edges.

export type Graph = {
  lon: Float32Array
  lat: Float32Array
  edgeA: Int32Array
  edgeB: Int32Array
  edgeSeconds: Float32Array
  edgeScore: Int8Array
  edgeOneway: Int8Array
  edgeShapeLen: Uint16Array
  shapeDeltas: Int16Array
  shapeStart: Int32Array
  // Adjacency, built once on load: for each node, the edges leaving it.
  head: Int32Array
  next: Int32Array
  from: Int32Array
}

const MAGIC = "TBAZ"

export function parseGraph(buffer: ArrayBuffer): Graph {
  const view = new DataView(buffer)
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4))
  if (magic !== MAGIC) throw new Error(`not a graph file (magic ${magic})`)

  const nodes = view.getUint32(4, true)
  const edges = view.getUint32(8, true)
  const shapes = view.getUint32(12, true)

  let at = 16
  const take = <T>(make: (b: ArrayBuffer, o: number, n: number) => T, n: number, size: number) => {
    const out = make(buffer, at, n)
    at += n * size
    return out
  }

  const lon = take((b, o, n) => new Float32Array(b, o, n), nodes, 4)
  const lat = take((b, o, n) => new Float32Array(b, o, n), nodes, 4)
  const edgeA = take((b, o, n) => new Int32Array(b, o, n), edges, 4)
  const edgeB = take((b, o, n) => new Int32Array(b, o, n), edges, 4)
  const edgeSeconds = take((b, o, n) => new Float32Array(b, o, n), edges, 4)
  const edgeScore = take((b, o, n) => new Int8Array(b, o, n), edges, 1)
  const edgeOneway = take((b, o, n) => new Int8Array(b, o, n), edges, 1)
  // Uint16 needs 2-byte alignment, which the two Int8 blocks may have broken.
  if (at % 2) at += 1
  const edgeShapeLen = new Uint16Array(buffer.slice(at, at + edges * 2))
  at += edges * 2
  // Two int16 per shape point: an offset in lon and one in lat.
  const shapeDeltas = new Int16Array(buffer.slice(at, at + shapes * 4))

  // Where each edge's shape begins, so drawing does not have to scan.
  const shapeStart = new Int32Array(edges)
  let running = 0
  for (let e = 0; e < edges; e++) {
    shapeStart[e] = running
    running += edgeShapeLen[e]
  }

  // Linked-list adjacency: cheaper to build than arrays of arrays, and it keeps
  // everything in typed arrays so the whole graph stays one flat allocation.
  const directed = edges * 2
  const head = new Int32Array(nodes).fill(-1)
  const next = new Int32Array(directed).fill(-1)
  const from = new Int32Array(directed)
  let slot = 0
  const link = (node: number, ref: number) => {
    from[slot] = ref
    next[slot] = head[node]
    head[node] = slot
    slot++
  }
  for (let e = 0; e < edges; e++) {
    link(edgeA[e], e)
    if (!edgeOneway[e]) link(edgeB[e], ~e) // ~e marks the reverse direction
  }

  return {
    lon, lat, edgeA, edgeB, edgeSeconds, edgeScore, edgeOneway,
    edgeShapeLen, shapeDeltas, shapeStart, head, next, from,
  }
}

const R = 6_371_000
export function haversine(aLon: number, aLat: number, bLon: number, bLat: number) {
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((bLon - aLon) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Nearest junction to a point. Linear, because 80k nodes is a fraction of a
 *  millisecond and an index would be more code for no felt difference. */
export function nearestNode(graph: Graph, lon: number, lat: number) {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < graph.lon.length; i++) {
    const d = (graph.lon[i] - lon) ** 2 + (graph.lat[i] - lat) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// Must match routing/scenic.lua and pipeline/check-routing.py. Measured, not
// chosen: below about 2 it changes nothing, above 5 it changes nothing either.
export const BOOST_PER_POINT = 5.0

// Undoes the delta encoding: shape points as [lon, lat], offsets accumulated
// from the edge's own first junction.
const SCALE = 100_000
function shapeOf(graph: Graph, edge: number, fromNode: number): [number, number][] {
  const count = graph.edgeShapeLen[edge]
  if (!count) return []
  const at = graph.shapeStart[edge]
  const out: [number, number][] = []
  let lon = graph.lon[graph.edgeA[edge]]
  let lat = graph.lat[graph.edgeA[edge]]
  for (let i = 0; i < count; i++) {
    lon += graph.shapeDeltas[(at + i) * 2] / SCALE
    lat += graph.shapeDeltas[(at + i) * 2 + 1] / SCALE
    out.push([lon, lat])
  }
  // Stored in the A-to-B direction; reverse it when travelling the other way.
  return fromNode === graph.edgeA[edge] ? out : out.reverse()
}

export type Routed = { coordinates: [number, number][]; distanceMeters: number; durationSeconds: number }

/**
 * Dijkstra with a binary heap. `boost` of 0 is the fastest route; the scenic
 * one divides each edge's cost by its prettiness, exactly as the Lua profile
 * does, so the two agree about what a scenic road is worth.
 */
export function route(graph: Graph, start: number, goal: number, boost: number): Routed | null {
  const n = graph.lon.length
  const dist = new Float64Array(n).fill(Infinity)
  const cameFrom = new Int32Array(n).fill(-1)
  const cameBy = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)

  // Flat binary heap of (cost, node) pairs. An array of objects allocates
  // hundreds of thousands of them for a single route.
  const heapCost: number[] = [0]
  const heapNode: number[] = [start]
  dist[start] = 0

  const swap = (i: number, j: number) => {
    ;[heapCost[i], heapCost[j]] = [heapCost[j], heapCost[i]]
    ;[heapNode[i], heapNode[j]] = [heapNode[j], heapNode[i]]
  }
  const push = (cost: number, node: number) => {
    heapCost.push(cost)
    heapNode.push(node)
    let i = heapCost.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heapCost[parent] <= heapCost[i]) break
      swap(parent, i)
      i = parent
    }
  }
  const pop = () => {
    const node = heapNode[0]
    const last = heapCost.length - 1
    heapCost[0] = heapCost[last]
    heapNode[0] = heapNode[last]
    heapCost.pop()
    heapNode.pop()
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let small = i
      if (l < heapCost.length && heapCost[l] < heapCost[small]) small = l
      if (r < heapCost.length && heapCost[r] < heapCost[small]) small = r
      if (small === i) break
      swap(small, i)
      i = small
    }
    return node
  }

  while (heapCost.length) {
    const node = pop()
    if (done[node]) continue
    done[node] = 1
    if (node === goal) break

    for (let slot = graph.head[node]; slot !== -1; slot = graph.next[slot]) {
      const ref = graph.from[slot]
      const edge = ref < 0 ? ~ref : ref
      const other = ref < 0 ? graph.edgeA[edge] : graph.edgeB[edge]
      if (done[other]) continue

      const weight = graph.edgeSeconds[edge] / (1 + graph.edgeScore[edge] * boost)
      const next = dist[node] + weight
      if (next < dist[other]) {
        dist[other] = next
        cameFrom[other] = node
        cameBy[other] = edge
        push(next, other)
      }
    }
  }

  if (dist[goal] === Infinity) return null

  // Walk back, collecting the full geometry rather than junction to junction,
  // or the drawn line cuts every corner off a mountain road.
  const legs: [number, number][][] = []
  let metres = 0
  let seconds = 0
  for (let node = goal; cameFrom[node] !== -1; node = cameFrom[node]) {
    const prev = cameFrom[node]
    const edge = cameBy[node]
    seconds += graph.edgeSeconds[edge]
    const leg: [number, number][] = [
      [graph.lon[prev], graph.lat[prev]],
      ...shapeOf(graph, edge, prev),
      [graph.lon[node], graph.lat[node]],
    ]
    for (let i = 0; i + 1 < leg.length; i++) {
      metres += haversine(leg[i][0], leg[i][1], leg[i + 1][0], leg[i + 1][1])
    }
    legs.push(leg)
  }
  legs.reverse()

  const coordinates: [number, number][] = []
  for (const leg of legs) {
    for (const point of leg) {
      const last = coordinates[coordinates.length - 1]
      if (!last || last[0] !== point[0] || last[1] !== point[1]) coordinates.push(point)
    }
  }

  return { coordinates, distanceMeters: Math.round(metres), durationSeconds: Math.round(seconds) }
}
