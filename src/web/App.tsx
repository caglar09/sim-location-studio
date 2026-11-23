import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceInfo, GeoPoint, PlannedRouteLeg, RouteSpeedSegment, SearchResult, TravelMode } from '../shared/types'
import { distanceMeters, formatDistance, formatDuration, routeDistance } from '../renderer/lib/geo'
import MapCanvas from '../renderer/components/MapCanvas'
import PhoneControlPanel from './features/phone-control/PhoneControlPanel'
import { isPhoneRouteActive, usePhoneRoute, type PhoneRouteStep } from './features/phone-route/usePhoneRoute'
import RouteScrubber from './features/phone-route/RouteScrubber'
import simulationSpeeds from '../shared/simulation-speeds.json'
import './mobile-studio.css'

type Place = { name: string; point: GeoPoint }
type Favorite = Place
type RouteStop = Place & { id: string; dwellMinutes: number; modeToNext: Mode }
type Mode = Exclude<TravelMode, 'custom' | 'bike'>
type MobileView = 'home' | 'route' | 'phone'
const MOBILE_TABS = [
  { id: 'home', label: 'Accueil', icon: 'home' },
  { id: 'route', label: 'Trajet', icon: 'route' },
  { id: 'phone', label: 'Phone', icon: 'phone' }
] as const

function initialMobileView(): MobileView {
  try {
    const stored = sessionStorage.getItem('sim-mobile-view')
    return stored === 'route' || stored === 'phone' ? stored : 'home'
  } catch { return 'home' }
}
type RouteTemplate = {
  id: string
  name: string
  origin: Place
  destination: Place
  stops: RouteStop[]
  mode: Mode
  departureAt: string
  destinationStayMinutes: number
}
const LAVAL_START: Place = { name: 'Laval, Québec', point: { lat: 45.6066, lng: -73.7124 } }

function formatGpsPoint(point: GeoPoint) {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}
const FAVORITES_KEY = 'sim-location-favorites'
const TEMPLATES_KEY = 'sim-location-route-templates'
const TEMPLATE_SEED_VERSION_KEY = 'sim-location-template-seed-version'
const TEMPLATE_SEED_VERSION = '4'
const FIRST_TORONTO_TEMPLATE: RouteTemplate = {
  id: 'laval-gare-toronto-20261120',
  name: '4065 Lévesque → Toronto · 20 nov.',
  origin: { name: '4065, Boulevard Lévesque Ouest, Laval', point: { lat: 45.5328735, lng: -73.7444184 } },
  destination: { name: 'Toronto Union Station', point: { lat: 43.6445345, lng: -79.380381 } },
  stops: [{ id: 'gare-centrale-20261120', name: 'Gare Centrale de Montréal', point: { lat: 45.5004189, lng: -73.5674277 }, dwellMinutes: 25, modeToNext: 'train' }],
  mode: 'drive',
  departureAt: '2026-11-20T05:57',
  destinationStayMinutes: 20
}
const TORONTO_RETURN_TEMPLATE: RouteTemplate = {
  id: 'toronto-gare-laval-20261123',
  name: 'Retour Toronto → 4065 Lévesque',
  origin: FIRST_TORONTO_TEMPLATE.destination,
  destination: FIRST_TORONTO_TEMPLATE.origin,
  stops: [{ ...FIRST_TORONTO_TEMPLATE.stops[0], id: 'gare-centrale-20261123', modeToNext: 'drive' }],
  mode: 'train',
  departureAt: '2026-11-23T06:32',
  destinationStayMinutes: FIRST_TORONTO_TEMPLATE.destinationStayMinutes
}
const DEFAULT_ROUTE_TEMPLATES = [FIRST_TORONTO_TEMPLATE, TORONTO_RETURN_TEMPLATE]
const profile: Record<Mode, { speed: number; label: string; color: string }> = {
  walk: { speed: simulationSpeeds.walk, label: 'Marche', color: '#d9ff78' },
  drive: { speed: simulationSpeeds.city, label: 'Voiture', color: '#72c8ff' },
  train: { speed: simulationSpeeds.train, label: 'Train', color: '#c9a3ff' }
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    pin: 'M12 22s8-4.5 8-12a8 8 0 1 0-16 0c0 7.5 8 12 8 12Zm0-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    search: 'm20 20-4.5-4.5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
    swap: 'M7 7h13l-3-3m3 3-3 3M17 17H4l3 3m-3-3 3-3',
    play: 'm8 5 11 7-11 7V5Z',
    pause: 'M8 5h3v14H8zm6 0h3v14h-3z',
    stop: 'M6 6h12v12H6z',
    refresh: 'M20 11a8 8 0 0 0-14-5L4 8m0-5v5h5m-5 5a8 8 0 0 0 14 5l2-2m0 5v-5h-5',
    phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm4 17h2',
    home: 'm3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 21v-7h6v7',
    route: 'M6 7h11a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h11M6 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm16 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
    arrow: 'M7 17 17 7M7 7h10v10',
    chevron: 'm6 9 6 6 6-6',
    plus: 'M12 5v14m-7-7h14',
    close: 'm18 6-12 12M6 6l12 12',
    star: 'm12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
    start: 'M12 21V9m0 0 4 4m-4-4-4 4M5 3h14',
    destination: 'M12 22s7-4.4 7-12a7 7 0 1 0-14 0c0 7.6 7 12 7 12Zm0-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.pin} /></svg>
}

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === 'walk') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="19.5" cy="5.5" r="2.5" /><path d="m17 10-4 5 4 3 2 5m-6-8-4 5m8-5 5 2 3 5m-10-1-2 8m5-5 5 5" /></svg>
  if (mode === 'drive') return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m5 19 2-7a3 3 0 0 1 3-2h12a3 3 0 0 1 3 2l2 7v6h-3v-3H8v3H5v-6Z" /><path d="M8 18h16m-14-8 2 5m10-5-2 5" /><circle cx="10" cy="20" r="1" /><circle cx="22" cy="20" r="1" /></svg>
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 4h10a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5Z" /><path d="M6 18h20M10 9h12v5H10zM11 26l-3 3m13-3 3 3M4 29h24" /><circle cx="11" cy="21" r="1" /><circle cx="21" cy="21" r="1" /></svg>
}

function samePoint(a: GeoPoint, b: GeoPoint) {
  return Math.abs(a.lat - b.lat) < 0.00002 && Math.abs(a.lng - b.lng) < 0.00002
}

function newRouteStopId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function loadFavorites(): Favorite[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY)
    if (stored === null) return [LAVAL_START]
    const value = JSON.parse(stored)
    return Array.isArray(value) ? value.filter((item) => typeof item?.name === 'string' && Number.isFinite(item?.point?.lat) && Number.isFinite(item?.point?.lng)) : []
  } catch { return [] }
}

function loadRouteTemplates(): RouteTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_KEY)
    if (stored === null) return DEFAULT_ROUTE_TEMPLATES
    const value = JSON.parse(stored)
    const saved = Array.isArray(value) ? value.filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string' && item?.origin?.point && item?.destination?.point) : []
    const version = localStorage.getItem(TEMPLATE_SEED_VERSION_KEY)
    if (version === TEMPLATE_SEED_VERSION) return saved
    const newTemplates = version === '3' ? [TORONTO_RETURN_TEMPLATE] : DEFAULT_ROUTE_TEMPLATES
    return [...saved, ...newTemplates.filter((template) => !saved.some((item) => item.id === template.id))]
  } catch { return DEFAULT_ROUTE_TEMPLATES }
}

