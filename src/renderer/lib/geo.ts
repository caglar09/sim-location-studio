import type { GeoPoint } from '../../shared/types'

const EARTH = 6371000
const toRad = (v: number) => v * Math.PI / 180

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH * Math.asin(Math.sqrt(h))
}

export function routeDistance(points: GeoPoint[]) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i])
  return total
}

export function interpolateRoute(points: GeoPoint[], spacingMeters: number) {
  if (points.length < 2) return [...points]
  const output: GeoPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dist = distanceMeters(a, b)
    const steps = Math.max(1, Math.ceil(dist / spacingMeters))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      output.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })
    }
  }
  return output
}

export function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 1) return '<1 min'
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return `${hours}h ${rest}m`
}
