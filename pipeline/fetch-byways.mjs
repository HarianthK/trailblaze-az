// Stage 1: pull Arizona's designated scenic roads from OSM. See README Phase 2.
// Run: node pipeline/fetch-byways.mjs

import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "data", "byways.json")

// Public mirrors, tried in turn. These are free shared servers that return 504
// under load, so a single-endpoint pipeline fails constantly for no good reason.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
]
const AZ_BBOX = "31.33,-114.82,37.00,-109.04"
const ATTEMPTS = 3

// A bbox is far cheaper than an area lookup, which times out on a busy server.
const QUERY = `[out:json][timeout:120];
relation["type"="route"]["route"="road"](${AZ_BBOX});
out tags;`

const MEMBERS_QUERY = (ids) => `[out:json][timeout:180];
relation(id:${ids.join(",")});
out ids;
way(r);
out ids;`

// Roads Arizona actually designates, plus byways tagged without the network.
// "parkway" is deliberately not matched: Arizona's four designated parkways
// already carry the network tag, and the word alone is just a road name —
// it was pulling in Boulder City Parkway, which is neither scenic nor Arizona.
function isScenic(tags = {}) {
  if (tags.network === "US:AZ:Scenic") return true
  return /scenic|byway/i.test(`${tags.name ?? ""} ${tags.ref ?? ""}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(query, label) {
  let lastError = "unknown"

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    for (const mirror of MIRRORS) {
      const started = Date.now()
      try {
        const res = await fetch(mirror, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "trailblaze-az pipeline (https://github.com/HarianthK)",
          },
          body: new URLSearchParams({ data: query }),
        })
        if (!res.ok) {
          lastError = `HTTP ${res.status}`
          continue
        }
        const json = await res.json()
        const host = new URL(mirror).host
        console.log(
          `  ${label}: ${json.elements?.length ?? 0} elements in ${((Date.now() - started) / 1000).toFixed(1)}s (${host})`,
        )
        return json
      } catch (err) {
        lastError = err.message
      }
    }
    // Backing off matters — these are shared servers and we are a guest on them.
    if (attempt < ATTEMPTS) {
      const wait = attempt * 15
      console.log(`  ${label}: all mirrors busy (${lastError}); retrying in ${wait}s`)
      await sleep(wait * 1000)
    }
  }

  throw new Error(`${label}: every mirror failed (${lastError})`)
}

// Named roads that must survive any future change to the matching rules.
const MUST_INCLUDE = [
  "Red Rock Scenic Byway",
  "Coronado Trail Scenic Road",
  "Apache Trail Historic Road",
  "San Francisco Peaks Scenic Road",
]

// Checks the artifact as it will be written. An earlier version was handed a
// faked way count and so could never fail on an empty result, which is exactly
// what it existed to catch.
function validate({ byways, wayIds }) {
  const problems = []
  const names = byways.map((b) => b.name)

  if (byways.length < 20) problems.push(`only ${byways.length} byways found, expected 20+`)

  const official = byways.filter((b) => b.network === "US:AZ:Scenic").length
  if (official < 15) problems.push(`only ${official} on US:AZ:Scenic, expected ~24`)

  for (const name of MUST_INCLUDE) {
    if (!names.some((n) => n === name)) problems.push(`missing known byway: ${name}`)
  }

  // A mirror answering 200 with nothing in it is the failure mode to catch.
  if (wayIds.length < 500) {
    problems.push(`only ${wayIds.length} member ways, expected 500+ — likely a bad mirror response`)
  }

  return problems
}

// The bbox is a rectangle, so it clips corners of Nevada, Utah and Mexico.
// Reported rather than filtered: a byway crossing the state line is still
// worth routing on, and dropping it would cut real Arizona roads short.
function outOfState(byways) {
  const suspects = ["Boulder City", "Gold Butte", "Falcon Ridge", "Mesquite"]
  return byways.filter((b) => suspects.some((s) => b.name.includes(s))).map((b) => b.name)
}

async function main() {
  console.log("Stage 1 — Arizona scenic byways from OSM")

  const routes = await overpass(QUERY, "road route relations")
  const scenic = (routes.elements ?? []).filter((el) => isScenic(el.tags))
  console.log(`  of which scenic: ${scenic.length}`)

  let wayIds = []
  // Mirrors sometimes answer 200 with an empty set, so keep asking until one
  // gives a plausible answer rather than trusting the first success.
  for (let tries = 0; tries < 3 && wayIds.length < 500; tries++) {
    const members = await overpass(MEMBERS_QUERY(scenic.map((r) => r.id)), "member ways")
    wayIds = (members.elements ?? []).filter((e) => e.type === "way").map((e) => e.id)
    if (wayIds.length < 500) console.log(`  member ways: got ${wayIds.length}, retrying`)
  }

  const byways = scenic.map((r) => ({
    relationId: r.id,
    name: r.tags?.name ?? r.tags?.ref ?? "(unnamed)",
    network: r.tags?.network ?? null,
    ref: r.tags?.ref ?? null,
    // Filled per-relation in a later stage; the flat set is what tagging needs.
    wayCount: null,
  }))

  const artifact = {
    stage: "byways",
    generatedAt: new Date().toISOString(),
    source: { mirrors: MIRRORS, bbox: AZ_BBOX },
    counts: { byways: byways.length, wayIds: wayIds.length },
    byways: byways.sort((a, b) => a.name.localeCompare(b.name)),
    wayIds,
  }

  const strays = outOfState(byways)
  if (strays.length) console.log(`  note: ${strays.length} cross the state line — ${strays.join(", ")}`)

  const problems = validate(artifact)
  if (problems.length) {
    console.log("\n  VALIDATION FAILED:")
    problems.forEach((p) => console.log(`   - ${p}`))
    process.exitCode = 1
  } else {
    console.log("\n  validation passed")
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 2))
  console.log(`  wrote ${OUT}`)
  console.log(`  ${byways.length} byways, ${wayIds.length} member ways`)
}

main().catch((err) => {
  console.error("  failed:", err.message)
  process.exit(1)
})
