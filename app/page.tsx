import { MapView } from "@/components/map-view"
import { RouteForm } from "@/components/route-form"

export default function Home() {
  return (
    <div className="relative flex-1">
      <MapView />
      <div className="pointer-events-none absolute inset-0 flex items-start justify-start p-4 sm:p-6">
        <RouteForm />
      </div>
    </div>
  )
}
