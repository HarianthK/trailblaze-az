"use client"

import { useSyncExternalStore } from "react"
import { formatClock, sunTimes } from "@/lib/sun"
import type { RouteResult, Stop } from "@/lib/types"

type Props = {
  route: RouteResult
  stops: Stop[]
  to: string
}

// The best thing to arrive at in good light is the last viewpoint on the route.
// Falling back to the destination keeps the advice useful on a drive that has
// no marked viewpoint, which is most of them.
function target(route: RouteResult, stops: Stop[]) {
  // Only a viewpoint in the back half of the drive is worth timing for. On
  // Phoenix to Jerome the sole viewpoint sits eight miles in, and aiming for
  // golden hour there means setting off at dusk with 168 miles still to go.
  const late = stops.filter(
    (s) => s.kind === "viewpoint" && s.alongM > route.distanceMeters * 0.5,
  )
  const last = late[late.length - 1]
  if (last) return { name: last.name, coord: last.coord, alongM: last.alongM }

  const end = route.coordinates[route.coordinates.length - 1]
  return { name: null, coord: end, alongM: route.distanceMeters }
}

export function GoldenHour({ route, stops, to }: Props) {
  // Client only, on purpose: the answer depends on today's date and the
  // reader's own clock, so a server-rendered time would be wrong for anyone in
  // another timezone and stale by morning. This is the subscription-free way to
  // ask "am I on the client", which avoids setting state inside an effect.
  const onClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  if (!onClient) return null

  const now = new Date()

  const spot = target(route, stops)
  const sun = sunTimes(now, spot.coord[1], spot.coord[0])
  if (!sun) return null

  // How long into the drive that spot is, assuming a steady pace over the route.
  const fraction = route.distanceMeters ? spot.alongM / route.distanceMeters : 1
  const secondsToSpot = route.durationSeconds * fraction
  const leaveBy = new Date(sun.goldenHour.getTime() - secondsToSpot * 1000)

  const missed = leaveBy.getTime() < now.getTime()
  const where = spot.name ?? to

  return (
    <div className="flex flex-col gap-1 border-t border-white/[0.07] pt-3">
      <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted">
        Best light
      </span>
      <p className="text-[0.7rem] leading-relaxed text-muted">
        {missed ? (
          <>
            Too late for golden hour at <span className="text-foreground">{where}</span> today.
            Leave by <span className="tnum text-scenic">{formatClock(leaveBy)}</span> tomorrow.
          </>
        ) : (
          <>
            Leave by <span className="tnum text-scenic">{formatClock(leaveBy)}</span> to reach{" "}
            <span className="text-foreground">{where}</span> in golden hour.
          </>
        )}{" "}
        Sunset there is <span className="tnum">{formatClock(sun.sunset)}</span>.
      </p>
    </div>
  )
}
