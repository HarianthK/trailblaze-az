"use client"

import { useSyncExternalStore } from "react"
import { formatClock, sunTimes } from "@/lib/sun"
import type { DemoTrip, Stop } from "@/lib/types"

// A day out, not a one-way journey. Nobody driving to Sedona on a Sunday is
// moving house, so the useful question is whether it fits into today.
const HOURS_THERE = 2
const LEAVE_HOUR = 8

function hhmm(seconds: number) {
  const total = Math.round(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

function lastViewpoint(stops: Stop[]) {
  const views = stops.filter((s) => s.kind === "viewpoint")
  return views[views.length - 1] ?? null
}

export function DayTrip({ trip }: { trip: DemoTrip }) {
  const onClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  if (!onClient) return null

  const out = trip.scenic
  const back = trip.fastest
  const driving = out.durationSeconds + back.durationSeconds

  const now = new Date()
  const leave = new Date(now)
  leave.setHours(LEAVE_HOUR, 0, 0, 0)
  const home = new Date(leave.getTime() + (driving + HOURS_THERE * 3600) * 1000)

  // Where the two features collide. Arriving for the best light means the drive
  // home starts after sunset, on the mountain road. Better said than not.
  const view = lastViewpoint(trip.stops ?? [])
  const spot = view ? view.coord : out.coordinates[out.coordinates.length - 1]
  const sun = sunTimes(now, spot[1], spot[0])
  const darkDrive =
    sun && new Date(sun.goldenHour.getTime() + back.durationSeconds * 1000) > sun.sunset

  return (
    <div className="flex flex-col gap-1.5 border-t border-white/[0.07] pt-3">
      <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted">
        Make a day of it
      </span>

      <div className="flex items-baseline gap-2 text-[0.7rem]">
        <span className="text-scenic">Out</span>
        <span className="tnum text-foreground">{hhmm(out.durationSeconds)}</span>
        <span className="text-muted">the pretty way</span>
      </div>
      <div className="flex items-baseline gap-2 text-[0.7rem]">
        <span style={{ color: "#4d94d6" }}>Back</span>
        <span className="tnum text-foreground">{hhmm(back.durationSeconds)}</span>
        <span className="text-muted">the quick way</span>
      </div>

      <p className="text-[0.7rem] leading-relaxed text-muted">
        <span className="tnum text-foreground">{hhmm(driving)}</span> driving. Leave at{" "}
        <span className="tnum">{formatClock(leave)}</span>, spend {HOURS_THERE} hours in{" "}
        {trip.to}, home by <span className="tnum">{formatClock(home)}</span>.
      </p>

      {darkDrive && (
        <p className="text-[0.7rem] leading-relaxed text-muted">
          Staying for golden hour means driving back after dark.
        </p>
      )}
    </div>
  )
}
