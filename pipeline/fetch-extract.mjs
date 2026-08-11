// Stage 2: fetch the Arizona OSM extract. See README Phase 2.
// Run: node pipeline/fetch-extract.mjs

import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync, renameSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, "extract")
const PBF = join(DIR, "arizona-latest.osm.pbf")
const PART = `${PBF}.part`
const STAMP = join(HERE, "data", "extract.json")

const BASE = "https://download.geofabrik.de/north-america/us/arizona-latest.osm.pbf"
const USER_AGENT = "trailblaze-az pipeline (https://github.com/HarianthK)"

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)

async function publishedChecksum() {
  const res = await fetch(`${BASE}.md5`, { headers: { "User-Agent": USER_AGENT } })
  if (!res.ok) throw new Error(`checksum fetch failed: HTTP ${res.status}`)
  return (await res.text()).trim().split(/\s+/)[0]
}

function md5Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5")
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
  })
}

// Resumes a partial file with a Range request. A 287 MB download over a home
// connection fails often enough that restarting from zero is a real cost.
async function download(expected) {
  const done = existsSync(PART) ? statSync(PART).size : 0
  const headers = { "User-Agent": USER_AGENT }
  if (done > 0) {
    headers.Range = `bytes=${done}-`
    console.log(`  resuming at ${mb(done)} MB`)
  }

  const res = await fetch(BASE, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  // A server that ignores Range answers 200 with the whole file, in which case
  // appending would corrupt it — start over rather than produce a broken PBF.
  const resuming = res.status === 206
  if (done > 0 && !resuming) console.log("  server ignored resume; starting over")

  const total = Number(res.headers.get("content-length") ?? 0) + (resuming ? done : 0)
  let seen = resuming ? done : 0
  let lastLogged = 0

  const source = Readable.fromWeb(res.body)
  source.on("data", (chunk) => {
    seen += chunk.length
    if (seen - lastLogged < 25 * 1024 * 1024) return
    lastLogged = seen
    const pct = total ? ` (${((seen / total) * 100).toFixed(0)}%)` : ""
    console.log(`  ${mb(seen)} MB${pct}`)
  })

  await pipeline(source, createWriteStream(PART, { flags: resuming ? "a" : "w" }))

  console.log("  verifying checksum")
  const actual = await md5Of(PART)
  if (actual !== expected) throw new Error(`checksum mismatch: got ${actual}, expected ${expected}`)

  renameSync(PART, PBF)
}

async function main() {
  console.log("Stage 2 — Arizona OSM extract from Geofabrik")
  mkdirSync(DIR, { recursive: true })
  mkdirSync(dirname(STAMP), { recursive: true })

  const expected = await publishedChecksum()

  // Geofabrik rebuilds daily. Re-downloading an unchanged file is 287 MB of
  // someone else's bandwidth for nothing, so verify before deciding.
  if (existsSync(PBF)) {
    const actual = await md5Of(PBF)
    if (actual === expected) {
      console.log(`  already current (${mb(statSync(PBF).size)} MB), nothing to do`)
      return stamp(expected)
    }
    console.log("  local copy is stale, re-downloading")
  }

  await download(expected)
  console.log(`  wrote ${PBF} (${mb(statSync(PBF).size)} MB)`)
  stamp(expected)
}

// The extract itself is gitignored, so this records which one the committed
// artifacts were built from — otherwise a route can't be traced to its data.
function stamp(md5) {
  writeFileSync(
    STAMP,
    JSON.stringify(
      {
        stage: "extract",
        generatedAt: new Date().toISOString(),
        source: BASE,
        md5,
        bytes: statSync(PBF).size,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error("  failed:", err.message)
  process.exit(1)
})
