import { createServer, request } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { bridgeStatus, clearLocation as clearLocalLocation, listDevices as listLocalDevices, setLocation as setLocalLocation, shutdown as shutdownIosBridge } from './ios-provider.mjs'
import { createPhoneRoutes } from './phone-routes.mjs'
import simulationSpeeds from '../src/shared/simulation-speeds.json' with { type: 'json' }

const root = resolve(fileURLToPath(new URL('../web-dist/', import.meta.url)))
const host = process.env.HOST || '0.0.0.0'
const port = Number(process.env.PORT || 4173)
const token = process.env.SIM_LOCATION_TOKEN || randomBytes(24).toString('base64url')
const agentUrl = process.env.LOCATION_AGENT_URL?.replace(/\/$/, '')
const otpUrl = process.env.OTP_BASE_URL?.replace(/\/$/, '')
const vncRelay = process.env.VITE_VNC_WS_TARGET || 'http://192.168.0.58:25902'
const execFileAsync = promisify(execFile)
const viaFeedPath = '/tmp/sim-location-studio/viarail.zip'
const viaParserPath = fileURLToPath(new URL('./via_gtfs.py', import.meta.url))
const speedByMode = { walk: simulationSpeeds.walk, bike: 16, drive: simulationSpeeds.city, train: simulationSpeeds.train, custom: 12 }
const simulatedLocations = new Map()
const phoneRoutes = createPhoneRoutes({ writeLocation, readLocation: (deviceId) => simulatedLocations.get(deviceId) })

if (!process.env.SIM_LOCATION_TOKEN) {
  console.log(`\nSim Location Studio access token (enter this in the app):\n${token}\n`)
}
console.log(`Web server: http://${host}:${port}`)
console.log(`iPhone agent: ${agentUrl || 'not configured yet'}`)
console.log(`Train routing: ${otpUrl ? `OpenTripPlanner at ${otpUrl}` : 'VIA Rail official GTFS (auto-updated daily)'}`)

