import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { GeoPoint } from '../../shared/types'

interface Props {
  routePoints: GeoPoint[]
  waypointPoints: GeoPoint[]
  cursor?: GeoPoint
  userLocation?: GeoPoint
  mode: 'teleport' | 'route'
  onMapClick(point: GeoPoint): void
  onWaypointChange(index: number, point: GeoPoint): void
  onWaypointRemove(index: number): void
  onWaypointSelect(index: number): void
  activeWaypoint: number | null
  focusPoint?: GeoPoint
  visible?: boolean
  pointPicker?: ReactNode
  pointMarkers?: ReadonlyArray<{ id: string; point: GeoPoint; content: ReactNode }>
}

const emptyLine = { type: 'FeatureCollection', features: [] } as const

export default function MapCanvas({
  routePoints,
  waypointPoints,
  cursor,
  userLocation,
  mode,
  onMapClick,
  onWaypointChange,
  onWaypointRemove,
  onWaypointSelect,
  activeWaypoint,
  focusPoint,
  visible = true,
  pointPicker,
  pointMarkers
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const waypointMarkersRef = useRef<maplibregl.Marker[]>([])
  const redrawFrameRef = useRef<number | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const lastFocusPoint = useRef<GeoPoint | undefined>(undefined)
  const [viewportVersion, setViewportVersion] = useState(0)
  const routePointsRef = useRef(routePoints)
  routePointsRef.current = routePoints
  const clickRef = useRef(onMapClick)
  const changeRef = useRef(onWaypointChange)
  const removeRef = useRef(onWaypointRemove)
  const selectRef = useRef(onWaypointSelect)
  clickRef.current = onMapClick
  changeRef.current = onWaypointChange
  removeRef.current = onWaypointRemove
  selectRef.current = onWaypointSelect

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: container.current,
      center: [-73.7124, 45.6066],
      zoom: 11.5,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      }
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('click', (event: MapMouseEvent) => clickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng }))
    map.on('mousemove', ({ point }) => {
      const picker = pickerRef.current
      if (!picker) return
      picker.style.transform = `translate(${point.x}px, ${point.y}px)`
      picker.hidden = false
    })
    map.on('mouseout', () => {
      if (pickerRef.current) pickerRef.current.hidden = true
    })
    map.on('load', () => {
      const currentRoute = routePointsRef.current
      map.addSource('route', { type: 'geojson', data: currentRoute.length > 1 ? {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: currentRoute.map((point) => [point.lng, point.lat]) }
      } : emptyLine })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#20291a', 'line-width': 11, 'line-opacity': 0.9, 'line-blur': 0.35 }
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d2f35b', 'line-width': 6, 'line-opacity': 1 }
      })
    })
    mapRef.current = map
    const scheduleOverlayRedraw = () => {
      if (redrawFrameRef.current !== null) return
      redrawFrameRef.current = requestAnimationFrame(() => {
        redrawFrameRef.current = null
        setViewportVersion((version) => version + 1)
      })
    }
    map.on('move', scheduleOverlayRedraw)
    map.on('resize', scheduleOverlayRedraw)
    return () => {
      map.off('move', scheduleOverlayRedraw)
      map.off('resize', scheduleOverlayRedraw)
      if (redrawFrameRef.current !== null) cancelAnimationFrame(redrawFrameRef.current)
      waypointMarkersRef.current.forEach((marker) => marker.remove())
      waypointMarkersRef.current = []
      map.remove()
      mapRef.current = null
      lastFocusPoint.current = undefined
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const updateRoute = () => {
      const line = map.getSource('route') as GeoJSONSource | undefined
      if (!line) return
      line.setData(routePoints.length > 1 ? {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: routePoints.map((p) => [p.lng, p.lat]) }
      } : emptyLine)
    }
    if (map.getSource('route')) updateRoute()
    else map.once('load', updateRoute)
  }, [routePoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !visible) return
    map.resize()
    if (routePoints.length < 2) return
    const { clientWidth, clientHeight } = map.getContainer()
    if (clientWidth < 40 || clientHeight < 40) return
    const padding = Math.min(110, Math.floor(Math.min(clientWidth, clientHeight) / 5))
    const bounds = new maplibregl.LngLatBounds()
    routePoints.forEach((point) => bounds.extend([point.lng, point.lat]))
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding, maxZoom: 14, duration: 650 })
  }, [routePoints, visible])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    waypointMarkersRef.current.forEach((marker) => marker.remove())
    waypointMarkersRef.current = waypointPoints.map((point, index) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `waypoint-marker${activeWaypoint === index ? ' active' : ''}`
      el.textContent = String(index + 1)
      el.title = 'Drag to move · double-click to remove'
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        selectRef.current(index)
      })
      el.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
        removeRef.current(index)
      })

      const marker = new maplibregl.Marker({ element: el, draggable: mode === 'route' })
        .setLngLat([point.lng, point.lat])
        .addTo(map)

      marker.on('dragstart', () => selectRef.current(index))
      marker.on('dragend', () => {
        const next = marker.getLngLat()
        changeRef.current(index, { lat: next.lat, lng: next.lng })
      })
      return marker
    })

    return () => {
      waypointMarkersRef.current.forEach((marker) => marker.remove())
      waypointMarkersRef.current = []
    }
  }, [waypointPoints, activeWaypoint, mode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!userLocation) {
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      return
    }
    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.className = 'user-location-marker'
      el.title = 'Your Mac location'
      userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([userLocation.lng, userLocation.lat]).addTo(map)
    } else userMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat])
  }, [userLocation])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!cursor) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    if (!markerRef.current) {
      const el = document.createElement('div')
      el.className = 'live-marker'
      markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([cursor.lng, cursor.lat]).addTo(map)
    } else markerRef.current.setLngLat([cursor.lng, cursor.lat])
  }, [cursor])

  useEffect(() => {
    if (!focusPoint || !mapRef.current || !visible || lastFocusPoint.current === focusPoint) return
    lastFocusPoint.current = focusPoint
    mapRef.current.flyTo({
      center: [focusPoint.lng, focusPoint.lat],
      zoom: Math.max(mapRef.current.getZoom(), 15),
      duration: 700,
      essential: true
    })
  }, [focusPoint, visible])

  const map = mapRef.current
  const routePath = routePoints.length > 1 && map
    ? routePoints.map((point, index) => {
      const projected = map.project([point.lng, point.lat])
      return `${index === 0 ? 'M' : 'L'}${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
    }).join(' ')
    : ''
  const mapWidth = container.current?.clientWidth || 1
  const mapHeight = container.current?.clientHeight || 1
  void viewportVersion

  return <>
    <div className={`map ${mode === 'route' ? 'route-mode' : 'teleport-mode'}`} ref={container} />
    {routePath && <svg className="route-overlay" viewBox={`0 0 ${mapWidth} ${mapHeight}`} aria-hidden="true" focusable="false">
      <path d={routePath} fill="none" stroke="#20291a" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <path d={routePath} fill="none" stroke="#d2f35b" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>}
    {map && pointMarkers?.map(({ id, point, content }) => {
      const projected = map.project([point.lng, point.lat])
      return <div className="map-point-overlay" key={id} style={{ transform: `translate(${projected.x}px, ${projected.y}px)` }}>
        {content}
      </div>
    })}
    {pointPicker && <div className="map-point-overlay map-point-picker" ref={pickerRef} hidden aria-hidden="true">{pointPicker}</div>}
  </>
}
