import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import os from 'node:os'
import { diagnostics, listDevices, setLocation, clearLocation } from './providers'
import type { GeoPoint, RouteRequest, RouteResult, SearchResult } from '../shared/types'

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 720,
    minHeight: 560,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function haversine(a: GeoPoint, b: GeoPoint) {
  const r = 6371000
  const toRad = (n: number) => n * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(h))
}

function manualRoute(points: GeoPoint[], warning?: string): RouteResult {
  let distanceMeters = 0
  for (let i = 1; i < points.length; i++) distanceMeters += haversine(points[i - 1], points[i])
  return { points, distanceMeters, source: 'manual', warning }
}

async function buildRoute(request: RouteRequest): Promise<RouteResult> {
  if (request.points.length < 2 || !request.snapToRoads || request.mode !== 'drive') {
    return manualRoute(request.points, request.snapToRoads && request.mode !== 'drive' ? 'Road snapping currently uses the public OSRM driving profile. Walking and cycling stay on your manually drawn path.' : undefined)
  }

  try {
    const coordinates = request.points.map((p) => `${p.lng},${p.lat}`).join(';')
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`
    const response = await fetch(url, { headers: { 'User-Agent': 'SimLocationStudio/0.1 (+https://github.com/caglar09/sim-location-studio)' } })
    if (!response.ok) throw new Error(`OSRM returned HTTP ${response.status}`)
    const payload = await response.json() as { routes?: Array<{ distance: number; geometry: { coordinates: [number, number][] } }> }
    const first = payload.routes?.[0]
    if (!first) throw new Error('No route returned')
    return {
      points: first.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceMeters: first.distance,
      source: 'osrm'
    }
  } catch (error) {
    return manualRoute(request.points, `Road routing unavailable; using the manually drawn route. ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function approximateHostLocation() {
  try {
    const response = await fetch('https://ipwho.is/', {
      headers: { 'User-Agent': 'SimLocationStudio/0.1 (+https://github.com/caglar09/sim-location-studio)' }
    })
    if (!response.ok) throw new Error(`Location service returned HTTP ${response.status}`)
    const data = await response.json() as {
      success?: boolean
      latitude?: number
      longitude?: number
      city?: string
      region?: string
      country?: string
      message?: string
    }
    if (data.success === false || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
      throw new Error(data.message || 'Approximate location unavailable')
    }
    return {
      ok: true,
      point: { lat: Number(data.latitude), lng: Number(data.longitude) },
      accuracy: 'approximate' as const,
      label: [data.city, data.region, data.country].filter(Boolean).join(', ')
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function searchPlaces(query: string): Promise<SearchResult[]> {
  if (query.trim().length < 2) return []
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '6')
  url.searchParams.set('addressdetails', '1')

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SimLocationStudio/0.1 (+https://github.com/caglar09/sim-location-studio)',
      'Accept-Language': 'en,tr;q=0.8'
    }
  })
  if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`)
  const data = await response.json() as Array<{ display_name: string; lat: string; lon: string; type?: string }>
  return data.map((item) => ({ displayName: item.display_name, point: { lat: Number(item.lat), lng: Number(item.lon) }, type: item.type }))
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'geolocation')
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'geolocation')
  })
  ipcMain.handle('devices:list', () => listDevices())
  ipcMain.handle('diagnostics:get', async () => ({ platform: process.platform, arch: os.arch(), tools: await diagnostics() }))
  ipcMain.handle('location:set', (_event, platform, deviceId, point) => setLocation(platform, deviceId, point))
  ipcMain.handle('location:clear', (_event, platform, deviceId) => clearLocation(platform, deviceId))
  ipcMain.handle('places:search', (_event, query) => searchPlaces(query))
  ipcMain.handle('route:build', (_event, request) => buildRoute(request))
  ipcMain.handle('host-location:approximate', () => approximateHostLocation())
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