function sampleRouteBySpeed(points: GeoPoint[], speedSegments: RouteSpeedSegment[], fallbackSpeedKmh: number, sampleIntervalSeconds: number, breaks: number[]) {
  if (points.length < 2) return { samples: [...points], breakSamples: new Map<number, number>(), speeds: [0], elapsedSeconds: [0], durationSeconds: 0 }
  const cumulative = [0]
  for (let index = 1; index < points.length; index++) {
    cumulative.push(cumulative[index - 1] + distanceMeters(points[index - 1], points[index]))
  }
  const totalDistance = cumulative[cumulative.length - 1]
  if (!totalDistance) return { samples: [points[0], points[points.length - 1]], breakSamples: new Map<number, number>(), speeds: [0, 0], elapsedSeconds: [0, 0], durationSeconds: 0 }
  const normalized: RouteSpeedSegment[] = []
  let coverage = 0
  for (const segment of [...speedSegments].sort((a, b) => a.startDistanceMeters - b.startDistanceMeters)) {
    const startDistanceMeters = Math.max(coverage, Math.max(0, segment.startDistanceMeters))
    const endDistanceMeters = Math.min(totalDistance, segment.endDistanceMeters)
    if (!Number.isFinite(startDistanceMeters) || !Number.isFinite(endDistanceMeters) || endDistanceMeters <= startDistanceMeters) continue
    if (startDistanceMeters > coverage) {
      const distanceMeters = startDistanceMeters - coverage
      normalized.push({ startDistanceMeters: coverage, endDistanceMeters: startDistanceMeters, distanceMeters, speedKmh: fallbackSpeedKmh, durationSeconds: distanceMeters / (fallbackSpeedKmh / 3.6), roadType: 'city' })
    }
    const distanceMeters = endDistanceMeters - startDistanceMeters
    const roadType = segment.roadType
    const configuredSpeed = roadType === 'city' || roadType === 'highway' || roadType === 'train' || roadType === 'walk' ? simulationSpeeds[roadType] : undefined
    const speedKmh = Math.max(1, configuredSpeed ?? (segment.speedKmh || fallbackSpeedKmh))
    const durationSeconds = distanceMeters / (speedKmh / 3.6)
    normalized.push({ ...segment, startDistanceMeters, endDistanceMeters, distanceMeters, speedKmh, durationSeconds })
    coverage = endDistanceMeters
  }
  if (!normalized.length) normalized.push({ startDistanceMeters: 0, endDistanceMeters: totalDistance, distanceMeters: totalDistance, speedKmh: fallbackSpeedKmh, durationSeconds: totalDistance / (fallbackSpeedKmh / 3.6), roadType: 'city' })
  else if (coverage < totalDistance) {
    const distanceMeters = totalDistance - coverage
    normalized.push({ startDistanceMeters: coverage, endDistanceMeters: totalDistance, distanceMeters, speedKmh: fallbackSpeedKmh, durationSeconds: distanceMeters / (fallbackSpeedKmh / 3.6), roadType: 'city' })
  }

  const samples: GeoPoint[] = []
  const sampleDistances: number[] = []
  const speeds: number[] = []
  const elapsedSeconds: number[] = []
  let elapsedBeforeSegment = 0
  const pointAtDistance = (target: number) => {
    let low = 1, high = cumulative.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (cumulative[middle] < target) low = middle + 1
      else high = middle
    }
    const segmentIndex = low
    const segmentStart = cumulative[segmentIndex - 1]
    const segmentLength = cumulative[segmentIndex] - segmentStart
    const fraction = segmentLength ? (target - segmentStart) / segmentLength : 0
    return { lat: points[segmentIndex - 1].lat + (points[segmentIndex].lat - points[segmentIndex - 1].lat) * fraction, lng: points[segmentIndex - 1].lng + (points[segmentIndex].lng - points[segmentIndex - 1].lng) * fraction }
  }
  for (const segment of normalized) {
    const steps = Math.max(1, Math.min(20_000, Math.ceil(segment.durationSeconds / sampleIntervalSeconds)))
    for (let step = 0; step <= steps; step++) {
      const fraction = step / steps
      const targetDistance = segment.startDistanceMeters + segment.distanceMeters * fraction
      const targetTime = elapsedBeforeSegment + segment.durationSeconds * fraction
      if (sampleDistances.length && Math.abs(sampleDistances[sampleDistances.length - 1] - targetDistance) < 0.05) {
        speeds[speeds.length - 1] = segment.speedKmh
        elapsedSeconds[elapsedSeconds.length - 1] = targetTime
        continue
      }
      sampleDistances.push(targetDistance)
      samples.push(pointAtDistance(targetDistance))
      speeds.push(segment.speedKmh)
      elapsedSeconds.push(targetTime)
    }
    elapsedBeforeSegment += segment.durationSeconds
  }
  const result = new Map<number, number>()
  for (const index of breaks) {
    if (index <= 0 || index >= cumulative.length) continue
    const distanceAtBreak = cumulative[index]
    let low = 0, high = sampleDistances.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (sampleDistances[middle] < distanceAtBreak) low = middle + 1
      else high = middle
    }
    const next = low
    const previous = Math.max(0, next - 1)
    result.set(index, Math.abs(sampleDistances[previous] - distanceAtBreak) <= Math.abs(sampleDistances[next] - distanceAtBreak) ? previous : next)
  }
  return { samples, breakSamples: result, speeds, elapsedSeconds, durationSeconds: elapsedBeforeSegment }
}

function sampleStops(stops: RouteStop[], breaks: number[], breakSamples: Map<number, number>, legs: PlannedRouteLeg[]) {
  const waits = new Map<number, { seconds: number; name: string }>()
  stops.forEach((stop, index) => {
    const sample = breakSamples.get(breaks[index])
    if (sample === undefined) return
    const arrival = legs[index]?.arrivalAt
    const departure = legs[index + 1]?.departureAt
    const connectionWait = arrival && departure ? (Date.parse(departure) - Date.parse(arrival)) / 1000 : 0
    const seconds = Math.max(stop.dwellMinutes * 60, connectionWait || 0)
    if (seconds) waits.set(sample, { seconds: (waits.get(sample)?.seconds ?? 0) + seconds, name: stop.name })
  })
  return waits
}

function formatTripDuration(milliseconds: number) {
  if (milliseconds < 60_000) return `${Math.ceil(Math.max(0, milliseconds) / 1000)} s`
  return formatDuration(Math.ceil(milliseconds / 60_000) * 60)
}

function formatEta(seconds?: number, fallbackSeconds = 0) {
  return formatDuration(Math.max(0, seconds ?? fallbackSeconds))
}

function defaultDepartureTime() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const tomorrow = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1))
  return `${tomorrow.toISOString().slice(0, 10)}T05:45`
}

function torontoLocalToIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return undefined
  const [, year, month, day, hour, minute] = match.map(Number)
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute)
  let instant = targetWallTime
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const local = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const representedWallTime = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute))
    instant += targetWallTime - representedWallTime
  }
  return new Date(instant).toISOString()
}

function formatPlanTime(value?: string) {
  if (!value) return 'À estimer'
  const exact = new Date(value)
  const date = Number.isFinite(exact.getTime()) ? new Date(Math.round(exact.getTime() / 60_000) * 60_000) : exact
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(date) : 'À estimer'
}

