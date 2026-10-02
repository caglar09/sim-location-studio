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

function decodePolyline6(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const factor = 1e6

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index <= encoded.length)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index <= encoded.length)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    points.push({ lat: lat / factor, lng: lng / factor })
  }

  return points
}

function valhallaCosting(mode: RouteRequest['mode']): 'pedestrian' | 'bicycle' | 'auto' {
  if (mode === 'walk') return 'pedestrian'
  if (mode === 'bike') return 'bicycle'
  return 'auto'
}

async function buildRoute(request: RouteRequest): Promise<RouteResult> {
  if (request.points.length < 2 || !request.snapToRoads) {
    return manualRoute(request.points, request.snapToRoads ? undefined : 'Path following is disabled; using the manually drawn line.')
  }

  try {
    const response = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SimLocationStudio/0.1 (+https://github.com/caglar09/sim-location-studio)',
        'X-Client-Id': 'sim-location-studio'
      },
      body: JSON.stringify({
        locations: request.points.map((point) => ({
          lat: point.lat,
          lon: point.lng,
          type: 'break'
        })),
        costing: valhallaCosting(request.mode),
        units: 'kilometers',
        directions_options: { units: 'kilometers' }
      })
    })

    if (!response.ok) {
      let detail = ''
      try {
        const errorPayload = await response.json() as { error?: string; error_code?: number }
        detail = errorPayload.error || (errorPayload.error_code ? `error ${errorPayload.error_code}` : '')
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new Error(detail || `routing service returned HTTP ${response.status}`)
    }

    const payload = await response.json() as {
      trip?: {
        legs?: Array<{ shape?: string }>
      }
      error?: string
      error_code?: number
    }

    if (!payload.trip?.legs?.length) {
      throw new Error(payload.error || (payload.error_code ? `Valhalla error ${payload.error_code}` : 'No routable path returned'))
    }

    const points: GeoPoint[] = []
    for (const leg of payload.trip.legs) {
      if (!leg.shape) continue
      const decoded = decodePolyline6(leg.shape)
      if (points.length && decoded.length) decoded.shift()
      points.push(...decoded)
    }

    if (points.length < 2) throw new Error('Route shape was empty')

    const result = manualRoute(points)
    return {
      ...result,
      source: 'valhalla'
    }
  } catch (error) {
    return manualRoute(
      request.points,
      `Routable path unavailable; using the manually drawn line. ${error instanceof Error ? error.message : String(error)}`
    )
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
  ipcMain.handle('system:open-location-settings', async () => {
    if (process.platform !== 'darwin') return false
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices')
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
