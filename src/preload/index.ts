import { contextBridge, ipcRenderer } from 'electron'
import type { AppBridge, GeoPoint, Platform, RouteRequest } from '../shared/types'

const api: AppBridge = {
  getDevices: () => ipcRenderer.invoke('devices:list'),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  setLocation: (deviceId: string, platform: Platform, point: GeoPoint) => ipcRenderer.invoke('location:set', platform, deviceId, point),
  clearLocation: (deviceId: string, platform: Platform) => ipcRenderer.invoke('location:clear', platform, deviceId),
  searchPlaces: (query: string) => ipcRenderer.invoke('places:search', query),
  buildRoute: (request: RouteRequest) => ipcRenderer.invoke('route:build', request),
  getApproximateLocation: () => ipcRenderer.invoke('host-location:approximate'),
  getAppInfo: () => ipcRenderer.invoke('app:info')
}

contextBridge.exposeInMainWorld('simLocation', api)
