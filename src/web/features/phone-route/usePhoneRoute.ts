import { useEffect, useRef, useState } from 'react'
import type { GeoPoint } from '../../../shared/types'
import { requestWebApi } from '../../bridge'

export type PhoneRouteStep = [latitude: number, longitude: number, delayMs: number]
type PhoneRouteCommand = { action: 'start'; steps: PhoneRouteStep[]; endWaitMs: number; index?: number }
  | { action: 'seek'; index: number }
  | { action: 'rate'; rate: number }
  | { action: 'pause' | 'resume' | 'stop' }

interface PhoneRouteStatus {
  id?: string
  state: 'idle' | 'running' | 'paused' | 'stopping' | 'finished' | 'failed'
  completed: number
  total: number
  rate?: number
  point?: GeoPoint
  metrics?: {
    totalMs: number
    remainingMs: number
    remainingMeters: number
    arrivalAt?: string
  }
  error?: string
}

export function isPhoneRouteActive(status?: PhoneRouteStatus) {
  return status?.state === 'running' || status?.state === 'paused' || status?.state === 'stopping'
}

export function usePhoneRoute(token: string, deviceId?: string) {
  const [current, setCurrent] = useState<{ deviceId: string; status: PhoneRouteStatus }>()
  const [activePath, setActivePath] = useState<{ id: string; points: GeoPoint[] }>()
  const [pendingDevice, setPendingDevice] = useState<string>()
  const [notice, setNotice] = useState<{ deviceId: string; message: string }>()
  const version = useRef(0)
  const pending = useRef<string | undefined>(undefined)
  const route = current?.deviceId === deviceId ? current?.status : undefined
  const active = isPhoneRouteActive(route)
  const routeId = route?.id

  useEffect(() => {
    if (!token || !deviceId || !routeId) return
    const controller = new AbortController()
    const params = new URLSearchParams({ deviceId, includePath: '1' })
    void requestWebApi<PhoneRouteStatus & { path?: GeoPoint[] }>(token, '/location/route?' + params, { signal: controller.signal })
      .then(({ id, path }) => {
        if (!controller.signal.aborted && id === routeId && path) setActivePath({ id, points: path })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [token, deviceId, routeId])

  useEffect(() => {
    if (!token || !deviceId) return
    const selectedDevice = deviceId
    const controller = new AbortController()
    let timer: number | undefined

    async function poll() {
      const generation = version.current
      if (!pending.current) {
        try {
          const status = await requestWebApi<PhoneRouteStatus>(token, '/location/route?deviceId=' + encodeURIComponent(selectedDevice), { signal: controller.signal })
          if (!controller.signal.aborted && generation === version.current && !pending.current) {
            setCurrent({ deviceId: selectedDevice, status })
          }
        } catch {
          // Keep the last confirmed position and retry on the next poll.
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, active ? 400 : 1500)
    }

    void poll()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [token, deviceId, active])

  async function issue(command: PhoneRouteCommand) {
    if (!deviceId || pending.current) return
    pending.current = deviceId
    version.current++
    setPendingDevice(deviceId)
    setNotice(undefined)
    try {
      const status = await requestWebApi<PhoneRouteStatus>(token, '/location/route', {
        method: 'POST', body: JSON.stringify({ deviceId, platform: 'ios', ...command })
      })
      setCurrent({ deviceId, status })
      return status
    } catch (error) {
      setNotice({ deviceId, message: error instanceof Error ? error.message : 'La commande de trajet a échoué.' })
    } finally {
      version.current++
      pending.current = undefined
      setPendingDevice(undefined)
    }
  }

  function updateManualPoint(point?: GeoPoint) {
    if (!deviceId) return
    version.current++
    setCurrent({ deviceId, status: { state: 'idle', completed: 0, total: 0, point } })
    setNotice(undefined)
  }

  return {
    route,
    path: activePath?.id === routeId ? activePath?.points : undefined,
    issue,
    updateManualPoint,
    busy: pendingDevice === deviceId && !!deviceId,
    error: (notice?.deviceId === deviceId ? notice?.message : undefined) || route?.error
  }
}
