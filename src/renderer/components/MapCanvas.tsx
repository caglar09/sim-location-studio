import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { GeoPoint } from '../../shared/types'

interface Props {
  routePoints: GeoPoint[]
  cursor?: GeoPoint
  mode: 'teleport' | 'route'
  onMapClick(point: GeoPoint): void
  focusPoint?: GeoPoint
}

const emptyLine = { type: 'FeatureCollection', features: [] } as const

export default function MapCanvas({ routePoints, cursor, mode, onMapClick, focusPoint }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: container.current,
      center: [29.0, 39.0],
      zoom: 5.3,
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
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: emptyLine })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#6ee7ff', 'line-width': 5, 'line-opacity': 0.9 }
      })
      map.addSource('waypoints', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'waypoints',
        type: 'circle',
        source: 'waypoints',
        paint: { 'circle-radius': 6, 'circle-color': '#111827', 'circle-stroke-width': 2, 'circle-stroke-color': '#f8fafc' }
      })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    const line = map.getSource('route') as GeoJSONSource | undefined
    const points = map.getSource('waypoints') as GeoJSONSource | undefined
    line?.setData(routePoints.length > 1 ? {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: routePoints.map((p) => [p.lng, p.lat]) }
    } : emptyLine)
    points?.setData({
      type: 'FeatureCollection',
      features: routePoints.map((p, i) => ({ type: 'Feature', properties: { index: i }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }))
    })
  }, [routePoints])

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
    if (!focusPoint || !mapRef.current) return
    mapRef.current.flyTo({ center: [focusPoint.lng, focusPoint.lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 700 })
  }, [focusPoint])

  return <div className={`map ${mode === 'route' ? 'route-mode' : 'teleport-mode'}`} ref={container} />
}
