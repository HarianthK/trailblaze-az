"use client"

import { useState } from "react"

type RoutePreference = "fastest" | "scenic"

export function RouteForm() {
  const [preference, setPreference] = useState<RoutePreference>("fastest")
  const [submitted, setSubmitted] = useState(false)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setSubmitted(true)
      }}
      className="pointer-events-auto flex w-full max-w-sm flex-col gap-3 rounded-xl border border-black/10 bg-white/95 p-4 shadow-lg backdrop-blur"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="from" className="text-xs font-medium text-zinc-500">
          From
        </label>
        <input
          id="from"
          name="from"
          placeholder="Tempe, AZ"
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
          placeholder="Gilbert, AZ"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
      </div>

      <div className="flex rounded-md border border-zinc-300 p-1 text-sm">
        {(["fastest", "scenic"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPreference(option)}
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
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
      >
        Find route
      </button>

      {submitted && (
        <p className="text-xs text-zinc-500">
          Routing engine isn&apos;t wired up yet — this is the UI shell. See the README for the plan.
        </p>
      )}
    </form>
  )
}