function formatElapsedTime(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`
}

function formatClockTime(value?: string) {
  return value ? new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
}

export default function WebApp({ onTokenChange, token }: { onTokenChange: (value: string) => void; token: string }) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [origin, setOrigin] = useState<Place | null>(LAVAL_START)
  const [destination, setDestination] = useState<Place | null>(null)
  const [originQuery, setOriginQuery] = useState(LAVAL_START.name)
  const [destinationQuery, setDestinationQuery] = useState('')
  const [originResults, setOriginResults] = useState<SearchResult[]>([])
  const [destinationResults, setDestinationResults] = useState<SearchResult[]>([])
  const [stops, setStops] = useState<RouteStop[]>([])
  const [destinationStayMinutes, setDestinationStayMinutes] = useState(0)
  const [templates, setTemplates] = useState<RouteTemplate[]>(loadRouteTemplates)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateNameOpen, setTemplateNameOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [stopSearchOpen, setStopSearchOpen] = useState(false)
  const [stopQuery, setStopQuery] = useState('')
  const [stopResults, setStopResults] = useState<SearchResult[]>([])
  const [mode, setMode] = useState<Mode>('walk')
  const [departureAt, setDepartureAt] = useState(defaultDepartureTime)
  const [routePoints, setRoutePoints] = useState<GeoPoint[]>([])
  const [plannedDuration, setPlannedDuration] = useState<number | null>(null)
  const [plannedBreakIndices, setPlannedBreakIndices] = useState<number[]>([])
  const [plannedLegs, setPlannedLegs] = useState<PlannedRouteLeg[]>([])
  const [plannedSpeedSegments, setPlannedSpeedSegments] = useState<RouteSpeedSegment[]>([])
  const [cursor, setCursor] = useState<GeoPoint>()
  const [focusPoint, setFocusPoint] = useState<GeoPoint | undefined>(LAVAL_START.point)
  const [mapTarget, setMapTarget] = useState<'origin' | 'destination' | 'stop'>('destination')
  const [status, setStatus] = useState('Prêt à créer un trajet')
  const [busy, setBusy] = useState(false)
  const [playback, setPlayback] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [progress, setProgress] = useState(0)
  const [previewElapsedSeconds, setPreviewElapsedSeconds] = useState(0)
  const [previewPlannedAt, setPreviewPlannedAt] = useState<string>()
  const [previewSpeedKmh, setPreviewSpeedKmh] = useState(0)
  const [speedMultiplier, setSpeedMultiplier] = useState(1)
  const [diagnostics, setDiagnostics] = useState<{ tools: Array<{ id: string; label: string; available: boolean; detail?: string }> } | null>(null)
  const [deviceError, setDeviceError] = useState('')
  const [gpsPoint, setGpsPoint] = useState<GeoPoint>()
  const [gpsPicking, setGpsPicking] = useState(false)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsFeedback, setGpsFeedback] = useState<{ text: string; error?: boolean }>()
  const [phonePanelOpen, setPhonePanelOpen] = useState(false)
  const [mobileView, setMobileView] = useState<MobileView>(initialMobileView)
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const [mobileMapPick, setMobileMapPick] = useState(false)
  const [scrubIndex, setScrubIndex] = useState<number>()
  const [runningGeometry, setRunningGeometry] = useState<{ id: string; points: GeoPoint[] }>()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites)
  const [authValue, setAuthValue] = useState(token)
  const playbackToken = useRef(0)

  const device = devices.find((item) => item.id === deviceId)
  const { route: phoneRoute, path: phoneRoutePath, busy: phoneRouteBusy, error: phoneRouteError, issue: issuePhoneRoute, updateManualPoint } = usePhoneRoute(token, device?.id)
  const phoneRouteActive = isPhoneRouteActive(phoneRoute)
  const phoneRouteFinished = phoneRoute?.state === 'finished' && (!routePoints.length || (runningGeometry?.id === phoneRoute.id && runningGeometry?.points === routePoints))
  const phoneRouteMapped = phoneRouteActive || phoneRouteFinished
  const phoneRouteSeekable = !!phoneRoute?.id && (phoneRoute.state === 'running' || phoneRoute.state === 'paused' || phoneRouteFinished)
  const phoneRouteControlsBusy = phoneRouteBusy || gpsBusy || phoneRoute?.state === 'stopping'
  const canChangePhoneRate = phoneRoute?.state === 'running' || phoneRoute?.state === 'paused'
  const phonePlaybackRate = phoneRoute?.rate ?? 1
  const gpsCandidate = gpsPoint ?? origin?.point
  const appliedGps = phoneRoute ? phoneRoute.point : device?.simulatedLocation
  const draftGps = gpsPoint && (!appliedGps || !samePoint(gpsPoint, appliedGps)) ? gpsPoint : undefined
  const speed = profile[mode].speed
  const waypoints = useMemo(() => [
    ...(origin ? [origin.point] : []),
    ...stops.map((stop) => stop.point),
    ...(destination ? [destination.point] : [])
  ], [origin, stops, destination])
  const distance = useMemo(() => routeDistance(routePoints), [routePoints])
  const routeEta = useMemo(() => distance / (speed / 3.6), [distance, speed])
  const dwellSeconds = useMemo(() => stops.reduce((sum, stop) => sum + stop.dwellMinutes * 60, 0), [stops])
  const eta = (plannedDuration ?? routeEta) + dwellSeconds
  const departureInstant = torontoLocalToIso(departureAt)
  const plannedArrival = routePoints.length > 1 && departureInstant
    ? new Date(Date.parse(departureInstant) + eta * 1000)
    : undefined
  const plannedStayEnd = plannedArrival && destinationStayMinutes > 0
    ? new Date(plannedArrival.getTime() + destinationStayMinutes * 60_000)
    : undefined
  const averageSpeed = plannedDuration && distance ? Math.round(distance / plannedDuration * 3.6) : speed
  const trainRouterReady = diagnostics?.tools.find((item) => item.id === 'otp')?.available ?? false
  const currentPhoneGeometry = runningGeometry?.id === phoneRoute?.id ? runningGeometry?.points : phoneRoutePath
  const displayedRoute = phoneRouteMapped && currentPhoneGeometry ? currentPhoneGeometry : routePoints

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    try { sessionStorage.setItem('sim-mobile-view', mobileView) } catch {}
  }, [mobileView])

  const selectMobileView = (view: MobileView) => {
    if (mobileMapPick && view !== 'route') {
      setMobileMapPick(false)
      setGpsPicking(false)
      setStatus('Sélection sur la carte annulée')
    }
    setMobileView(view)
  }

  const pickOnMobileMap = () => {
    if (!mobile) return
    setMobileMapPick(true)
    setMobileView('route')
  }
  const clearRoute = () => {
    playbackToken.current++
    document.body.dataset.playbackPaused = '0'
    setPlayback('idle')
    setProgress(0)
    setPreviewElapsedSeconds(0); setPreviewPlannedAt(undefined); setPreviewSpeedKmh(0)
    setCursor(undefined)
    setRoutePoints([])
    setPlannedDuration(null)
    setPlannedBreakIndices([])
    setPlannedLegs([])
    setPlannedSpeedSegments([])
  }

  const refreshDevices = useCallback(async () => {
    if (!token) return
    setDeviceError('')
    try {
      const [next, nextDiagnostics] = await Promise.all([window.simLocation.getDevices(), window.simLocation.getDiagnostics()])
      setDevices(next)
      setDiagnostics(nextDiagnostics)
      setDeviceId((current) => current && next.some((item) => item.id === current) ? current : next.find((item) => item.supported)?.id || '')
      if (next.length) setStatus(`${next.length} appareil${next.length > 1 ? 's' : ''} détecté${next.length > 1 ? 's' : ''}`)
      else setStatus('Le pont iPhone sera configuré après la connexion du téléphone')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connexion au serveur impossible'
      if (message.toLowerCase().includes('token')) { onTokenChange(''); setAuthValue('') }
      setDeviceError(message)
      setStatus('Connexion au serveur impossible')
    }
  }, [token, onTokenChange])

  useEffect(() => { void refreshDevices() }, [refreshDevices])
  useEffect(() => {
    if (!gpsPicking) return
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setGpsPicking(false)
      if (mobileMapPick) {
        setMobileMapPick(false)
        setMobileView('home')
      }
      setStatus('Sélection GPS annulée')
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [gpsPicking, mobileMapPick])
  useEffect(() => { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)) }, [favorites])
  useEffect(() => {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates))
    localStorage.setItem(TEMPLATE_SEED_VERSION_KEY, TEMPLATE_SEED_VERSION)
  }, [templates])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      const q = originQuery.trim()
      if (origin && q === origin.name) { setOriginResults([]); return }
      if (q.length < 3) { setOriginResults([]); return }
      try { const found = await window.simLocation.searchPlaces(q); if (active) setOriginResults(found) } catch { if (active) setOriginResults([]) }
    }, 380)
    return () => { active = false; window.clearTimeout(timer) }
  }, [origin, originQuery])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      const q = destinationQuery.trim()
      if (destination && q === destination.name) { setDestinationResults([]); return }
      if (q.length < 3) { setDestinationResults([]); return }
      try { const found = await window.simLocation.searchPlaces(q); if (active) setDestinationResults(found) } catch { if (active) setDestinationResults([]) }
    }, 380)
    return () => { active = false; window.clearTimeout(timer) }
  }, [destination, destinationQuery])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      const q = stopQuery.trim()
      if (q.length < 3) { setStopResults([]); return }
      try { const found = await window.simLocation.searchPlaces(q); if (active) setStopResults(found) } catch { if (active) setStopResults([]) }
    }, 380)
    return () => { active = false; window.clearTimeout(timer) }
  }, [stopQuery])

  const choosePlace = (which: 'origin' | 'destination', result: SearchResult) => {
    const place = { name: result.displayName.split(',')[0], point: result.point }
    clearRoute()
    if (which === 'origin') {
      setOrigin(place); setOriginQuery(place.name); setOriginResults([]); setMapTarget('destination')
    } else {
      setDestination(place); setDestinationQuery(place.name); setDestinationResults([])
    }
    setFocusPoint(result.point)
  }

  const updateEndpoints = (nextOrigin: Place | null, nextDestination: Place | null) => {
    clearRoute()
    setOrigin(nextOrigin); setDestination(nextDestination)
  }

  const toggleFavorite = (place: Place) => {
    const saved = favorites.some((favorite) => samePoint(favorite.point, place.point))
    setFavorites((current) => saved ? current.filter((favorite) => !samePoint(favorite.point, place.point)) : [...current, place])
    setStatus(saved ? `${place.name} retiré des favoris` : `${place.name} ajouté aux favoris`)
  }

  const useFavorite = (favorite: Favorite, side: 'origin' | 'destination') => {
    if (side === 'origin') {
      setOriginQuery(favorite.name); setOriginResults([]); setMapTarget('destination')
      updateEndpoints(favorite, destination)
    } else {
      setDestinationQuery(favorite.name); setDestinationResults([]); setMapTarget('destination')
      updateEndpoints(origin, favorite)
    }
    setFocusPoint(favorite.point)
    setStatus(`${favorite.name} défini comme ${side === 'origin' ? 'départ' : 'destination'}`)
  }

  const saveCurrentTemplate = () => {
    if (!origin || !destination) { setStatus('Choisis un départ et une destination avant d’enregistrer un modèle'); return }
    const next: RouteTemplate = {
      id: newRouteStopId(),
      name: templateName.trim() || `${origin.name} → ${destination.name}`,
      origin,
      destination,
      stops: stops.map((stop) => ({ ...stop })),
      mode,
      departureAt,
      destinationStayMinutes
    }
    setTemplates((current) => [next, ...current])
    setSelectedTemplateId(next.id)
    setTemplateName('')
    setTemplateNameOpen(false)
    setStatus(`Modèle enregistré · ${next.name}`)
  }

  const loadTemplate = (template: RouteTemplate) => {
    setOrigin(template.origin); setOriginQuery(template.origin.name)
    setDestination(template.destination); setDestinationQuery(template.destination.name)
    setStops(template.stops.map((stop) => ({ ...stop })))
    setMode(template.mode); setDepartureAt(template.departureAt)
    setSpeedMultiplier(1)
    setDestinationStayMinutes(template.destinationStayMinutes || 0)
    setSelectedTemplateId(template.id)
    clearRoute()
    setFocusPoint(template.origin.point)
    setStatus(`Calcul du modèle · ${template.name}`)
    void buildRoute(template)
  }

  const removeTemplate = (template: RouteTemplate) => {
    setTemplates((current) => current.filter((item) => item.id !== template.id))
    if (selectedTemplateId === template.id) setSelectedTemplateId('')
    setStatus(`Modèle supprimé · ${template.name}`)
  }

  const handleMapClick = (point: GeoPoint) => {
    if (mobile && !mobileMapPick) return
    if (mobile) {
      setMobileMapPick(false)
      setMobileView('home')
    }
    if (gpsPicking) {
      setGpsPoint(point)
      setGpsPicking(false)
      setGpsFeedback({ text: 'Point choisi. Applique-le pour modifier le GPS de l’iPhone.' })
      setStatus('Point GPS choisi')
      return
    }
    const place = { name: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`, point }
    clearRoute()
    if (mapTarget === 'stop') {
      setStops((current) => [...current, { ...place, id: newRouteStopId(), dwellMinutes: 5, modeToNext: mode }])
      setStopSearchOpen(false); setStopQuery(''); setStopResults([]); setMapTarget('destination')
      setStatus(`Pause ajoutée · ${place.name}`)
    } else if (mapTarget === 'origin') { setOrigin(place); setOriginQuery(place.name); setMapTarget('destination') }
    else { setDestination(place); setDestinationQuery(place.name) }
  }

  const updatePhoneGps = async (point?: GeoPoint) => {
    if (!device || phoneRouteActive || phoneRouteControlsBusy) return
    setGpsBusy(true)
    setGpsPicking(false)
    setGpsFeedback({ text: point ? 'Envoi de la position à l’iPhone…' : 'Rétablissement du GPS…' })
    try {
      const result = point
        ? await window.simLocation.setLocation(device.id, device.platform, point)
        : await window.simLocation.clearLocation(device.id, device.platform)
      if (!result.ok) throw new Error(result.message || 'Le service de localisation iOS a refusé la commande.')
      setDevices((current) => current.map((item) => item.id === device.id ? { ...item, simulatedLocation: point } : item))
      updateManualPoint(point)
      setGpsFeedback({ text: point ? `Position appliquée · ${formatGpsPoint(point)}` : 'Simulation GPS arrêtée sur l’iPhone.' })
    } catch (cause) {
      setGpsFeedback({ text: cause instanceof Error ? cause.message : 'Impossible de modifier le GPS de l’iPhone.', error: true })
    } finally {
      setGpsBusy(false)
    }
  }

  const phonePlan = useMemo(() => {
    if (routePoints.length < 2) return undefined
    // The iPhone uses real playback time. The sample interval controls update frequency only.
    const { samples, breakSamples, elapsedSeconds } = sampleRouteBySpeed(routePoints, plannedSpeedSegments, profile[mode].speed, 2, plannedBreakIndices)
    const waits = sampleStops(stops, plannedBreakIndices, breakSamples, plannedLegs)
    const timeAtStepMs = [0]
    const distanceAtStepMeters = [0]
    const steps: PhoneRouteStep[] = samples.map(({ lat, lng }, index) => {
      const travelMs = index === 0 ? 0 : (elapsedSeconds[index] - elapsedSeconds[index - 1]) * 1000
      const delay = index === 0 ? 0 : Math.max(250, Math.round(travelMs + (waits.get(index - 1)?.seconds ?? 0) * 1000))
      if (index > 0) {
        timeAtStepMs.push(timeAtStepMs[index - 1] + delay)
        distanceAtStepMeters.push(distanceAtStepMeters[index - 1] + distanceMeters(samples[index - 1], samples[index]))
      }
      return [Number(lat.toFixed(7)), Number(lng.toFixed(7)), delay]
    })
    const endWaitMs = Math.round((waits.get(steps.length - 1)?.seconds ?? 0) * 1000 + destinationStayMinutes * 60_000)
    return { steps, endWaitMs, timeAtStepMs, distanceAtStepMeters }
  }, [routePoints, plannedSpeedSegments, mode, plannedBreakIndices, plannedLegs, stops, destinationStayMinutes])

  const scrubScope = phoneRouteSeekable ? phoneRoute.id : phonePlan
  useEffect(() => { setScrubIndex(undefined) }, [scrubScope])
  const scrubTotal = phoneRouteSeekable ? phoneRoute.total : phonePlan?.steps.length ?? 0
  const confirmedIndex = phoneRouteSeekable ? Math.max(0, phoneRoute.completed - 1) : 0
  const plannedScrubStep = scrubIndex === undefined ? undefined : phonePlan?.steps[scrubIndex]
  const scrubPoint = scrubIndex === undefined ? undefined : phoneRouteSeekable
    ? phoneRoutePath?.[scrubIndex]
    : plannedScrubStep && { lat: plannedScrubStep[0], lng: plannedScrubStep[1] }
  const plannedStartIndex = Math.min(Math.max(0, scrubIndex ?? 0), Math.max(0, (phonePlan?.steps.length ?? 1) - 1))
  const plannedTotalMs = phonePlan?.timeAtStepMs.at(-1) ?? 0
  const plannedRemainingMs = plannedTotalMs - (phonePlan?.timeAtStepMs[plannedStartIndex] ?? 0)
  const metrics = phoneRouteMapped ? phoneRoute?.metrics : phonePlan && {
    totalMs: plannedTotalMs,
    remainingMs: plannedRemainingMs,
    remainingMeters: (phonePlan.distanceAtStepMeters.at(-1) ?? 0) - (phonePlan.distanceAtStepMeters[plannedStartIndex] ?? 0),
    arrivalAt: new Date(Date.now() + plannedRemainingMs).toISOString()
  }
  const routeStats = metrics && {
    total: formatTripDuration(metrics.totalMs),
    remaining: formatTripDuration(metrics.remainingMs),
    distance: formatDistance(metrics.remainingMeters),
    arrival: metrics.arrivalAt ? formatPlanTime(metrics.arrivalAt) : '—',
    arrivalLabel: phoneRouteMapped && metrics.remainingMeters === 0 ? 'Arrivée'
      : phoneRoute?.state === 'paused' ? 'Arrivée si reprise'
        : phoneRouteMapped ? 'Arrivée prévue' : 'Arrivée si départ'
  }

  const startPhoneRoute = async (index?: number) => {
    if (!phonePlan || !device || phoneRouteActive || phoneRouteControlsBusy) return
    setGpsPicking(false)
    setGpsFeedback(undefined)
    const started = await issuePhoneRoute({ action: 'start', steps: phonePlan.steps, endWaitMs: phonePlan.endWaitMs, index })
    if (started?.id) setRunningGeometry({ id: started.id, points: routePoints })
  }

  const seekPhoneRoute = async (index = scrubIndex, resume = false) => {
    if (index === undefined || !phoneRouteSeekable) return
    const moved = await issuePhoneRoute({ action: 'seek', index })
    if (moved?.state !== 'paused') return
    setScrubIndex(undefined)
    if (resume) await issuePhoneRoute({ action: 'resume' })
  }

  const addStop = (result: SearchResult) => {
    const place = { name: result.displayName.split(',')[0], point: result.point }
    setStops((current) => [...current, { ...place, id: newRouteStopId(), dwellMinutes: 5, modeToNext: mode }])
    clearRoute()
    setStopSearchOpen(false); setStopQuery(''); setStopResults([]); setMapTarget('destination'); setFocusPoint(place.point)
    setStatus(`Pause ajoutée · ${place.name}`)
  }

  const buildRoute = async (template?: RouteTemplate) => {
    const routeOrigin = template?.origin ?? origin
    const routeDestination = template?.destination ?? destination
    const routeStops = template?.stops ?? stops
    const routeMode = template?.mode ?? mode
    const routeDeparture = template?.departureAt ?? departureAt
    if (!routeOrigin || !routeDestination) { setStatus('Choisis un départ et une destination'); return }
    if (mobile) setMobileView('route')
    setBusy(true); setStatus('Calcul des étapes et des correspondances…'); clearRoute()
    const points = [routeOrigin.point, ...routeStops.map((item) => item.point), routeDestination.point]
    try {
      const departure = torontoLocalToIso(routeDeparture)
      const result = await window.simLocation.buildRoute({
        points,
        mode: routeMode,
        legModes: [routeMode, ...routeStops.map((stop) => stop.modeToNext)],
        departureAt: departure,
        stopDurationsMinutes: routeStops.map((stop) => stop.dwellMinutes),
        snapToRoads: true
      })
      setRoutePoints(result.points)
      setPlannedDuration(result.durationSeconds ?? null)
      setPlannedBreakIndices(result.breakIndices ?? [])
      setPlannedLegs(result.legs ?? [])
      setPlannedSpeedSegments(result.speedSegments ?? [])
      setStatus(result.warning ? `Trajet calculé · ${formatDistance(result.distanceMeters)} · ${result.warning}` : `Itinéraire calculé · ${formatDistance(result.distanceMeters)}`)
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Le calcul du trajet a échoué') }
    finally { setBusy(false) }
  }

  const stop = (message = 'Aperçu arrêté') => {
    playbackToken.current++
    document.body.dataset.playbackPaused = '0'
    setPlayback('idle'); setProgress(0)
    setPreviewElapsedSeconds(0); setPreviewPlannedAt(undefined); setPreviewSpeedKmh(0)
    setStatus(message)
  }

  const play = async () => {
    if (routePoints.length < 2) { setStatus('Calcule d’abord un itinéraire'); return }
    const tokenId = ++playbackToken.current
    setPlayback('playing'); setProgress(0)
    const departureMs = departureInstant ? Date.parse(departureInstant) : Date.now()
    let simulatedAt = departureMs
    setPreviewElapsedSeconds(0); setPreviewPlannedAt(new Date(departureMs).toISOString()); setPreviewSpeedKmh(0)
    const fallbackSpeed = profile[mode].speed
    const { samples, breakSamples, speeds, elapsedSeconds, durationSeconds } = sampleRouteBySpeed(routePoints, plannedSpeedSegments, fallbackSpeed, speedMultiplier, plannedBreakIndices)
    let simulatedPauseMs = 0
    let routeElapsedAtSample = 0
    const stopAtSample = sampleStops(stops, plannedBreakIndices, breakSamples, plannedLegs)
    setCursor(samples[0])
    setStatus(`Aperçu local · ${profile[mode].label.toLowerCase()} · le téléphone n’est pas modifié`)
    const waitActiveTime = async (milliseconds: number, onTick?: (elapsedMilliseconds: number) => void) => {
      let remaining = milliseconds
      while (remaining > 0 && playbackToken.current === tokenId) {
        if (document.body.dataset.playbackPaused === '1') {
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }
        const interval = Math.min(100, remaining)
        const started = Date.now()
        await new Promise((resolve) => setTimeout(resolve, interval))
        if (document.body.dataset.playbackPaused !== '1') {
          const elapsed = Math.min(remaining, Date.now() - started)
          remaining -= elapsed
          onTick?.(elapsed)
        }
      }
      return playbackToken.current === tokenId
    }
    try {
      for (let i = 0; i < samples.length; i++) {
        while (playbackToken.current === tokenId && document.body.dataset.playbackPaused === '1') await new Promise((resolve) => setTimeout(resolve, 120))
        if (playbackToken.current !== tokenId) return
        routeElapsedAtSample = elapsedSeconds[i] || 0
        simulatedAt = departureMs + routeElapsedAtSample * 1000 + simulatedPauseMs
        setPreviewSpeedKmh(Math.round(speeds[i] || 0))
        setPreviewPlannedAt(new Date(simulatedAt).toISOString())
        setPreviewElapsedSeconds(Math.max(0, (simulatedAt - departureMs) / 1000))
        setCursor(samples[i]); setProgress(samples.length < 2 ? 1 : i / (samples.length - 1))
        const pauseStop = stopAtSample.get(i)
        if (pauseStop) {
          setStatus(`Pause · ${pauseStop.name} · ${formatTripDuration(pauseStop.seconds * 1000)}`)
          setPreviewSpeedKmh(0)
          if (!await waitActiveTime(pauseStop.seconds * 1000 / speedMultiplier, (elapsed) => {
            simulatedPauseMs += elapsed * speedMultiplier
            simulatedAt = departureMs + routeElapsedAtSample * 1000 + simulatedPauseMs
            setPreviewPlannedAt(new Date(simulatedAt).toISOString())
            setPreviewElapsedSeconds(Math.max(0, (simulatedAt - departureMs) / 1000))
          })) return
        }
        if (i + 1 < samples.length) {
          setPreviewSpeedKmh(Math.round(speeds[i] || 0))
          const travelMs = (elapsedSeconds[i + 1] - routeElapsedAtSample) * 1000 / speedMultiplier
          if (!await waitActiveTime(travelMs)) return
        }
      }
      if (destinationStayMinutes > 0) {
        setStatus(`Séjour sur place · ${destinationStayMinutes} min · ${destination?.name || 'destination'}`)
        setPreviewSpeedKmh(0)
        if (!await waitActiveTime(destinationStayMinutes * 60_000 / speedMultiplier, (elapsed) => {
          simulatedPauseMs += elapsed * speedMultiplier
          simulatedAt = departureMs + durationSeconds * 1000 + simulatedPauseMs
          setPreviewPlannedAt(new Date(simulatedAt).toISOString())
          setPreviewElapsedSeconds(Math.max(0, (simulatedAt - departureMs) / 1000))
        })) return
      }
      setProgress(1); setPreviewSpeedKmh(0); setPlayback('idle'); setStatus('Aperçu terminé · aucune position envoyée au téléphone')
    } catch (error) { stop(error instanceof Error ? error.message : 'Lecture du trajet interrompue') }
  }

  const togglePause = () => {
    const pause = playback === 'playing'
    document.body.dataset.playbackPaused = pause ? '1' : '0'
    setPlayback(pause ? 'paused' : 'playing')
  }

  const swapPlaces = () => {
    const nextOrigin = destination, nextDestination = origin
    setOriginQuery(nextOrigin?.name || ''); setDestinationQuery(nextDestination?.name || '')
    updateEndpoints(nextOrigin, nextDestination)
    setStops((current) => [...current].reverse())
  }

  const originWaypoint = origin ? 0 : -1
  const stopOffset = origin ? 1 : 0
  const destinationWaypoint = destination ? waypoints.length - 1 : -1

  const moveWaypoint = (index: number, point: GeoPoint) => {
    clearRoute(); setFocusPoint(point)
    if (index === originWaypoint) setOrigin((current) => current ? { ...current, point } : current)
    else if (index === destinationWaypoint) setDestination((current) => current ? { ...current, point } : current)
    else setStops((current) => current.map((stop, stopIndex) => stopIndex === index - stopOffset ? { ...stop, point } : stop))
  }

  const removeWaypoint = (index: number) => {
    if (index === originWaypoint) { setOrigin(null); setOriginQuery('') }
    else if (index === destinationWaypoint) { setDestination(null); setDestinationQuery('') }
    else setStops((current) => current.filter((_, stopIndex) => stopIndex !== index - stopOffset))
    clearRoute()
  }

  const scrubDirty = scrubIndex !== undefined && scrubIndex !== confirmedIndex
  const phoneCanStop = phoneRouteActive || (!!appliedGps && !!phoneRoute?.id)
  const mobilePlayLabel = scrubDirty && phoneRouteSeekable ? 'Reprendre ici'
    : phoneRoute?.state === 'running' ? 'Mettre en pause'
      : phoneRoute?.state === 'paused' ? 'Reprendre'
        : phoneRouteFinished ? 'Rejouer le trajet'
          : scrubDirty ? 'Lancer depuis ce point' : 'Lancer sur l’iPhone'
  const mobilePlayPhone = () => {
    if (scrubDirty && phoneRouteSeekable) void seekPhoneRoute(scrubIndex, true)
    else if (phoneRoute?.state === 'running') void issuePhoneRoute({ action: 'pause' })
    else if (phoneRoute?.state === 'paused') void issuePhoneRoute({ action: 'resume' })
    else if (phoneRouteFinished) void seekPhoneRoute(0, true)
    else void startPhoneRoute(scrubIndex)
  }
  const phoneRouteStatusText = phoneRoute?.state === 'stopping' ? 'Rétablissement du GPS…'
    : phoneRoute?.state === 'paused' ? 'En pause sur l’iPhone'
      : phoneRoute?.state === 'running' ? (phoneRoute.completed ? 'En cours sur l’iPhone' : 'Démarrage sur l’iPhone…')
        : phoneRouteFinished ? 'Arrivé à destination'
          : phoneRoute?.state === 'failed' ? 'Trajet interrompu'
            : !device ? 'Branche l’iPhone pour lancer un trajet.'
              : !phonePlan ? 'Choisis un modèle ou prépare un itinéraire.' : 'Prêt à lancer le trajet sur l’iPhone.'

  if (!token) return (
    <div className="access-screen">
      <div className="access-card">
        <div className="brand-mark"><span>↟</span></div>
        <h1>Sim Location Studio</h1>
        <p>Entre le jeton d’accès affiché au démarrage du serveur pour ouvrir le panneau de contrôle.</p>
        <form onSubmit={(event) => { event.preventDefault(); onTokenChange(authValue.trim()) }}>
          <label htmlFor="server-token">Jeton du serveur</label>
          <input id="server-token" autoComplete="current-password" value={authValue} onChange={(event) => setAuthValue(event.target.value)} placeholder="Coller le jeton du terminal" />
          <button className="button-primary" type="submit" disabled={!authValue.trim()}>Ouvrir le studio <Icon name="arrow" /></button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="studio-shell" data-mobile-view={mobileView}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><span>↟</span></div><div><strong>Sim Location Studio</strong><small>Atelier d’itinéraires</small></div></div>
        <button className={`button-outline phone-control-trigger ${phonePanelOpen ? 'is-open' : ''}`} onClick={() => setPhonePanelOpen((open) => !open)} aria-expanded={phonePanelOpen} aria-controls="phone-control-drawer"><Icon name="phone" />{phonePanelOpen ? 'Fermer le téléphone' : 'Contrôler le téléphone'}</button>
        <div className="topbar-status" title={status}><span className={`status-light ${device ? 'connected' : ''}`} />{device ? device.name : 'iPhone non connecté'}</div>
        <div className="topbar-actions">
          <button className="button-icon refresh-action" onClick={() => void refreshDevices()} aria-label="Rechercher les appareils" title="Actualiser les appareils"><Icon name="refresh" /></button>
          <button className="button-outline connect-action" onClick={() => void refreshDevices()}><Icon name="phone" /> {device ? 'Connecté' : 'Rechercher l’iPhone'}</button>
          <button className="avatar-button" onClick={() => { localStorage.removeItem('sim-location-token'); onTokenChange('') }} title="Verrouiller la session">Y</button>
        </div>
      </header>

      <main className="studio-main">
        <aside className="planner-panel">
          <div className="planner-heading"><h1>Planifier un trajet</h1><p>Choisis les points de départ et d’arrivée. On trace le parcours pour toi.</p></div>
          <div className="place-editor">
            <div className="route-rail"><span className="rail-dot start" /><i /><span className="rail-dot end" /></div>
            <div className="place-fields">
              <div className="place-field-wrap">
                <label htmlFor="origin">Départ</label>
                <div className="place-input"><Icon name="search" /><input id="origin" value={originQuery} onFocus={() => setMapTarget('origin')} onChange={(event) => { setOriginQuery(event.target.value); setOrigin(null); clearRoute() }} placeholder="Adresse ou lieu" />{origin && <button className={`button-icon favorite-toggle ${favorites.some((item) => samePoint(item.point, origin.point)) ? 'is-saved' : ''}`} onClick={() => toggleFavorite(origin)} aria-label={favorites.some((item) => samePoint(item.point, origin.point)) ? 'Retirer le départ des favoris' : 'Ajouter le départ aux favoris'} title="Ajouter aux favoris"><Icon name="star" /></button>}<button className="button-icon clear-place" onClick={() => { setOrigin(null); setOriginQuery(''); clearRoute() }} aria-label="Effacer le départ"><Icon name="close" /></button></div>
                {originResults.length > 0 && <div className="suggestion-list">{originResults.map((result) => <button key={`${result.point.lat}:${result.point.lng}`} onClick={() => choosePlace('origin', result)}><Icon name="pin" /><span><b>{result.displayName.split(',')[0]}</b><small>{result.displayName}</small></span></button>)}</div>}
              </div>
              <div className="place-field-wrap destination-wrap">
                <label htmlFor="destination">Destination</label>
                <div className="place-input"><Icon name="search" /><input id="destination" value={destinationQuery} onFocus={() => setMapTarget('destination')} onChange={(event) => { setDestinationQuery(event.target.value); setDestination(null); clearRoute() }} placeholder="Où veux-tu aller ?" />{destination && <button className={`button-icon favorite-toggle ${favorites.some((item) => samePoint(item.point, destination.point)) ? 'is-saved' : ''}`} onClick={() => toggleFavorite(destination)} aria-label={favorites.some((item) => samePoint(item.point, destination.point)) ? 'Retirer la destination des favoris' : 'Ajouter la destination aux favoris'} title="Ajouter aux favoris"><Icon name="star" /></button>}<button className="button-icon clear-place" onClick={() => { setDestination(null); setDestinationQuery(''); clearRoute() }} aria-label="Effacer la destination"><Icon name="close" /></button></div>
                {destinationResults.length > 0 && <div className="suggestion-list">{destinationResults.map((result) => <button key={`${result.point.lat}:${result.point.lng}`} onClick={() => choosePlace('destination', result)}><Icon name="pin" /><span><b>{result.displayName.split(',')[0]}</b><small>{result.displayName}</small></span></button>)}</div>}
              </div>
            </div>
            <button className="button-icon swap-action" onClick={swapPlaces} aria-label="Inverser le départ et la destination"><Icon name="swap" /></button>
          </div>
          <div className="map-pick-hint"><span className="map-pick-key">⌖</span> Ou clique sur la carte pour choisir {mapTarget === 'origin' ? 'le départ' : mapTarget === 'stop' ? 'un lieu de pause' : 'la destination'}.</div>
          <button type="button" className="mobile-map-select" onClick={pickOnMobileMap}><Icon name="pin" /> Choisir {mapTarget === 'origin' ? 'le départ' : mapTarget === 'stop' ? 'un arrêt' : 'la destination'} sur la carte</button>

          <section className="templates-section">
            <div className="section-title"><h2>Modèles de trajet</h2><button className="add-stop-button" onClick={() => { setTemplateName(`${origin?.name || 'Départ'} → ${destination?.name || 'destination'}`); setTemplateNameOpen((open) => !open) }}><Icon name="plus" /> Enregistrer</button></div>
            {templateNameOpen && <form className="template-save-form" onSubmit={(event) => { event.preventDefault(); saveCurrentTemplate() }}><input autoFocus aria-label="Nom du modèle" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Nom du modèle" /><button type="submit">Sauvegarder</button></form>}
            {templates.length ? <div className="template-list">{templates.map((template) => <div className={`template-row ${selectedTemplateId === template.id ? 'selected' : ''}`} key={template.id}>
              <button className="template-load" onClick={() => loadTemplate(template)} title={`Charger le modèle ${template.name}`}><b>{template.name}</b><small>{[template.mode, ...template.stops.map((stop) => stop.modeToNext)].map((item) => profile[item].label).join(' → ')}</small><span>{formatPlanTime(torontoLocalToIso(template.departureAt))} · {template.stops.length} arrêt{template.stops.length === 1 ? '' : 's'} · séjour {template.destinationStayMinutes || 0} min</span></button>
              <button className="template-remove" onClick={() => removeTemplate(template)} aria-label={`Supprimer le modèle ${template.name}`} title="Supprimer le modèle"><Icon name="close" /></button>
            </div>)}</div> : <p className="templates-empty">Aucun modèle enregistré. Enregistre un trajet pour le retrouver ici.</p>}
          </section>

          <section className="favorites-section">
            <div className="section-title"><h2>Favoris</h2><span className="favorite-count">{favorites.length}</span></div>
            {favorites.length ? <div className="favorite-list">{favorites.map((favorite) => <div className="favorite-row" key={`${favorite.point.lat}:${favorite.point.lng}`}>
              <span className="favorite-star"><Icon name="star" /></span>
              <div className="favorite-name"><b>{favorite.name}</b><small>{favorite.point.lat.toFixed(3)}, {favorite.point.lng.toFixed(3)}</small></div>
              <div className="favorite-actions"><button onClick={() => useFavorite(favorite, 'origin')} title={`Définir ${favorite.name} comme départ`} aria-label={`Définir ${favorite.name} comme départ`}><Icon name="start" />Départ</button><button onClick={() => useFavorite(favorite, 'destination')} title={`Définir ${favorite.name} comme destination`} aria-label={`Définir ${favorite.name} comme destination`}><Icon name="destination" />Arrivée</button></div>
              <button className="favorite-remove" onClick={() => setFavorites((current) => current.filter((item) => !samePoint(item.point, favorite.point)))} aria-label={`Retirer ${favorite.name} des favoris`} title="Retirer des favoris"><Icon name="close" /></button>
            </div>)}</div> : <p className="favorites-empty">Appuie sur l’étoile d’un départ ou d’une destination pour l’enregistrer ici.</p>}
          </section>

          <section className="stops-section">
            <div className="section-title"><h2>Étapes du trajet</h2><button className="add-stop-button" onClick={() => setStopSearchOpen((open) => { const next = !open; setMapTarget(next ? 'stop' : 'destination'); return next })}><Icon name="plus" /> Ajouter</button></div>
            {stops.length ? <div className="stop-list">{stops.map((stop, index) => <div className="stop-row" key={stop.id}>
              <span className="stop-index">{index + 1}</span><div className="stop-name"><b>{stop.name}</b><small>Étape {index + 1} · {profile[stop.modeToNext].label} ensuite</small></div>
              <div className="stop-controls"><label className="stop-duration"><span>Pause</span><select value={stop.dwellMinutes} aria-label={`Durée de pause à ${stop.name}`} onChange={(event) => { const value = Number(event.target.value); setStops((current) => current.map((item) => item.id === stop.id ? { ...item, dwellMinutes: value } : item)); setPlannedLegs([]) }}><option value="0">Aucune</option><option value="1">1 min</option><option value="2">2 min</option><option value="5">5 min</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option></select></label><label className="stop-duration"><span>Transport ensuite</span><select value={stop.modeToNext} aria-label={`Transport après ${stop.name}`} onChange={(event) => { const nextMode = event.target.value as Mode; setStops((current) => current.map((item) => item.id === stop.id ? { ...item, modeToNext: nextMode } : item)); clearRoute() }}><option value="walk">Marche</option><option value="drive">Voiture</option><option value="train">Train</option></select></label></div>
              <button className="remove-stop" onClick={() => { setStops((current) => current.filter((item) => item.id !== stop.id)); clearRoute() }} aria-label={`Retirer ${stop.name} du trajet`} title="Retirer l’arrêt"><Icon name="close" /></button>
            </div>)}</div> : <p className="stops-empty">Ajoute un lieu pour faire une pause pendant le trajet.</p>}
            {stopSearchOpen && <div className="stop-search-panel">
              <div className="stop-search-wrap"><div className="place-input"><Icon name="search" /><input autoFocus value={stopQuery} onFocus={() => setMapTarget('stop')} onChange={(event) => setStopQuery(event.target.value)} placeholder="Rechercher un arrêt" aria-label="Rechercher un lieu de pause" /></div>
                {stopResults.length > 0 && <div className="suggestion-list">{stopResults.map((result) => <button key={`${result.point.lat}:${result.point.lng}`} onClick={() => addStop(result)}><Icon name="pin" /><span><b>{result.displayName.split(',')[0]}</b><small>{result.displayName}</small></span></button>)}</div>}
              </div>
              <button className="map-stop-button" onClick={() => { setMapTarget('stop'); setStatus('Clique sur la carte pour placer une pause de 5 minutes'); pickOnMobileMap() }}><Icon name="pin" /> Placer sur la carte</button>
            </div>}
          </section>

          <section className="schedule-section">
            <div className="section-title"><h2>Départ planifié</h2></div>
            <label className="departure-input"><span>Date et heure de départ</span><input type="datetime-local" value={departureAt} onChange={(event) => { setDepartureAt(event.target.value); clearRoute() }} /></label>
            {plannedArrival && <p className="arrival-estimate">Arrivée estimée · <b>{formatPlanTime(plannedArrival.toISOString())}</b></p>}
            <label className="departure-input destination-stay"><span>Temps sur place à l’arrivée</span><select value={destinationStayMinutes} onChange={(event) => setDestinationStayMinutes(Number(event.target.value))}><option value="0">Aucun</option><option value="10">10 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="60">1 heure</option></select></label>
            {plannedStayEnd && <p className="arrival-estimate">Fin du séjour estimée · <b>{formatPlanTime(plannedStayEnd.toISOString())}</b></p>}
          </section>

          {plannedLegs.length > 0 && <section className="planned-legs-section">
            <div className="section-title"><h2>Étapes et correspondances</h2><span className="favorite-count">{plannedLegs.length}</span></div>
            <div className="planned-legs-list">{plannedLegs.map((leg, index) => {
              const places = [origin, ...stops, destination].filter((place): place is Place => Boolean(place))
              return <div className="planned-leg-row" key={`${index}-${leg.mode}`}>
                <span className="planned-leg-icon" style={{ color: profile[leg.mode as Mode]?.color || '#6a7480' }}><ModeIcon mode={(leg.mode as Mode) || 'walk'} /></span>
                <div className="planned-leg-copy"><b>{places[index]?.name || 'Étape'} → {places[index + 1]?.name || 'Arrivée'}</b><small>{formatPlanTime(leg.departureAt)} → {formatPlanTime(leg.arrivalAt)} · {formatEta(leg.durationSeconds)}</small>{leg.waitingSeconds ? <small>Attente prévue · {formatEta(leg.waitingSeconds)}</small> : null}{leg.warning && <small className="leg-warning">{leg.warning}</small>}</div>
              </div>
            })}</div>
          </section>}

          <section className="mode-section">
            <div className="section-title"><h2>Mode de déplacement</h2><button className="text-button" onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? 'Moins' : 'Réglages'} <Icon name="chevron" /></button></div>
            <div className="mode-cards">
              {(['walk', 'drive', 'train'] as Mode[]).map((item) => <button key={item} className={`mode-card ${mode === item ? 'selected' : ''}`} style={{ '--mode-color': profile[item].color } as React.CSSProperties} onClick={() => { setMode(item); clearRoute() }}>
                <span className="mode-icon"><ModeIcon mode={item} /></span><b>{profile[item].label}</b><small>{item === 'train' ? (trainRouterReady ? 'Horaires réels' : 'À configurer') : `≈ ${profile[item].speed} km/h`}</small>
                {mode === item && <span className="mode-check">✓</span>}
              </button>)}
            </div>
            {(mode === 'train' || stops.some((stop) => stop.modeToNext === 'train')) && trainRouterReady && <div className="inline-notice"><b>Horaires VIA Rail</b><span>Le train et sa voie viennent du GTFS officiel. L’aperçu suit le tracé publié.</span></div>}
            {advancedOpen && <div className="advanced-settings"><label htmlFor="speed-multiplier">Vitesse de l’aperçu <b>{speedMultiplier}×</b></label><input id="speed-multiplier" type="range" min="1" max="80" value={speedMultiplier} onChange={(event) => setSpeedMultiplier(Number(event.target.value))} /><div><span>Réaliste</span><span>Accélérée</span></div></div>}
          </section>

          <button className="button-primary calculate-button" onClick={() => void buildRoute()} disabled={busy || !origin || !destination}>{busy ? <span className="spinner" /> : <Icon name="arrow" />}{busy ? 'Calcul en cours…' : 'Calculer l’itinéraire'}</button>
          <p className="preview-note">L’aperçu anime le curseur sur la carte. Il n’envoie aucune position au téléphone.</p>

          <section className="device-route" aria-labelledby="device-route-title">
            <div className="section-title"><h2 id="device-route-title">Trajet sur l’iPhone</h2>
              {canChangePhoneRate ? <select className="device-route-rate" aria-label="Vitesse du trajet sur l’iPhone" value={phonePlaybackRate} disabled={phoneRouteControlsBusy} onChange={(event) => void issuePhoneRoute({ action: 'rate', rate: Number(event.currentTarget.value) })}>
                <option value={1}>1× · Temps réel</option><option value={2}>2×</option><option value={4}>4×</option>
              </select> : <span>Vitesse réelle</span>}
            </div>
            {phoneRouteActive ? <div className="device-route-actions">
              <button type="button" className="button-primary" disabled={phoneRouteControlsBusy} onClick={() => void issuePhoneRoute({ action: phoneRoute?.state === 'paused' ? 'resume' : 'pause' })}>
                <Icon name={phoneRoute?.state === 'paused' ? 'play' : 'pause'} />{phoneRoute?.state === 'paused' ? 'Reprendre' : 'Mettre en pause'}
              </button>
              <button type="button" className="device-gps-picker" disabled={phoneRouteControlsBusy} onClick={() => void issuePhoneRoute({ action: 'stop' })}><Icon name="stop" />Arrêter</button>
            </div> : <div className="device-route-actions">
              <button type="button" className="button-primary" disabled={!device || routePoints.length < 2 || busy || phoneRouteControlsBusy} onClick={() => void startPhoneRoute()}>
                <Icon name="phone" />Lancer sur l’iPhone
              </button>
              {phoneRoute && phoneRoute.state !== 'idle' && appliedGps && <button type="button" className="device-gps-picker" disabled={phoneRouteControlsBusy} onClick={() => void issuePhoneRoute({ action: 'stop' })}><Icon name="stop" />Arrêter</button>}
            </div>}
            {phoneRoute?.total ? <progress max={phoneRoute.total} value={phoneRoute.completed} aria-label="Progression du trajet sur l’iPhone" /> : null}
            <p className="device-route-status" role="status">
              {phoneRouteFinished ? 'Arrivé à destination. Arrête le trajet pour rétablir le GPS.' : phoneRouteStatusText}
            </p>
            {phoneRouteError && <p className="device-gps-feedback is-error" role="alert">{phoneRouteError}</p>}
          </section>

          <section className="device-section">
            <div className="section-title"><h2>Appareil USB</h2><span className={`device-state ${device ? 'connected' : ''}`}>{device ? 'Détecté' : 'Non détecté'}</span></div>
            {device ? <div className="device-empty"><div className="device-glyph"><Icon name="phone" /></div><div><b>{device.model || device.name} · {device.osVersion || 'iOS'}</b><span>Connecté en USB</span></div><button className="button-icon" onClick={() => void refreshDevices()} aria-label="Actualiser l’iPhone détecté"><Icon name="refresh" /></button></div> : <div className="device-empty"><div className="device-glyph"><Icon name="phone" /></div><div><b>{deviceError ? 'Serveur inaccessible' : 'iPhone non détecté'}</b><span>{deviceError || 'Branche ton iPhone en USB pour tester sa position.'}</span></div><button className="button-icon" onClick={() => void refreshDevices()} aria-label="Réessayer"><Icon name="refresh" /></button></div>}
            {device && <div className="device-gps">
              <div className="section-title"><h3>Position GPS sur l’iPhone</h3></div>
              <button type="button" className="device-gps-picker" disabled={phoneRouteControlsBusy || phoneRouteActive} aria-pressed={gpsPicking} onClick={() => {
                setGpsPicking(!gpsPicking)
                if (!gpsPicking) pickOnMobileMap()
                setStatus(gpsPicking ? 'Sélection GPS annulée' : 'Clique sur la carte pour choisir la position de l’iPhone')
              }}><Icon name="pin" />{gpsPicking ? 'Annuler la sélection' : 'Choisir sur la carte'}</button>
              {gpsCandidate && <p className="device-gps-point">{gpsPoint ? 'Point choisi' : 'Point de départ'} · {formatGpsPoint(gpsCandidate)}</p>}
              {appliedGps && <p className="device-gps-point device-gps-applied">Sur l’iPhone · {formatGpsPoint(appliedGps)}</p>}
              <div className="device-gps-actions">
                <button type="button" className="button-primary" disabled={!gpsCandidate || gpsPicking || phoneRouteControlsBusy || phoneRouteActive} onClick={() => { if (gpsCandidate) void updatePhoneGps(gpsCandidate) }}>Appliquer sur l’iPhone</button>
                <button type="button" className="device-gps-picker" disabled={phoneRouteControlsBusy || phoneRouteActive} onClick={() => void updatePhoneGps()}>Rétablir le GPS</button>
              </div>
              {gpsFeedback && <p className={gpsFeedback.error ? 'device-gps-feedback is-error' : 'device-gps-feedback'} role="status">{gpsFeedback.text}</p>}
            </div>}
          </section>

          <div className="planner-footer"><span>Les trajets, modèles et favoris restent dans ton navigateur.</span><button className="text-button" onClick={() => { localStorage.removeItem('sim-location-token'); onTokenChange('') }}>Verrouiller</button></div>
        </aside>

        <section className={`map-workspace${gpsPicking ? ' map-gps-picking' : ''}`} aria-label="Carte interactive">
          <MapCanvas routePoints={displayedRoute} waypointPoints={mobile && phoneRouteMapped && !mobileMapPick ? [] : waypoints} cursor={cursor} mode="route" onMapClick={handleMapClick} onWaypointChange={moveWaypoint} onWaypointRemove={removeWaypoint} onWaypointSelect={() => undefined} activeWaypoint={null} focusPoint={focusPoint} visible={!mobile || mobileView === 'route'}
            pointPicker={gpsPicking ? <span className="gps-map-pin gps-map-pin-hover"><Icon name="pin" /></span> : null}
            pointMarkers={[
              ...(draftGps ? [{ id: 'gps-draft', point: draftGps, content: <span className="gps-map-pin gps-map-pin-draft" key={formatGpsPoint(draftGps)}><Icon name="pin" /><span className="gps-map-label">Point choisi</span></span> }] : []),
              ...(appliedGps ? [{ id: 'gps-iphone', point: appliedGps, content: <span className="gps-map-pin gps-map-pin-iphone"><Icon name="phone" /><span className="gps-map-label">{phoneRoute?.state === 'paused' ? 'iPhone · en pause' : 'GPS simulé · iPhone'}</span></span> }] : []),
              ...(mobile && scrubDirty && scrubPoint ? [{ id: 'route-seek', point: scrubPoint, content: <span className="gps-map-pin"><Icon name="pin" /><span className="gps-map-label">Point de reprise</span></span> }] : [])
            ]}
          />
          <div className="map-top-overlay"><div className="map-caption"><span className="map-caption-glyph">⌖</span>{mobile && phoneRouteMapped && !mobileMapPick ? <span><b>Trajet sur l’iPhone</b></span> : <span><b>{origin?.name || 'Choisis un départ'}</b><i>vers</i><b>{destination?.name || 'une destination'}</b></span>}</div><div className="map-coordinates">{focusPoint ? `${focusPoint.lat.toFixed(4)}°, ${focusPoint.lng.toFixed(4)}°` : 'Carte OpenStreetMap'}</div></div>
          <button className="map-center-button" onClick={() => { const point = appliedGps || origin?.point || destination?.point; if (point) setFocusPoint({ ...point }) }} title="Centrer sur le trajet">◎</button>
          <div className="map-legend"><span><i className="legend-line" /> Trajet {profile[mode].label.toLowerCase()}</span><span><i className="legend-dot" /> Position simulée</span></div>
          <div className="map-attribution">© OpenStreetMap · MapLibre</div>
          <div className="map-status" role="status"><span className={busy ? 'pulse' : ''} />{status}</div>
          <PhoneControlPanel open={mobile ? mobileView === 'phone' : phonePanelOpen} onClose={() => { if (mobile) selectMobileView('route'); else setPhonePanelOpen(false) }} deviceName={device ? `${device.model || device.name} · ${device.osVersion || 'iOS'}` : undefined} />
        </section>

        <section className="mobile-trip-panel" aria-label="Commandes du trajet">
          {mobileMapPick ? <div className="mobile-map-prompt">
            <div><b>{gpsPicking ? 'Position GPS' : 'Choisir un point'}</b><p>Touche la carte pour placer le repère.</p></div>
            <button type="button" className="mobile-trip-edit" onClick={() => selectMobileView('home')}>Annuler</button>
          </div> : <>
            <div className="mobile-trip-heading">
              <div><h2>Trajet sur l’iPhone</h2><p role="status">{busy ? 'Calcul de l’itinéraire…' : phoneRouteStatusText}</p></div>
              <button type="button" className="mobile-trip-edit" onClick={() => selectMobileView('home')}>Planifier <Icon name="arrow" /></button>
            </div>
            {templates.length > 0 && <label className="mobile-template">
              <Icon name="route" />
              <select aria-label="Modèle de trajet" value={selectedTemplateId} disabled={busy || phoneRouteActive || phoneRouteControlsBusy} onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value)
                if (template) loadTemplate(template)
              }}>
                <option value="" disabled>Choisir un modèle</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>}
            {scrubTotal > 1 && <RouteScrubber value={scrubIndex ?? confirmedIndex} total={scrubTotal} dirty={scrubDirty} stats={routeStats} disabled={phoneRouteControlsBusy || busy}
              playbackRate={canChangePhoneRate ? { value: phonePlaybackRate, disabled: phoneRouteControlsBusy, onChange: (rate) => void issuePhoneRoute({ action: 'rate', rate }) } : undefined}
              onChange={setScrubIndex} onCommit={phoneRouteSeekable ? () => void seekPhoneRoute() : undefined} />}
            <div className="mobile-trip-actions">
              <button type="button" className="button-primary" disabled={!device || busy || phoneRouteControlsBusy || (!phoneRouteSeekable && !phonePlan)} onClick={mobilePlayPhone}>
                <Icon name={phoneRoute?.state === 'running' && !scrubDirty ? 'pause' : 'play'} />{mobilePlayLabel}
              </button>
              <button type="button" className="mobile-trip-stop" disabled={!phoneCanStop || phoneRouteControlsBusy} onClick={() => void issuePhoneRoute({ action: 'stop' })}><Icon name="stop" />Arrêter</button>
            </div>
            {phoneRouteError && <p className="device-gps-feedback is-error" role="alert">{phoneRouteError}</p>}
            <div className="mobile-preview-actions">
              <button type="button" disabled={busy || routePoints.length < 2} onClick={playback === 'idle' ? () => void play() : togglePause}>
                <Icon name={playback === 'playing' ? 'pause' : 'play'} />{playback === 'playing' ? 'Mettre l’aperçu en pause' : playback === 'paused' ? 'Reprendre l’aperçu' : 'Aperçu local'}
              </button>
              {playback !== 'idle' && <button type="button" aria-label="Arrêter l’aperçu" onClick={() => stop()}><Icon name="stop" /></button>}
            </div>
          </>}
        </section>
      </main>

      <footer className="trip-dock">
        <div className="trip-summary">
          <div className="trip-mode-symbol" style={{ color: profile[mode].color }}><ModeIcon mode={mode} /></div>
          <div className="trip-numbers"><strong>{formatDistance(distance)}</strong><span>Distance</span></div>
          <div className="trip-divider" />
          <div className="trip-numbers"><strong>{routePoints.length > 1 ? formatEta(eta) : '—'}</strong><span>Durée estimée</span>{plannedArrival && <small className="arrival-note">Arrivée · {formatPlanTime(plannedArrival.toISOString())}</small>}</div>
          <div className="trip-divider" />
          <div className="trip-numbers"><strong>{averageSpeed} <small>km/h</small></strong><span>Vitesse moyenne</span></div>
        </div>
        <div className="trip-playback">
          <div className="playback-control"><button className="playback-button" onClick={playback === 'playing' ? togglePause : playback === 'paused' ? togglePause : () => void play()} disabled={!routePoints.length || busy} aria-label={playback === 'playing' ? 'Mettre en pause l’aperçu' : playback === 'paused' ? 'Reprendre l’aperçu' : 'Démarrer l’aperçu local'}><Icon name={playback === 'playing' ? 'pause' : 'play'} /></button><button className="playback-stop" onClick={() => stop()} disabled={playback === 'idle'} aria-label="Arrêter l’aperçu"><Icon name="stop" /></button></div>
          <div className="playback-timeline">
            {previewPlannedAt ? <div className="preview-metrics" aria-live="polite">
              <span><small>Écoulé</small><b>{formatElapsedTime(previewElapsedSeconds)}</b></span>
              <span><small>Heure prévue</small><b>{formatClockTime(previewPlannedAt)}</b></span>
              <span><small>Vitesse</small><b>{previewSpeedKmh} km/h</b></span>
              <span className="preview-progress-label">{playback === 'paused' ? 'En pause' : playback === 'playing' ? 'En cours' : 'Terminé'} · {Math.round(progress * 100)}%</span>
            </div> : <div className="timeline-labels"><span>Aperçu du trajet</span><span>{Math.round(progress * 100)}%</span></div>}
            <div className="timeline-track"><i style={{ width: `${progress * 100}%` }} /></div>
          </div>
        </div>
        <div className="dock-end"><span className="multiplier-label">{speedMultiplier}× aperçu</span><button className="dock-icon-button" onClick={() => setAdvancedOpen((open) => !open)} aria-label="Réglages de vitesse"><span>⚙</span></button></div>
      </footer>
      <nav className="mobile-nav" aria-label="Navigation principale">
        {MOBILE_TABS.map(({ id, label, icon }) => <button key={id} type="button" aria-current={mobileView === id ? 'page' : undefined} onClick={() => selectMobileView(id)}>
          <span className="mobile-nav-icon"><Icon name={icon} /></span><span>{label}</span>
        </button>)}
      </nav>
    </div>
  )
}
