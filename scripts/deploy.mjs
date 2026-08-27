// Deploys and points the live address at what was just deployed.
// Run: npm run deploy

import { execSync } from "node:child_process"

const SITE = "trailblaze-az.vercel.app"

// `vercel deploy --prod` creates a production deployment but does NOT move an
// alias that was assigned by hand, so the site kept serving a six-day-old build
// while every deploy reported success. Both steps, every time.
function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
}

console.log("Deploying")
const output = run("vercel deploy --prod --yes")

const deployment = output.match(/trailblaze-[a-z0-9]+-[a-z0-9-]+\.vercel\.app/)?.[0]
if (!deployment) {
  console.error("Could not find a deployment URL in the output. Not touching the alias.")
  console.error(output.slice(-600))
  process.exit(1)
}
console.log(`  ${deployment}`)

console.log(`Pointing ${SITE} at it`)
run(`vercel alias set ${deployment} ${SITE}`)

// Reading the live file rather than an exit code. Checking a deploy with
// something that cannot fail is how the stale site went unnoticed.
console.log("Checking what is actually being served")
const res = await fetch(`https://${SITE}/demo-routes.json`, { cache: "no-store" })
if (!res.ok) {
  console.error(`  live site returned ${res.status}`)
  process.exit(1)
}
const trips = await res.json()
const withStops = trips.filter((t) => t.stops?.length).length
const withProfile = trips.filter((t) => t.scenic?.profile).length

console.log(`  ${trips.length} trips, ${withStops} with stops, ${withProfile} with profiles`)
if (trips.length === 0 || withStops < trips.length || withProfile < trips.length) {
  console.error("  live data is incomplete — did stages 10 and 11 run after 9?")
  process.exit(1)
}
console.log(`\nLive: https://${SITE}`)
