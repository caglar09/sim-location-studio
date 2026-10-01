import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceInfo, DiagnosticsSnapshot, GeoPoint, SearchResult, TravelMode } from '../shared/types'
import MapCanvas from './components/MapCanvas'
import { formatDistance, formatDuration, interpolateRoute, routeDistance } from './lib/geo'

type InteractionMode = 'teleport' | 'route'
type PlaybackState = 'idle' | 'playing' | 'paused'

const SPEEDS: Record<Exclude<TravelMode, 'custom'>, number> = {
  walk: 5,
  bike: 18,
  drive: 50
}

const storage = {
  get<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) || '') as T } catch { return fallback }
  },
  set(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)) }
}

export default function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null)
  const [interaction, setInteraction] = useState<InteractionMode>('teleport')
  const [travelMode, setTravelMode] = useState<TravelMode>('walk')
  const [customSpeed, setCustomSpeed] = useState(12)
  const [routePoints, setRoutePoints] = useState<GeoPoint[]>(() => storage.get('route', []))
  const [plannedPoints, setPlannedPoints] = useState<GeoPoint[]>([])
  const [activeWaypoint, setActiveWaypoint] = useState<number | null>(null)
  const [cursor, setCursor] = useState<GeoPoint | undefined>()
  const [userLocation, setUserLocation] = useState<GeoPoint | undefined>()
  const [focusPoint, setFocusPoint] = useState<GeoPoint | undefined>()
  const [status, setStatus] = useState('Ready')
  const [playback, setPlayback] = useState<PlaybackState>('idle')
  const [progress, setProgress] = useState(0)
  const [loop, setLoop] = useState(false)
  const [snapToRoads, setSnapToRoads] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [favorites, setFavorites] = useState<Array<{ name: string; point: GeoPoint }>>(() => storage.get('favorites', []))
  const [controlsOpen, setControlsOpen] = useState(false)
  const playbackToken = useRef(0)

  const selectedDevice = devices.find((d) => d.id === selectedId)
  const speedKmh = travelMode === 'custom' ? customSpeed : SPEEDS[travelMode]
  const activeRoute = plannedPoints.length > 1 ? plannedPoints : routePoints
  const distance = useMemo(() => routeDistance(activeRoute), [activeRoute])
  const duration = speedKmh > 0 ? distance / (speedKmh / 3.6) : 0

  const refresh = useCallback(async () => {
    const [nextDevices, nextDiagnostics] = await Promise.all([window.simLocation.getDevices(), window.simLocation.getDiagnostics()])
    setDevices(nextDevices)
    setDiagnostics(nextDiagnostics)
    setSelectedId((current) => current && nextDevices.some((d) => d.id === current) ? current : nextDevices.find((d) => d.supported && (d.state === 'booted' || d.state === 'online'))?.id || nextDevices.find((d) => d.supported)?.id || '')
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { storage.set('route', routePoints) }, [routePoints])
  useEffect(() => { storage.set('favorites', favorites) }, [favorites])

  const locateUser = useCallback((announce = true) => {
    if (!navigator.geolocation) {
      setStatus('Geolocation is not available on this system.')
      return
    }
    if (announce) setStatus('Requesting your Mac location…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        setUserLocation(point)
        setFocusPoint(point)
        setStatus(`Focused on your location · accuracy ±${Math.round(position.coords.accuracy)} m`)
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Enable it in System Settings → Privacy & Security → Location Services.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Your Mac location is currently unavailable.'
            : 'Location request timed out.'
        setStatus(message)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  useEffect(() => {
    if (storage.get('host-location-asked', false)) return
    storage.set('host-location-asked', true)
    const timer = window.setTimeout(() => locateUser(false), 700)
    return () => window.clearTimeout(timer)
  }, [locateUser])

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.trim().length < 2) return setSearchResults([])
      try { setSearchResults(await window.simLocation.searchPlaces(search.trim())) }
      catch { setSearchResults([]) }
    }, 450)
    return () => clearTimeout(timer)
  }, [search])

  const inject = useCallback(async (point: GeoPoint) => {
    if (!selectedDevice) { setStatus('Select a supported simulator/emulator first.'); return false }
    if (!selectedDevice.supported) { setStatus(selectedDevice.detail || 'This device is not supported for direct injection.'); return false }
    const result = await window.simLocation.setLocation(selectedDevice.id, selectedDevice.platform, point)
    if (!result.ok) { setStatus(result.message || 'Location injection failed.'); return false }
    setCursor(point)
    setStatus(`${selectedDevice.name} → ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`)
    return true
  }, [selectedDevice])

  async function handleMapClick(point: GeoPoint) {
    if (interaction === 'teleport') {
      setFocusPoint(point)
      await inject(point)
    } else {
      setPlannedPoints([])
      setProgress(0)
      setRoutePoints((points) => {
        setActiveWaypoint(points.length)
        return [...points, point]
      })
    }
  }

  async function prepareRoute() {
    if (routePoints.length < 2) { setStatus('Add at least two route points.'); return }
    setStatus('Building route…')
    const result = await window.simLocation.buildRoute({ points: routePoints, mode: travelMode, snapToRoads })
    setProgress(0)
    setPlannedPoints(result.points)
    setStatus(result.warning || `${result.source === 'osrm' ? 'Road route' : 'Manual route'} ready · ${formatDistance(result.distanceMeters)}`)
  }

  async function play() {
    if (!selectedDevice || activeRoute.length < 2) { setStatus('Select a device and create a route first.'); return }
    const token = ++playbackToken.current
    setPlayback('playing')
    const spacing = Math.max(1.5, (speedKmh / 3.6) * 0.75)
    const samples = interpolateRoute(activeRoute, spacing)
    let startIndex = 0
    setProgress(0)

    do {
      for (let i = startIndex; i < samples.length; i++) {
        while (playbackToken.current === token && document.body.dataset.playbackPaused === '1') await new Promise((r) => setTimeout(r, 120))
        if (playbackToken.current !== token) return
        const ok = await inject(samples[i])
        if (!ok) { stop(); return }
        setProgress(samples.length <= 1 ? 1 : i / (samples.length - 1))
        await new Promise((r) => setTimeout(r, 750))
      }
      startIndex = 0
      setProgress(0)
    } while (loop && playbackToken.current === token)

    setPlayback('idle')
    setProgress(1)
    document.body.dataset.playbackPaused = '0'
  }

  function togglePause() {
    if (playback !== 'playing' && playback !== 'paused') return
    const pause = playback === 'playing'
    document.body.dataset.playbackPaused = pause ? '1' : '0'
    setPlayback(pause ? 'paused' : 'playing')
  }

  function stop() {
    playbackToken.current += 1
    document.body.dataset.playbackPaused = '0'
    setPlayback('idle')
    setProgress(0)
  }

  async function resetLocation() {
    if (!selectedDevice) return
    stop()
    const result = await window.simLocation.clearLocation(selectedDevice.id, selectedDevice.platform)
    setCursor(undefined)
    setStatus(result.message || (result.ok ? 'Simulated location cleared.' : 'Failed to clear location.'))
  }

  function clearRoute() {
    stop(); setRoutePoints([]); setPlannedPoints([]); setActiveWaypoint(null); setProgress(0); setStatus('Route cleared.')
  }

  function updateWaypoint(index: number, point: GeoPoint) {
    setPlannedPoints([])
    setProgress(0)
    setRoutePoints((points) => points.map((item, i) => i === index ? point : item))
    setActiveWaypoint(index)
    setStatus(`Waypoint ${index + 1} moved.`)
  }

  function removeWaypoint(index: number) {
    setPlannedPoints([])
    setProgress(0)
    setRoutePoints((points) => points.filter((_, i) => i !== index))
    setActiveWaypoint((current) => current === null ? null : current === index ? null : current > index ? current - 1 : current)
    setStatus(`Waypoint ${index + 1} removed.`)
  }

  function reverseRoute() {
    stop()
    setRoutePoints((points) => {
      const next = [...points].reverse()
      setActiveWaypoint((current) => current === null ? null : next.length - 1 - current)
      return next
    })
    setPlannedPoints((points) => points.length > 1 ? [...points].reverse() : [])
    setProgress(0)
    setStatus('Route reversed · playback will start from the new first point.')
  }

  function undoPoint() {
    setPlannedPoints([])
    setProgress(0)
    setRoutePoints((points) => {
      const next = points.slice(0, -1)
      setActiveWaypoint(next.length ? next.length - 1 : null)
      return next
    })
  }

  function exportRoute() {
    const payload = JSON.stringify({ version: 1, name: 'Sim Location Studio route', mode: travelMode, points: activeRoute }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'sim-location-route.json'; a.click(); URL.revokeObjectURL(url)
  }

  function exportGpx() {
    if (!activeRoute.length) return
    const pts = activeRoute.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}"></trkpt>`).join('\n')
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Sim Location Studio" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>Sim Location Studio Route</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>`
    const blob = new Blob([gpx], { type: 'application/gpx+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'sim-location-route.gpx'; a.click(); URL.revokeObjectURL(url)
  }

  function importGpx(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const xml = new DOMParser().parseFromString(String(reader.result), 'application/xml')
        if (xml.querySelector('parsererror')) throw new Error('Invalid GPX XML')
        const points = [...xml.querySelectorAll('trkpt, rtept, wpt')].map((node) => ({ lat: Number(node.getAttribute('lat')), lng: Number(node.getAttribute('lon')) })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        if (!points.length) throw new Error('No GPX points found')
        setRoutePoints(points); setPlannedPoints([]); setActiveWaypoint(0); setFocusPoint(points[0]); setStatus(`Imported ${points.length} GPX points.`)
      } catch (error) { setStatus(`GPX import failed: ${error instanceof Error ? error.message : String(error)}`) }
    }
    reader.readAsText(file)
  }

  function importRoute(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { points?: GeoPoint[]; mode?: TravelMode }
        if (!Array.isArray(parsed.points) || parsed.points.length < 1) throw new Error('No route points found')
        setRoutePoints(parsed.points); setPlannedPoints([]); setActiveWaypoint(0)
        if (parsed.mode) setTravelMode(parsed.mode)
        setFocusPoint(parsed.points[0]); setStatus(`Imported ${parsed.points.length} route points.`)
      } catch (error) { setStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`) }
    }
    reader.readAsText(file)
  }

  function saveFavorite() {
    if (!cursor) return
    const name = window.prompt('Favorite name', `Location ${favorites.length + 1}`)?.trim()
    if (!name) return
    setFavorites((items) => [...items, { name, point: cursor }])
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">S</div><div><strong>Sim Location Studio</strong><span>Location simulation for app developers</span></div></div>
        <div className="top-actions">
          <button className="controls-toggle" onClick={() => setControlsOpen((open) => !open)} aria-expanded={controlsOpen}>☰ Controls</button>
          <button className="refresh-button" onClick={refresh}>Refresh devices</button>
          <span className="status-pill">{status}</span>
        </div>
      </header>

      <button className={`sidebar-backdrop${controlsOpen ? ' visible' : ''}`} aria-label="Close controls" onClick={() => setControlsOpen(false)} />
      <aside className={`sidebar${controlsOpen ? ' open' : ''}`}>
        <div className="sidebar-mobile-head">
          <strong>Controls</strong>
          <button className="icon-button" onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button>
        </div>
        <section>
          <h3>Target device</h3>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">Select a device…</option>
            {devices.map((device) => <option key={device.id} value={device.id}>{device.platform === 'ios' ? '' : '◉'} {device.name} · {device.state}{device.supported ? '' : ' · unsupported'}</option>)}
          </select>
          {selectedDevice && <div className="device-card"><strong>{selectedDevice.name}</strong><span>{selectedDevice.platform.toUpperCase()} · {selectedDevice.kind} · {selectedDevice.osVersion || selectedDevice.model || selectedDevice.state}</span>{selectedDevice.detail && <small>{selectedDevice.detail}</small>}</div>}
        </section>

        <section>
          <h3>Map mode</h3>
          <div className="segmented">
            <button className={interaction === 'teleport' ? 'active' : ''} onClick={() => setInteraction('teleport')}>Teleport</button>
            <button className={interaction === 'route' ? 'active' : ''} onClick={() => setInteraction('route')}>Draw route</button>
          </div>
          <p className="hint">{interaction === 'teleport' ? 'Click anywhere to instantly inject that coordinate.' : 'Click multiple points in sequence to create a movement path.'}</p>
        </section>

        <section>
          <h3>Movement</h3>
          <div className="movement-grid">
            {(['walk', 'bike', 'drive', 'custom'] as TravelMode[]).map((mode) => <button key={mode} className={travelMode === mode ? 'active' : ''} onClick={() => { setTravelMode(mode); setPlannedPoints([]) }}>{mode === 'walk' ? '🚶 Walk' : mode === 'bike' ? '🚲 Bike' : mode === 'drive' ? '🚗 Drive' : '⚙ Custom'}</button>)}
          </div>
          {travelMode === 'custom' && <label className="field">Speed <div><input type="range" min="1" max="160" value={customSpeed} onChange={(e) => setCustomSpeed(Number(e.target.value))}/><b>{customSpeed} km/h</b></div></label>}
          <label className="check"><input type="checkbox" checked={snapToRoads} onChange={(e) => { setSnapToRoads(e.target.checked); setPlannedPoints([]) }}/><span>Snap driving route to roads</span></label>
          <label className="check"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)}/><span>Loop route</span></label>
        </section>

        <section>
          <h3>Route</h3>
          <div className="route-stats"><div><span>Distance</span><b>{formatDistance(distance)}</b></div><div><span>ETA</span><b>{formatDuration(duration)}</b></div><div><span>Speed</span><b>{speedKmh} km/h</b></div></div>
          <div className="button-row"><button disabled={routePoints.length < 2} onClick={prepareRoute}>Build</button><button disabled={!routePoints.length} onClick={undoPoint}>Undo</button><button disabled={routePoints.length < 2} onClick={reverseRoute}>Reverse</button><button disabled={!routePoints.length} onClick={clearRoute}>Clear</button></div>
          <div className="progress"><i style={{ width: `${progress * 100}%` }}/></div>
          <div className="playback-row">
            <button className="primary" disabled={activeRoute.length < 2 || playback !== 'idle'} onClick={play}>▶ Play</button>
            <button disabled={playback === 'idle'} onClick={togglePause}>{playback === 'paused' ? '▶ Resume' : 'Ⅱ Pause'}</button>
            <button disabled={playback === 'idle'} onClick={stop}>■ Stop</button>
          </div>
        </section>

        <section>
          <h3>Current location</h3>
          <div className="coordinate-box">{cursor ? <><b>{cursor.lat.toFixed(6)}</b><b>{cursor.lng.toFixed(6)}</b></> : <span>No injected coordinate yet.</span>}</div>
          <div className="button-row"><button disabled={!cursor} onClick={saveFavorite}>☆ Favorite</button><button onClick={resetLocation} disabled={!selectedDevice}>Reset</button></div>
        </section>

        <section>
          <h3>Route files</h3>
          <p className="hint">Save the current route or load a previously recorded scenario.</p>
          <div className="button-row"><button onClick={exportRoute} disabled={!activeRoute.length}>Export JSON</button><label className="file-button">Import JSON<input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importRoute(e.target.files[0])}/></label></div>
          <div className="button-row"><button onClick={exportGpx} disabled={!activeRoute.length}>Export GPX</button><label className="file-button">Import GPX<input type="file" accept="application/gpx+xml,.gpx" onChange={(e) => e.target.files?.[0] && importGpx(e.target.files[0])}/></label></div>
        </section>
      </aside>

      <main className="workspace">
        <button className="locate-button" onClick={() => locateUser(true)} title="Focus on my Mac location">◎ My location</button>
        <div className="search-panel">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search city, address or place…" />
          {searchResults.length > 0 && <div className="search-results">{searchResults.map((result) => <button key={`${result.point.lat}-${result.point.lng}`} onClick={() => { setSearch(''); setSearchResults([]); setFocusPoint(result.point); if (interaction === 'teleport') inject(result.point); else setRoutePoints((p) => { setActiveWaypoint(p.length); return [...p, result.point] }) }}><strong>{result.displayName.split(',')[0]}</strong><span>{result.displayName}</span></button>)}</div>}
        </div>
        <MapCanvas routePoints={activeRoute} waypointPoints={routePoints} cursor={cursor} userLocation={userLocation} mode={interaction} onMapClick={handleMapClick} onWaypointChange={updateWaypoint} onWaypointRemove={removeWaypoint} onWaypointSelect={setActiveWaypoint} activeWaypoint={activeWaypoint} focusPoint={focusPoint}/>
        <div className="map-help"><b>{interaction === 'teleport' ? 'Teleport mode' : 'Route mode'}</b><span>{interaction === 'teleport' ? 'Click map → set simulator location' : `${routePoints.length} waypoint${routePoints.length === 1 ? '' : 's'} · drag pins to edit · double-click to remove`}</span></div>
      </main>

      <aside className="right-panel">
        <section>
          <h3>Environment</h3>
          <div className="tool-list">{diagnostics?.tools.map((tool) => <div key={tool.id}><span className={tool.available ? 'dot ok' : 'dot bad'}/><div><b>{tool.label}</b><small>{tool.available ? tool.version || 'Available' : 'Not found'}</small></div></div>)}</div>
          <p className="hint">iOS requires Xcode Command Line Tools. Android requires ADB from Android SDK Platform Tools.</p>
        </section>
        <section>
          <h3>Favorites</h3>
          {favorites.length === 0 ? <p className="hint">Save commonly used test locations for one-click reuse.</p> : <div className="favorites">{favorites.map((favorite, index) => <div key={`${favorite.name}-${index}`}><button onClick={() => { setFocusPoint(favorite.point); inject(favorite.point) }}><b>{favorite.name}</b><span>{favorite.point.lat.toFixed(4)}, {favorite.point.lng.toFixed(4)}</span></button><button className="icon-button" onClick={() => setFavorites((items) => items.filter((_, i) => i !== index))}>×</button></div>)}</div>}
        </section>
        <section>
          <h3>Test scenarios</h3>
          <div className="scenario-list">
            <button onClick={() => { setTravelMode('walk'); setCustomSpeed(5); setStatus('Walking preset selected. Draw or import a route.') }}><b>Urban walking</b><span>5 km/h pedestrian movement</span></button>
            <button onClick={() => { setTravelMode('drive'); setSnapToRoads(true); setStatus('Driving preset selected with road snapping.') }}><b>Road trip</b><span>50 km/h road-following movement</span></button>
            <button onClick={() => { setTravelMode('custom'); setCustomSpeed(120); setStatus('High-speed movement preset selected.') }}><b>High-speed handoff</b><span>Useful for geofence and region-transition tests</span></button>
          </div>
        </section>
        <section>
          <h3>Safety</h3>
          <p className="hint">Designed for development and QA. Location changes affect the selected simulator/emulator globally, so other apps inside it may also observe the simulated coordinate.</p>
        </section>
      </aside>
    </div>
  )
}
