export type Platform = 'ios' | 'android'
export type DeviceKind = 'simulator' | 'emulator' | 'physical'
export type TravelMode = 'walk' | 'bike' | 'drive' | 'custom'

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
  detail?: string
}

export interface ToolStatus {
  id: 'xcrun' | 'simctl' | 'adb'
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


export interface SearchResult {
  displayName: string
  point: GeoPoint
  type?: string
}

export interface RouteRequest {
  points: GeoPoint[]
  mode: TravelMode
  snapToRoads: boolean
}

export interface RouteResult {
  points: GeoPoint[]
  distanceMeters: number
  source: 'valhalla' | 'manual'
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
}

declare global {
  interface Window {
    simLocation: AppBridge
  }
}
