"use client"

import { useState } from "react"
import { ApiError, fetchRoutes, geocode } from "@/lib/api"
import type { RoutePreference, RouteResult } from "@/lib/types"

function formatDistance(meters: number) {
  const miles = meters * 0.000621371
  return `${miles.toFixed(1)} mi`
}

function formatDuration(seconds: number) {
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

type Props = {
  onRouteChange: (route: RouteResult | null) => void
}

export function RouteForm({ onRouteChange }: Props) {
  const [from, setFrom] = useState("Tempe, AZ")
  const [to, setTo] = useState("Gilbert, AZ")
  const [preference, setPreference] = useState<RoutePreference>("fastest")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RouteResult | null>(null)
  const [usedAlternative, setUsedAlternative] = useState(false)
  const [matched, setMatched] = useState<{ from: string; to: string } | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const [origin, destination] = await Promise.all([geocode(from), geocode(to)])
      const routes = await fetchRoutes(origin.coords, destination.coords)

      // Placeholder for real scenic costing (README, Phase 2): OSRM only ranks
      // by speed, so the best "scenic" stand-in available right now is its
      // second alternative — which is usually only marginally different.
      const wantsAlternative = preference === "scenic" && routes.length > 1
      const chosen = wantsAlternative ? routes[1] : routes[0]

      setUsedAlternative(wantsAlternative)
      setMatched({ from: origin.label, to: destination.label })
      setResult(chosen)
      onRouteChange(chosen)
    } catch (caught) {
      const message =
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong finding that route. Try again."
      setError(message)
      setResult(null)
      setMatched(null)
      onRouteChange(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pointer-events-auto flex w-full max-w-sm flex-col gap-3 rounded-xl border border-black/10 bg-white/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="text-xs font-medium text-zinc-500">
          From
        </label>
        <input
          id="from"
          name="from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="Tempe, AZ"
          required
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="to" className="text-xs font-medium text-zinc-500">
          To
        </label>
        <input
          id="to"
          name="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Gilbert, AZ"
          required
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
      </div>

      <div className="flex rounded-md border border-zinc-300 p-1 text-sm">
        {(["fastest", "scenic"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPreference(option)}
            aria-pressed={preference === option}
            className={`flex-1 rounded px-3 py-1.5 capitalize transition-colors ${
              preference === option ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {loading ? "Finding route…" : "Find route"}
      </button>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {result && !error && (
        <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold text-zinc-900">
              {formatDuration(result.durationSeconds)}
            </span>
            <span className="text-sm text-zinc-500">{formatDistance(result.distanceMeters)}</span>
          </div>
          {matched && (
            // Searches are restricted to Arizona, so an out-of-state name can
            // quietly match something unexpected inside the state. Showing what
            // actually matched makes that visible instead of silently wrong.
            <p className="text-xs leading-relaxed text-zinc-500">
              {matched.from} → {matched.to}
            </p>
          )}
          {preference === "scenic" && (
            <p className="text-xs text-zinc-500">
              {usedAlternative
                ? "Showing an alternate route. True scenic routing lands in Phase 2."
                : "No alternate route here — showing the fastest one."}
            </p>
          )}
        </div>
      )}
    </form>
  )
}
