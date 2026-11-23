export type Platform = 'ios' | 'android'
export type DeviceKind = 'simulator' | 'emulator' | 'physical'
export type LocationProviderId = 'ios-simctl' | 'ios-pymobiledevice3' | 'android-emulator' | 'android-companion'
export type TravelMode = 'walk' | 'bike' | 'drive' | 'train' | 'custom'

export interface GeoPoint {
  lat: number
  lng: number
}

export interface DeviceInfo {
  id: string
  name: string
  platform: Platform
  kind: DeviceKind
  state: 'booted' | 'online' | 'offline' | 'shutdown' | 'unknown'
  osVersion?: string
  model?: string
  supported: boolean
  provider?: LocationProviderId
  connection?: 'usb' | 'network' | 'local'
  detail?: string
  simulatedLocation?: GeoPoint
}

export interface ToolStatus {
  id: 'xcrun' | 'simctl' | 'adb' | 'pymobiledevice3' | 'android-companion'
  label: string
  available: boolean
  version?: string
  detail?: string
}

export interface DiagnosticsSnapshot {
  platform: NodeJS.Platform
  arch: string
  tools: ToolStatus[]
}

export interface LocationResult {
  ok: boolean
  message?: string
}

export type AppLogLevel = 'info' | 'success' | 'warn' | 'error'

export interface AppLogEntry {
  id: number
  timestamp: string
  level: AppLogLevel
  source: string
  message: string
  detail?: string
}


export interface SearchResult {
  displayName: string
  point: GeoPoint
  type?: string
}

export interface RouteRequest {
  points: GeoPoint[]
  mode: TravelMode
  legModes?: TravelMode[]
  departureAt?: string
  stopDurationsMinutes?: number[]
  snapToRoads: boolean
}

export interface PlannedRouteLeg {
  mode: TravelMode
  source: 'valhalla' | 'opentripplanner' | 'via-rail-gtfs' | 'manual'
  distanceMeters: number
  durationSeconds: number
  speedSegments?: RouteSpeedSegment[]
  waitingSeconds?: number
  departureAt?: string
  arrivalAt?: string
  warning?: string
}

export interface RouteSpeedSegment {
  startDistanceMeters: number
  endDistanceMeters: number
  distanceMeters: number
  durationSeconds: number
  speedKmh: number
  roadType: 'city' | 'highway' | 'train' | 'walk' | string
}

export interface RouteResult {
  points: GeoPoint[]
  distanceMeters: number
  source: 'valhalla' | 'opentripplanner' | 'via-rail-gtfs' | 'manual'
  durationSeconds?: number
  breakIndices?: number[]
  legs?: PlannedRouteLeg[]
  speedSegments?: RouteSpeedSegment[]
  warning?: string
}

export interface AppBridge {
  getDevices(): Promise<DeviceInfo[]>
  getDiagnostics(): Promise<DiagnosticsSnapshot>
  setLocation(deviceId: string, platform: Platform, point: GeoPoint): Promise<LocationResult>
  clearLocation(deviceId: string, platform: Platform): Promise<LocationResult>
  searchPlaces(query: string): Promise<SearchResult[]>
  buildRoute(request: RouteRequest): Promise<RouteResult>
  openLocationSettings(): Promise<boolean>
  getAppInfo(): Promise<{ version: string; platform: string }>
  getLogs(): Promise<AppLogEntry[]>
  clearLogs(): Promise<void>
}

declare global {
  interface Window {
    simLocation: AppBridge
  }
}
