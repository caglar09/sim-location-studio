import type { AppBridge, DeviceInfo, DiagnosticsSnapshot, GeoPoint, LocationResult, Platform, RouteRequest, RouteResult, SearchResult } from '../shared/types'

export async function requestWebApi<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok && response.status !== 503) throw new Error(data.error || data.message || `Request failed (${response.status})`)
  return data as T
}

export function createWebBridge(readToken: () => string): AppBridge {
  const request = <T>(path: string, init?: RequestInit) => requestWebApi<T>(readToken(), path, init)

  return {
    getDevices: () => request<DeviceInfo[]>('/devices'),
    getDiagnostics: () => request<DiagnosticsSnapshot>('/diagnostics'),
    setLocation: (deviceId: string, platform: Platform, point: GeoPoint) => request<LocationResult>('/location/set', { method: 'POST', body: JSON.stringify({ deviceId, platform, point }) }),
    clearLocation: (deviceId: string, platform: Platform) => request<LocationResult>('/location/clear', { method: 'POST', body: JSON.stringify({ deviceId, platform }) }),
    searchPlaces: (query: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`),
    buildRoute: (route: RouteRequest) => request<RouteResult>(`/routes`, { method: 'POST', body: JSON.stringify(route) }),
    openLocationSettings: async () => false,
    getAppInfo: async () => ({ version: '0.2.0', platform: 'web' }),
    getLogs: () => request('/logs'),
    clearLogs: () => request('/logs', { method: 'DELETE' }).then(() => undefined)
  }
}
