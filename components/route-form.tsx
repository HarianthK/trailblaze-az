"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ElevationProfile } from "@/components/elevation-profile"
import { GoldenHour } from "@/components/golden-hour"
import { ApiError, fetchRoutes, geocode } from "@/lib/api"
import type { DemoTrip, RoutePreference, RouteResult, Stop } from "@/lib/types"

function formatDistance(meters: number) {
  return `${(meters * 0.000621371).toFixed(1)} mi`
}

function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

function formatGap(scenic: RouteResult, fastest: RouteResult) {
  const extraMinutes = Math.round((scenic.durationSeconds - fastest.durationSeconds) / 60)
  const extraMiles = Math.round((scenic.distanceMeters - fastest.distanceMeters) * 0.000621371)
  if (extraMinutes <= 0) return "about the same as the fastest way"
  // Tempe to Gilbert is a minute longer and slightly shorter, where "+0 mi"
  // reads like a bug rather than a rounding.
  if (extraMiles <= 0) return `${formatDuration(extraMinutes * 60)} longer`
  return `${formatDuration(extraMinutes * 60)} longer · +${extraMiles} mi`
}


// Six stops spread across the drive, not the six nearest the start. Sorting by
// distance along the route and taking the first few returns a list of places
// within a mile of your own front door, which is no use to anyone.
function spreadStops(stops: Stop[], want = 6) {
  if (stops.length <= want) return stops
  const end = stops[stops.length - 1].alongM || 1
  const chosen: Stop[] = []

  for (let band = 0; band < want; band++) {
    const from = (end * band) / want
    const to = (end * (band + 1)) / want
    const inBand = stops.filter((s) => s.alongM >= from && s.alongM < to && !chosen.includes(s))
    if (!inBand.length) continue
    // A marked viewpoint beats a filling station on a scenic drive.
    const viewpoint = inBand.find((s) => s.kind === "viewpoint")
    chosen.push(viewpoint ?? inBand.sort((a, b) => a.detourM - b.detourM)[0])
  }
  return chosen
}

type Props = {
  onRouteChange: (
    route: RouteResult | null,
    compare?: RouteResult | null,
    preference?: RoutePreference,
    stops?: Stop[],
  ) => void
}

