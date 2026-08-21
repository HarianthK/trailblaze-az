"use client"

import { useState } from "react"
import type { Profile } from "@/lib/types"

const W = 288
const H = 62
const PAD_TOP = 6
const PAD_BOTTOM = 12

const SCENIC = "#e08a3c"
const FASTEST = "#4d94d6"

type Props = {
  scenic: Profile
  fastest: Profile
  isScenic: boolean
  distanceMeters: number
}

function path(elev: number[], lo: number, hi: number, close: boolean) {
  const span = Math.max(hi - lo, 1)
  const plot = H - PAD_TOP - PAD_BOTTOM
  const points = elev.map((m, i) => {
    const x = (i / (elev.length - 1)) * W
    const y = PAD_TOP + plot - ((m - lo) / span) * plot
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = `M${points.join("L")}`
  return close ? `${line}L${W},${H - PAD_BOTTOM}L0,${H - PAD_BOTTOM}Z` : line
}

export function ElevationProfile({ scenic, fastest, isScenic, distanceMeters }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  const front = isScenic ? scenic : fastest
  const back = isScenic ? fastest : scenic
  const colour = isScenic ? SCENIC : FASTEST

  // One scale for both lines. Two scales would make the shorter climb look the
  // same size as the longer one, which is the whole thing this chart disproves.
  const lo = Math.min(scenic.minM, fastest.minM)
  const hi = Math.max(scenic.maxM, fastest.maxM)

  const at = hover === null ? null : front.elevM[hover]
  const alongMi =
    hover === null ? 0 : (hover / (front.elevM.length - 1)) * distanceMeters * 0.000621371

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted">
          Height along the way
        </span>
        <span className="tnum text-[0.65rem] text-muted">
          {at === null ? `${hi.toLocaleString()} m highest` : `${at.toLocaleString()} m at ${alongMi.toFixed(0)} mi`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Height profile. The scenic route climbs ${scenic.ascentM} metres, the fastest ${fastest.ascentM} metres.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const ratio = (e.clientX - box.left) / box.width
          const i = Math.round(ratio * (front.elevM.length - 1))
          setHover(Math.min(Math.max(i, 0), front.elevM.length - 1))
        }}
      >
        <line
          x1="0"
          y1={H - PAD_BOTTOM}
          x2={W}
          y2={H - PAD_BOTTOM}
          stroke="rgb(255 255 255 / 0.1)"
          strokeWidth="1"
        />

        {/* The route you are not looking at, for comparison. */}
        <path d={path(back.elevM, lo, hi, false)} fill="none" stroke="rgb(255 255 255 / 0.22)" strokeWidth="1.5" strokeDasharray="3 2" />

        <path d={path(front.elevM, lo, hi, true)} fill={colour} fillOpacity="0.14" />
        <path d={path(front.elevM, lo, hi, false)} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />

        {hover !== null && (
          <g>
            <line
              x1={(hover / (front.elevM.length - 1)) * W}
              y1={PAD_TOP}
              x2={(hover / (front.elevM.length - 1)) * W}
              y2={H - PAD_BOTTOM}
              stroke="rgb(255 255 255 / 0.35)"
              strokeWidth="1"
            />
            <circle
              cx={(hover / (front.elevM.length - 1)) * W}
              cy={
                PAD_TOP +
                (H - PAD_TOP - PAD_BOTTOM) -
                ((front.elevM[hover] - lo) / Math.max(hi - lo, 1)) * (H - PAD_TOP - PAD_BOTTOM)
              }
              r="3.5"
              fill={colour}
              stroke="#0c1117"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>

      {/* Two series, so identity is never carried by colour alone. */}
      <div className="flex items-center gap-3">
        {(
          [
            ["Scenic", scenic.ascentM, SCENIC, isScenic],
            ["Fastest", fastest.ascentM, FASTEST, !isScenic],
          ] as const
        ).map(([label, climb, dot, active]) => (
          <span key={label} className="flex items-baseline gap-1.5">
            <span
              aria-hidden
              className="size-1.5 translate-y-[-1px] rounded-full"
              style={{ background: active ? dot : "rgb(255 255 255 / 0.25)" }}
            />
            <span className={`text-[0.65rem] ${active ? "text-foreground" : "text-muted"}`}>
              {label}
            </span>
            <span className="tnum text-[0.65rem] text-muted">
              climbs {climb.toLocaleString()} m
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
