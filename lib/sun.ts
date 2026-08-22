// Sun times from the NOAA solar position algorithm. No API, no key: this is
// arithmetic, and doing it in the browser means it is always today's date
// without the pipeline having to rebuild anything.

const RAD = Math.PI / 180

// Sun altitudes that define each moment, in degrees above the horizon.
// Golden hour is the stretch below 6 degrees, when the light goes warm.
const ALTITUDE = {
  sunset: -0.833, // Includes refraction and the sun's own width.
  goldenHourStart: 6,
}

function toJulian(date: Date) {
  return date.valueOf() / 86_400_000 - 0.5 + 2440588
}

function fromJulian(julian: number) {
  return new Date((julian + 0.5 - 2440588) * 86_400_000)
}

function solarMeanAnomaly(days: number) {
  return RAD * (357.5291 + 0.98560028 * days)
}

function eclipticLongitude(anomaly: number) {
  const centre =
    RAD * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly))
  const perihelion = RAD * 102.9372
  return anomaly + centre + perihelion + Math.PI
}

function declination(longitude: number) {
  const obliquity = RAD * 23.4397
  return Math.asin(Math.sin(obliquity) * Math.sin(longitude))
}

/** Julian day of solar noon for this longitude, and the sun's declination. */
function solarNoon(days: number, lon: number) {
  const meanAnomaly = solarMeanAnomaly(days)
  const longitude = eclipticLongitude(meanAnomaly)
  const approx = Math.round(days - 0.0009 + -lon * RAD / (2 * Math.PI))
  const transit =
    2451545 + approx + 0.0009 + -lon * RAD / (2 * Math.PI)
    + 0.0053 * Math.sin(meanAnomaly)
    - 0.0069 * Math.sin(2 * longitude)
  return { transit, dec: declination(longitude) }
}

/** How long before solar noon the sun sits at this altitude, in days. */
function hourAngle(altitudeDeg: number, lat: number, dec: number) {
  const h = altitudeDeg * RAD
  const cosH =
    (Math.sin(h) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec))
  // Beyond the polar circles the sun may never reach this altitude. Arizona is
  // nowhere near that, but an out-of-range acos returns NaN and poisons the
  // times downstream, so it is caught rather than left to spread.
  if (cosH > 1 || cosH < -1) return null
  return Math.acos(cosH) / (2 * Math.PI)
}

export type SunTimes = { goldenHour: Date; sunset: Date } | null

export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const days = toJulian(date) - 2451545
  const { transit, dec } = solarNoon(days, lon)

  const toSunset = hourAngle(ALTITUDE.sunset, lat, dec)
  const toGolden = hourAngle(ALTITUDE.goldenHourStart, lat, dec)
  if (toSunset === null || toGolden === null) return null

  return {
    goldenHour: fromJulian(transit + toGolden),
    sunset: fromJulian(transit + toSunset),
  }
}

export function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}