export function RouteForm({ onRouteChange }: Props) {
  const [trips, setTrips] = useState<DemoTrip[]>([])
  const [activeTrip, setActiveTrip] = useState<DemoTrip | null>(null)
  const [from, setFrom] = useState("Tempe, AZ")
  const [to, setTo] = useState("Gilbert, AZ")
  const [preference, setPreference] = useState<RoutePreference>("fastest")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<RouteResult | null>(null)
  const [usedAlternative, setUsedAlternative] = useState(false)
  const [matched, setMatched] = useState<{ from: string; to: string } | null>(null)

  // 300 KB of coordinates, so it is fetched once rather than bundled.
  useEffect(() => {
    fetch("/demo-routes.json")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTrips)
      .catch(() => setTrips([]))
  }, [])

  // Derived, not stored: on a precomputed trip the answer is already in hand,
  // so keeping a copy in state only creates something that can go stale.
  const result = activeTrip ? activeTrip[preference] : searchResult

  // Switching on a precomputed trip is instant — nothing to fetch, just tell
  // the map which of the two routes is now in front.
  useEffect(() => {
    if (!activeTrip) return
    onRouteChange(
      activeTrip[preference],
      activeTrip[preference === "scenic" ? "fastest" : "scenic"],
      preference,
      // Stops were found along the scenic line, so they only make sense there.
      preference === "scenic" ? (activeTrip.stops ?? []) : [],
    )
  }, [activeTrip, preference, onRouteChange])

  function pickTrip(trip: DemoTrip) {
    setActiveTrip(trip)
    setFrom(`${trip.from}, AZ`)
    setTo(`${trip.to}, AZ`)
    setError(null)
    setMatched(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setActiveTrip(null)

    try {
      const [origin, destination] = await Promise.all([geocode(from), geocode(to)])
      const routes = await fetchRoutes(origin.coords, destination.coords)

      const wantsAlternative = preference === "scenic" && routes.length > 1
      const chosen = wantsAlternative ? routes[1] : routes[0]

      setUsedAlternative(wantsAlternative)
      setMatched({ from: origin.label, to: destination.label })
      setSearchResult(chosen)
      onRouteChange(chosen, null, preference, [])
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong finding that route. Try again."
      setError(message)
      setSearchResult(null)
      setMatched(null)
      onRouteChange(null, null, preference, [])
    } finally {
      setLoading(false)
    }
  }

  const scenicActive = preference === "scenic"

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="panel pointer-events-auto flex max-h-[60vh] w-full max-w-[22rem] flex-col gap-4 overflow-y-auto overscroll-contain rounded-2xl p-4 sm:max-h-[calc(100vh-3rem)] sm:gap-5 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-[0.95rem] font-semibold tracking-tight text-foreground">
          Trailblaze <span className="text-scenic">AZ</span>
        </h1>
        <p className={`text-[0.7rem] leading-relaxed text-muted ${activeTrip ? "hidden" : "hidden sm:block"}`}>
          Arizona routes that optimise for something other than speed.
        </p>
      </div>

      {trips.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted">
            Try a route
          </span>
          <div className="flex flex-wrap gap-1.5">
            {trips.map((trip) => {
              const active = activeTrip?.key === trip.key
              return (
                <button
                  key={trip.key}
                  type="button"
                  onClick={() => pickTrip(trip)}
                  aria-pressed={active}
                  className={`relative rounded-full px-2.5 py-1 text-[0.7rem] transition-colors ${
                    active ? "text-[#0b0f14]" : "text-muted hover:text-foreground"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="trip-pill"
                      className="absolute inset-0 rounded-full bg-scenic"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className="relative">
                    {trip.from} → {trip.to}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(
          [
            ["from", from, setFrom, "Tempe, AZ"],
            ["to", to, setTo, "Gilbert, AZ"],
          ] as const
        ).map(([id, value, set, placeholder]) => (
          <div key={id} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${id === "from" ? "bg-muted" : "bg-scenic"}`}
            />
            <input
              id={id}
              name={id}
              value={value}
              onChange={(e) => set(e.target.value)}
              placeholder={placeholder}
              aria-label={id === "from" ? "From" : "To"}
              required
              className="field w-full rounded-lg px-3 py-2 text-[0.8rem] text-foreground"
            />
          </div>
        ))}
      </div>

      <div className="relative flex rounded-lg bg-white/[0.04] p-1 text-[0.75rem]">
        {(["fastest", "scenic"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPreference(option)}
            aria-pressed={preference === option}
            className={`relative flex-1 rounded-md px-3 py-1.5 capitalize transition-colors ${
              preference === option ? "text-[#0b0f14]" : "text-muted hover:text-foreground"
            }`}
          >
            {preference === option && (
              <motion.span
                layoutId="pref-pill"
                className={`absolute inset-0 rounded-md ${option === "scenic" ? "bg-scenic" : "bg-fastest"}`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative font-medium">{option}</span>
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-white/[0.06] px-3 py-2 text-[0.75rem] font-medium text-foreground transition-colors hover:bg-white/[0.11] disabled:cursor-not-allowed disabled:text-muted"
      >
        {loading ? "Finding route…" : "Find route"}
      </button>

      <AnimatePresence mode="popLayout">
        {error && (
          <motion.p
            key="error"
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg bg-red-500/10 px-3 py-2 text-[0.7rem] text-red-300"
          >
            {error}
          </motion.p>
        )}

        {result && !error && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex flex-col gap-2 border-t border-white/[0.07] pt-4"
          >
            <div className="flex items-baseline justify-between">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={result.durationSeconds}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                  className={`tnum text-2xl font-semibold tracking-tight ${
                    scenicActive ? "text-scenic" : "text-foreground"
                  }`}
                >
                  {formatDuration(result.durationSeconds)}
                </motion.span>
              </AnimatePresence>
              <span className="tnum text-[0.75rem] text-muted">
                {formatDistance(result.distanceMeters)}
              </span>
            </div>

            {activeTrip ? (
              <p className="text-[0.7rem] leading-relaxed text-muted">
                {scenicActive ? (
                  <>
                    <span className="text-scenic">Scenic</span> — {formatGap(activeTrip.scenic, activeTrip.fastest)}.
                    The fast way is dashed.
                  </>
                ) : (
                  <>Fastest way. Switch to scenic for the drive worth taking.</>
                )}
              </p>
            ) : (
              <>
                {matched && (
                  // Searches are restricted to Arizona, so an out-of-state name
                  // can quietly match something odd inside it.
                  <p className="text-[0.7rem] leading-relaxed text-muted">
                    {matched.from} → {matched.to}
                  </p>
                )}
                {scenicActive && (
                  <p className="text-[0.7rem] leading-relaxed text-muted">
                    {usedAlternative
                      ? "Only an alternate route for typed places — pick a route above for real scenic routing."
                      : "No alternate route here — showing the fastest one."}
                  </p>
                )}
              </>
            )}

            {activeTrip?.scenic.profile && activeTrip?.fastest.profile && (
              <div className="mt-1 border-t border-white/[0.07] pt-3">
                <ElevationProfile
                  scenic={activeTrip.scenic.profile}
                  fastest={activeTrip.fastest.profile}
                  isScenic={scenicActive}
                  distanceMeters={result.distanceMeters}
                />
              </div>
            )}

            {scenicActive && activeTrip && (
              <GoldenHour route={activeTrip.scenic} stops={activeTrip.stops ?? []} to={activeTrip.to} />
            )}

            {scenicActive && (activeTrip?.stops?.length ?? 0) > 0 && (
              <div className="mt-1 flex flex-col gap-1.5 border-t border-white/[0.07] pt-3">
                <span className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted">
                  Worth stopping for
                </span>
                <ul className="flex flex-col gap-1">
                  {spreadStops(activeTrip?.stops ?? []).map((stop) => (
                    <li key={`${stop.name}-${stop.alongM}`} className="flex items-baseline gap-2">
                      <span
                        aria-hidden
                        className={`size-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                          stop.kind === "viewpoint"
                            ? "bg-scenic"
                            : stop.kind === "food"
                              ? "bg-[#c8cdd4]"
                              : "bg-muted"
                        }`}
                      />
                      <span className="flex-1 truncate text-[0.7rem] text-foreground">{stop.name}</span>
                      <span className="tnum shrink-0 text-[0.65rem] text-muted">
                        {(stop.alongM * 0.000621371).toFixed(0)} mi
                      </span>
                    </li>
                  ))}
                </ul>
                {(activeTrip?.stops?.length ?? 0) > 6 && (
                  <span className="text-[0.65rem] text-muted">
                    {activeTrip?.stops?.length} marked on the map
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  )
}