async function getViaFeed() {
  await mkdir('/tmp/sim-location-studio', { recursive: true })
  try {
    const info = await stat(viaFeedPath)
    if (Date.now() - info.mtimeMs < 24 * 60 * 60 * 1000) return viaFeedPath
  } catch {}
  const response = await fetch('https://www.viarail.ca/sites/all/files/gtfs/viarail.zip', { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'SimLocationStudio/0.2' } })
  if (!response.ok) throw new Error(`Téléchargement GTFS VIA Rail HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 100_000 || buffer.length > 30_000_000) throw new Error('Le flux GTFS VIA Rail reçu est invalide')
  await writeFile(viaFeedPath, buffer)
  return viaFeedPath
}

async function routeWithViaGtfs(from, to, requestedDepartureAt) {
  const feedPath = await getViaFeed()
  const local = requestedDepartureAt ? transitLocalDateTime(requestedDepartureAt) : null
  const { stdout } = await execFileAsync('python3', [viaParserPath, feedPath, local?.date || '', local?.time || '', `${from.lat},${from.lng}`, `${to.lat},${to.lng}`], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 })
  const schedule = JSON.parse(stdout)
  const departureAt = localDateTimeToIso(schedule.date, schedule.departureTime)
  const arrivalAt = localDateTimeToIso(schedule.date, schedule.arrivalTime)
  const points = [from, ...schedule.points, to]
  const durationSeconds = Math.round((Date.parse(arrivalAt) - Date.parse(departureAt)) / 1000)
  const geometryDistance = routeSummary(points, 'train', 'via-rail-gtfs').distanceMeters
  return {
    ...routeSummary(points, 'train', 'via-rail-gtfs', undefined),
    distanceMeters: schedule.distanceMeters,
    durationSeconds,
    speedSegments: [trainSimulationSegment(geometryDistance)],
    actualDepartureAt: departureAt,
    actualArrivalAt: arrivalAt,
    trainNumber: schedule.trainNumber,
    warning: schedule.warning
  }
}

function localDateTimeToIso(date, time) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wallTime = Date.UTC(year, month - 1, day, hour, minute)
  let instant = wallTime
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const local = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    instant += wallTime - Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute))
  }
  return new Date(instant).toISOString()
}

function reply(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(data))
}

async function bodyJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1024 * 1024) throw new Error('Request body too large')
  }
  return body ? JSON.parse(body) : {}
}

function authorized(req) {
  const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function haversine(a, b) {
  const rad = (n) => n * Math.PI / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(q))
}

function routeSummary(points, mode, source, durationSeconds, warning) {
  let distanceMeters = 0
  for (let i = 1; i < points.length; i++) distanceMeters += haversine(points[i - 1], points[i])
  return { points, distanceMeters, source, durationSeconds, breakIndices: Array.from({ length: Math.max(0, points.length - 1) }, (_, index) => index + 1), warning }
}

function trainSimulationSegment(distanceMeters) {
  return {
    startDistanceMeters: 0,
    endDistanceMeters: distanceMeters,
    distanceMeters,
    durationSeconds: distanceMeters / (simulationSpeeds.train / 3.6),
    speedKmh: simulationSpeeds.train,
    roadType: 'train'
  }
}

function decodePolyline(encoded, precision = 6) {
  let index = 0, lat = 0, lng = 0
  const points = []
  const factor = 10 ** precision
  while (index < encoded.length) {
    let result = 0, shift = 0, byte
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20 && index < encoded.length)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 0; shift = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20 && index < encoded.length)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ lat: lat / factor, lng: lng / factor })
  }
  return points
}

function transitLocalDateTime(instant) {
  if (!instant) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(instant))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}

async function routeWithOtp(points, departureAt) {
  const path = []
  const breakIndices = []
  let durationSeconds = 0
  let actualDepartureAt
  let actualArrivalAt
  for (let index = 1; index < points.length; index++) {
    const from = `${points[index - 1].lat},${points[index - 1].lng}`
    const to = `${points[index].lat},${points[index].lng}`
    const url = new URL(`${otpUrl}/routers/default/plan`)
    url.searchParams.set('fromPlace', from)
    url.searchParams.set('toPlace', to)
    url.searchParams.set('mode', 'TRANSIT,WALK')
    url.searchParams.set('numItineraries', '3')
    const localTime = transitLocalDateTime(departureAt)
    if (localTime) {
      url.searchParams.set('date', localTime.date)
      url.searchParams.set('time', localTime.time)
      url.searchParams.set('arriveBy', 'false')
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`OpenTripPlanner HTTP ${response.status}`)
    const data = await response.json()
    const itinerary = data.plan?.itineraries?.[0]
    if (!itinerary) throw new Error(data.error?.msg || 'No transit itinerary found')
    actualDepartureAt = itinerary.startTime ? new Date(itinerary.startTime).toISOString() : departureAt
    actualArrivalAt = itinerary.endTime ? new Date(itinerary.endTime).toISOString() : undefined
    durationSeconds += Number(itinerary.duration || 0)
    for (const leg of itinerary.legs || []) {
      if (!leg.legGeometry?.points) continue
      const decoded = decodePolyline(leg.legGeometry.points, 5)
      if (path.length && decoded.length) decoded.shift()
      path.push(...decoded)
    }
    if (path.length) breakIndices.push(path.length - 1)
  }
  if (path.length < 2) throw new Error('The transit router returned no route geometry')
  return {
    ...routeSummary(path, 'train', 'opentripplanner', Math.round(durationSeconds)),
    breakIndices,
    speedSegments: [trainSimulationSegment(routeSummary(path, 'train', 'opentripplanner').distanceMeters)],
    actualDepartureAt,
    actualArrivalAt
  }
}

async function routeWithValhalla(points, mode) {
  const costing = mode === 'walk' ? 'pedestrian' : mode === 'bike' ? 'bicycle' : 'auto'
  const response = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'SimLocationStudio/0.2' },
    body: JSON.stringify({ locations: points.map(({ lat, lng }) => ({ lat, lon: lng, type: 'break' })), costing, units: 'kilometers', directions_options: { units: 'kilometers' } }),
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`Valhalla HTTP ${response.status}`)
  const data = await response.json()
  const legs = data.trip?.legs || []
  const path = []
  const breakIndices = []
  const speedSegments = []
  for (const leg of legs) {
    const decoded = decodePolyline(leg.shape)
    const cumulative = [0]
    for (let i = 1; i < decoded.length; i++) cumulative.push(cumulative[i - 1] + haversine(decoded[i - 1], decoded[i]))
    if (mode === 'drive') {
      for (const maneuver of leg.maneuvers || []) {
        const startIndex = Math.max(0, Math.min(decoded.length - 1, Number(maneuver.begin_shape_index) || 0))
        const endIndex = Math.max(startIndex, Math.min(decoded.length - 1, Number(maneuver.end_shape_index) || startIndex))
        const startDistanceMeters = cumulative[startIndex]
        const endDistanceMeters = cumulative[endIndex]
        if (endDistanceMeters <= startDistanceMeters) continue
        const roadType = maneuver.highway ? 'highway' : 'city'
        const speedKmh = simulationSpeeds[roadType]
        const distanceMeters = endDistanceMeters - startDistanceMeters
        speedSegments.push({ startDistanceMeters, endDistanceMeters, distanceMeters, speedKmh, roadType, durationSeconds: distanceMeters / (speedKmh / 3.6) })
      }
      if (!speedSegments.length && cumulative.length > 1) {
        const distanceMeters = cumulative[cumulative.length - 1]
        speedSegments.push({ startDistanceMeters: 0, endDistanceMeters: distanceMeters, distanceMeters, speedKmh: simulationSpeeds.city, roadType: 'city', durationSeconds: distanceMeters / (simulationSpeeds.city / 3.6) })
      }
    } else if (mode === 'walk' && cumulative.length > 1) {
      const distanceMeters = cumulative[cumulative.length - 1]
      speedSegments.push({ startDistanceMeters: 0, endDistanceMeters: distanceMeters, distanceMeters, speedKmh: speedByMode.walk, roadType: 'walk', durationSeconds: distanceMeters / (speedByMode.walk / 3.6) })
    }
    if (path.length && decoded.length) decoded.shift()
    path.push(...decoded)
    if (path.length) breakIndices.push(path.length - 1)
  }
  if (path.length < 2) throw new Error(data.error || 'No route found')
  const duration = mode === 'drive' && speedSegments.length
    ? speedSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0)
    : speedSegments.length
      ? speedSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0)
      : legs.reduce((sum, leg) => sum + Number(leg.summary?.time || 0), 0)
  return { ...routeSummary(path, mode, 'valhalla', Math.round(duration)), breakIndices, speedSegments }
}

async function routeMixed(points, fallbackMode, legModes = [], departureAt, stopDurationsMinutes = []) {
  const path = []
  const breakIndices = []
  const plannedLegs = []
  const speedSegments = []
  const warnings = []
  let cursorTime = departureAt && Number.isFinite(Date.parse(departureAt)) ? Date.parse(departureAt) : null

  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index]
    const to = points[index + 1]
    const mode = legModes[index] || fallbackMode
    const directDistance = haversine(from, to)
    let result

    {
      try {
        result = mode === 'train'
          ? otpUrl
            ? await routeWithOtp([from, to], cursorTime ? new Date(cursorTime).toISOString() : undefined)
            : await routeWithViaGtfs(from, to, cursorTime ? new Date(cursorTime).toISOString() : undefined)
          : await routeWithValhalla([from, to], mode)
      } catch (error) {
        if (mode === 'train') throw error
        const speed = speedByMode[mode] || speedByMode[fallbackMode] || 12
        result = {
          points: [from, to], distanceMeters: directDistance,
          durationSeconds: directDistance / (speed / 3.6), source: 'manual',
          warning: `${mode === 'train' ? 'Train' : 'Itinéraire'} estimé en ligne droite : ${error.message}`
        }
      }
    }

    const segment = result.points || [from, to]
    const geometryDistanceMeters = routeSummary(segment, mode, result.source).distanceMeters
    const legSpeedSegments = result.speedSegments?.length
      ? result.speedSegments
      : [{ startDistanceMeters: 0, endDistanceMeters: geometryDistanceMeters, distanceMeters: geometryDistanceMeters, durationSeconds: Math.max(0, Number(result.durationSeconds) || 0), speedKmh: speedByMode[mode] || speedByMode[fallbackMode] || 12, roadType: mode === 'drive' ? 'city' : mode }]
    const distanceOffsetMeters = path.length ? routeSummary(path, mode, result.source).distanceMeters : 0
    speedSegments.push(...legSpeedSegments.map((item) => ({ ...item, startDistanceMeters: item.startDistanceMeters + distanceOffsetMeters, endDistanceMeters: item.endDistanceMeters + distanceOffsetMeters })))
    if (path.length && segment.length) segment.shift()
    path.push(...segment)
    if (path.length) breakIndices.push(path.length - 1)

    const durationSeconds = Math.max(0, Number(result.durationSeconds) || 0)
    const requestedDepartureTime = cursorTime
    const actualDepartureTime = result.actualDepartureAt ? Date.parse(result.actualDepartureAt) : cursorTime
    const waitingSeconds = Number.isFinite(actualDepartureTime) && Number.isFinite(requestedDepartureTime)
      ? Math.max(0, (actualDepartureTime - requestedDepartureTime) / 1000)
      : 0
    const actualDepartureAt = Number.isFinite(actualDepartureTime) ? new Date(actualDepartureTime).toISOString() : undefined
    const arrivalTime = result.actualArrivalAt
      ? Date.parse(result.actualArrivalAt)
      : Number.isFinite(actualDepartureTime) ? actualDepartureTime + durationSeconds * 1000 : null
    const warning = result.warning
    if (warning) warnings.push(warning)
    plannedLegs.push({
      mode,
      source: result.source,
      distanceMeters: result.distanceMeters || directDistance,
      durationSeconds,
      speedSegments: legSpeedSegments,
      waitingSeconds,
      departureAt: actualDepartureAt,
      arrivalAt: Number.isFinite(arrivalTime) ? new Date(arrivalTime).toISOString() : undefined,
      warning
    })
    const dwellMinutes = Math.max(0, Number(stopDurationsMinutes[index]) || 0)
    cursorTime = Number.isFinite(arrivalTime) ? arrivalTime + dwellMinutes * 60_000 : null
  }

  const distanceMeters = plannedLegs.reduce((total, leg) => total + leg.distanceMeters, 0)
  const durationSeconds = plannedLegs.reduce((total, leg) => total + leg.durationSeconds + (leg.waitingSeconds || 0), 0)
  return {
    points: path,
    distanceMeters,
    durationSeconds: Math.round(durationSeconds),
    source: plannedLegs.some((leg) => leg.source === 'opentripplanner') ? 'opentripplanner' : plannedLegs.some((leg) => leg.source === 'valhalla') ? 'valhalla' : 'manual',
    breakIndices,
    legs: plannedLegs,
    speedSegments,
    warning: warnings.length ? warnings.join(' ') : undefined
  }
}

async function writeLocation(deviceId, platform, point) {
  const applying = point !== undefined
  let status = 200
  let result
  if (agentUrl) {
    const response = await fetch(`${agentUrl}/location/${applying ? 'set' : 'clear'}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, platform, point }), signal: AbortSignal.timeout(10000)
    })
    status = response.status
    result = await response.json()
  } else {
    result = applying ? await setLocalLocation(deviceId, point) : await clearLocalLocation(deviceId)
  }
  if (status >= 200 && status < 300 && result.ok) {
    if (applying) simulatedLocations.set(deviceId, point)
    else simulatedLocations.delete(deviceId)
  }
  return { status, result }
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return reply(res, 200, { ok: true })
  if (!authorized(req)) return reply(res, 401, { error: 'Invalid access token' })

  if (url.pathname === '/api/location/route') {
    if (req.method === 'GET') return reply(res, 200, phoneRoutes.status(url.searchParams.get('deviceId'), url.searchParams.get('includePath') === '1'))
    if (req.method === 'POST') {
      try { return reply(res, 200, await phoneRoutes.command(await bodyJson(req))) }
      catch (error) { return reply(res, error.status || 400, { error: error.message }) }
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    const withLocation = (devices) => devices.map((device) => ({ ...device, simulatedLocation: simulatedLocations.get(device.id) }))
    if (agentUrl) {
      try {
        const r = await fetch(`${agentUrl}/devices`, { signal: AbortSignal.timeout(5000) })
        const data = await r.json()
        return reply(res, r.status, r.ok && Array.isArray(data) ? withLocation(data) : data)
      } catch (error) { return reply(res, 502, { error: `iPhone agent unavailable: ${error.message}` }) }
    }
    try { return reply(res, 200, withLocation(await listLocalDevices())) }
    catch (error) { return reply(res, 502, { error: `iPhone USB discovery failed: ${error.message}` }) }
  }
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    const localBridge = agentUrl ? null : await bridgeStatus()
    return reply(res, 200, { platform: process.platform, arch: process.arch, tools: [
      { id: 'server', label: 'Location server', available: true, version: 'Web API' },
      { id: 'iphone-agent', label: 'iPhone bridge', available: Boolean(agentUrl || localBridge?.available), detail: agentUrl ? 'Configured external iPhone agent' : localBridge?.detail },
      { id: 'otp', label: 'VIA Rail GTFS', available: true, detail: 'Horaires officiels et tracés ferroviaires VIA Rail' }
    ] })
  }
  if (req.method === 'POST' && ['/api/location/set', '/api/location/clear'].includes(url.pathname)) {
    const payload = await bodyJson(req)
    const applying = url.pathname.endsWith('/set')
    if (applying && !payload.point) return reply(res, 400, { ok: false, message: 'Coordonnées GPS requises.' })
    try {
      const { status, result } = await phoneRoutes.manual(payload.deviceId, payload.platform, applying ? payload.point : undefined)
      return reply(res, status, result)
    } catch (error) {
      return reply(res, error.status || 502, { ok: false, message: error.message })
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/search') {
    const query = url.searchParams.get('q')?.trim() || ''
    if (query.length < 2) return reply(res, 200, [])
    const searchUrl = new URL('https://nominatim.openstreetmap.org/search')
    searchUrl.searchParams.set('q', query); searchUrl.searchParams.set('format', 'jsonv2'); searchUrl.searchParams.set('limit', '6')
    const r = await fetch(searchUrl, { headers: { 'user-agent': 'SimLocationStudio/0.2', 'accept-language': 'fr' }, signal: AbortSignal.timeout(12000) })
    if (!r.ok) return reply(res, 502, { error: `Place search HTTP ${r.status}` })
    const places = await r.json()
    return reply(res, 200, places.map((p) => ({ displayName: p.display_name, point: { lat: Number(p.lat), lng: Number(p.lon) }, type: p.type })))
  }
  if (req.method === 'POST' && url.pathname === '/api/routes') {
    const { points, mode = 'walk', legModes, departureAt, stopDurationsMinutes = [], snapToRoads = true } = await bodyJson(req)
    if (!Array.isArray(points) || points.length < 2) return reply(res, 400, { error: 'Add a start and destination.' })
    if (!snapToRoads || mode === 'custom') return reply(res, 200, routeSummary(points, mode, 'manual', undefined))
    try { return reply(res, 200, await routeMixed(points, mode, legModes, departureAt, stopDurationsMinutes)) }
    catch (error) { return reply(res, 502, { ...routeSummary(points, mode, 'manual', undefined, `Route calculation failed: ${error.message}`), error: error.message }) }
  }
  if (req.method === 'GET' && url.pathname === '/api/logs') return reply(res, 200, [])
  if (req.method === 'DELETE' && url.pathname === '/api/logs') return reply(res, 200, { ok: true })

  return reply(res, 404, { error: 'Not found' })
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url)
    if (!existsSync(root)) return reply(res, 503, { error: 'Web client is not built. Run npm run build:web.' })
    let path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) path = resolve(root, 'index.html')
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    createReadStream(path).pipe(res)
  } catch (error) {
    if (!res.headersSent) reply(res, 500, { error: error.message || 'Internal server error' })
    else res.destroy()
  }
})
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin
  const allowedOrigin = origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`
  if (req.url !== '/phone-vnc-ws' || !allowedOrigin || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    return
  }

  const target = new URL('/websockify', vncRelay)
  const headers = { ...req.headers, host: target.host }
  delete headers.cookie
  delete headers.authorization
  const upstreamRequest = request(target, { headers })
  socket.on('close', () => upstreamRequest.destroy())
  socket.on('error', () => socket.destroy())
  upstreamRequest.setTimeout(8000, () => upstreamRequest.destroy())
  upstreamRequest.on('error', () => socket.destroy())
  upstreamRequest.on('response', (response) => {
    response.resume()
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })
  upstreamRequest.on('upgrade', (response, upstream, upstreamHead) => {
    let reply = 'HTTP/1.1 101 Switching Protocols\r\n'
    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      reply += `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`
    }
    upstream.on('error', () => socket.destroy())
    upstream.on('close', () => socket.destroy())
    socket.on('close', () => upstream.destroy())
    socket.write(`${reply}\r\n`)
    if (upstreamHead.length) socket.write(upstreamHead)
    if (head.length) upstream.write(head)
    upstream.pipe(socket).pipe(upstream)
  })
  upstreamRequest.end()
})
server.listen(port, host)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  void phoneRoutes.stopAll().finally(shutdownIosBridge).finally(() => server.close(() => process.exit(0)))
})
