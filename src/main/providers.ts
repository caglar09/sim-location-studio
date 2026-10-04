import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceInfo, GeoPoint, LocationResult, ToolStatus } from '../shared/types'

const execFileAsync = promisify(execFile)
const ANDROID_COMPANION_PACKAGE = 'dev.simlocation.companion'
const IOS_PHYSICAL_PREFIX = 'ios-physical:'

async function run(command: string, args: string[], timeout = 10000, extraEnv?: NodeJS.ProcessEnv) {
  return execFileAsync(command, args, {
    timeout,
    maxBuffer: 1024 * 1024 * 4,
    encoding: 'utf8',
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env
  })
}

async function commandVersion(command: string, args: string[], label: ToolStatus['id']): Promise<ToolStatus> {
  try {
    const { stdout, stderr } = await run(command, args, 5000)
    return { id: label, label, available: true, version: (stdout || stderr).trim().split('\n')[0] }
  } catch (error) {
    return { id: label, label, available: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function hasPymobiledevice3() {
  try {
    await run('pymobiledevice3', ['--version'], 5000)
    return true
  } catch {
    return false
  }
}

export async function diagnostics(): Promise<ToolStatus[]> {
  const [xcrun, adb, pymobiledevice3] = await Promise.all([
    commandVersion('xcrun', ['--version'], 'xcrun'),
    commandVersion('adb', ['version'], 'adb'),
    commandVersion('pymobiledevice3', ['--version'], 'pymobiledevice3')
  ])

  let simctl: ToolStatus
  try {
    const { stdout } = await run('xcrun', ['simctl', 'help'], 5000)
    simctl = { id: 'simctl', label: 'simctl', available: true, version: stdout.split('\n')[0]?.trim() || 'Available' }
  } catch (error) {
    simctl = { id: 'simctl', label: 'simctl', available: false, detail: error instanceof Error ? error.message : String(error) }
  }

  return [xcrun, simctl, adb, pymobiledevice3]
}

export async function listIosSimulators(): Promise<DeviceInfo[]> {
  try {
    const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
    const parsed = JSON.parse(stdout) as { devices?: Record<string, Array<{ udid: string; name: string; state: string; isAvailable?: boolean }>> }
    const devices: DeviceInfo[] = []

    for (const [runtime, items] of Object.entries(parsed.devices ?? {})) {
      const osVersion = runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, '').replaceAll('-', '.')
      for (const item of items) {
        devices.push({
          id: item.udid,
          name: item.name,
          platform: 'ios',
          kind: 'simulator',
          state: item.state === 'Booted' ? 'booted' : 'shutdown',
          osVersion,
          supported: true,
          provider: 'ios-simctl',
          connection: 'local',
          detail: item.state
        })
      }
    }

    return devices.sort((a, b) => (a.state === 'booted' ? -1 : b.state === 'booted' ? 1 : a.name.localeCompare(b.name)))
  } catch {
    return []
  }
}

type PymobileDevice = {
  Identifier?: string
  UniqueDeviceID?: string
  DeviceName?: string
  ProductType?: string
  ProductVersion?: string
  ConnectionType?: string
  DeviceClass?: string
}

export async function listIosPhysicalDevices(): Promise<DeviceInfo[]> {
  if (!(await hasPymobiledevice3())) return []

  try {
    const { stdout } = await run('pymobiledevice3', ['usbmux', 'list'], 8000)
    const parsed = JSON.parse(stdout) as PymobileDevice[]
    const byUdid = new Map<string, PymobileDevice>()

    for (const item of parsed) {
      const udid = item.Identifier || item.UniqueDeviceID
      if (!udid || item.DeviceClass && item.DeviceClass !== 'iPhone' && item.DeviceClass !== 'iPad') continue
      const existing = byUdid.get(udid)
      if (!existing || item.ConnectionType === 'USB') byUdid.set(udid, item)
    }

    return [...byUdid.entries()].map(([udid, item]) => ({
      id: `${IOS_PHYSICAL_PREFIX}${udid}`,
      name: item.DeviceName || item.ProductType || 'iOS Device',
      platform: 'ios' as const,
      kind: 'physical' as const,
      state: 'online' as const,
      osVersion: item.ProductVersion,
      model: item.ProductType,
      supported: true,
      provider: 'ios-pymobiledevice3' as const,
      connection: item.ConnectionType === 'Network' ? 'network' as const : 'usb' as const,
      detail: `Physical iOS device · ${item.ConnectionType || 'USB'} · Developer Mode required for iOS 17+`
    }))
  } catch {
    return []
  }
}

async function androidCompanionState(deviceId: string) {
  try {
    await run('adb', ['-s', deviceId, 'shell', 'pm', 'path', ANDROID_COMPANION_PACKAGE], 5000)
  } catch {
    return { installed: false, mockAllowed: false }
  }

  try {
    const { stdout } = await run('adb', ['-s', deviceId, 'shell', 'appops', 'get', ANDROID_COMPANION_PACKAGE, 'android:mock_location'], 5000)
    return { installed: true, mockAllowed: /allow/i.test(stdout) }
  } catch {
    return { installed: true, mockAllowed: false }
  }
}

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
  try {
    const { stdout } = await run('adb', ['devices', '-l'])
    const lines = stdout.trim().split('\n').slice(1).map((line) => line.trim()).filter(Boolean)
    const devices: DeviceInfo[] = []

    for (const line of lines) {
      const [id, stateRaw, ...rest] = line.split(/\s+/)
      const meta = Object.fromEntries(rest.filter((item) => item.includes(':')).map((item) => item.split(':', 2)))
      const emulator = id.startsWith('emulator-')
      const online = stateRaw === 'device'

      if (emulator) {
        devices.push({
          id,
          name: meta.model?.replaceAll('_', ' ') || `Android Emulator ${id}`,
          platform: 'android',
          kind: 'emulator',
          state: online ? 'online' : stateRaw === 'offline' ? 'offline' : 'unknown',
          model: meta.model,
          supported: online,
          provider: 'android-emulator',
          connection: 'local',
          detail: 'ADB emulator geo injection'
        })
        continue
      }

      const companion = online ? await androidCompanionState(id) : { installed: false, mockAllowed: false }
      devices.push({
        id,
        name: meta.model?.replaceAll('_', ' ') || id,
        platform: 'android',
        kind: 'physical',
        state: online ? 'online' : stateRaw === 'offline' ? 'offline' : 'unknown',
        model: meta.model,
        supported: online && companion.installed && companion.mockAllowed,
        provider: 'android-companion',
        connection: 'usb',
        detail: !online
          ? 'ADB device is offline.'
          : !companion.installed
            ? 'Install the Sim Location Companion APK on this device.'
            : !companion.mockAllowed
              ? 'Select Sim Location Companion in Developer options → Select mock location app.'
              : 'Physical Android device · Sim Location Companion ready'
      })
    }

    return devices
  } catch {
    return []
  }
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const [iosSimulators, iosPhysical, android] = await Promise.all([
    listIosSimulators(),
    listIosPhysicalDevices(),
    listAndroidDevices()
  ])
  return [...iosSimulators, ...iosPhysical, ...android]
}

function parseIosMajor(version?: string) {
  const major = Number((version || '').split('.')[0])
  return Number.isFinite(major) ? major : 17
}

async function setPhysicalIosLocation(deviceId: string, point: GeoPoint, version?: string): Promise<LocationResult> {
  const udid = deviceId.replace(IOS_PHYSICAL_PREFIX, '')
  const env = { PYMOBILEDEVICE3_UDID: udid }
  const major = parseIosMajor(version)
  const args = major >= 17
    ? ['developer', 'dvt', 'simulate-location', 'set', '--', String(point.lat), String(point.lng)]
    : ['developer', 'simulate-location', 'set', '--', String(point.lat), String(point.lng)]

  try {
    // Modern pymobiledevice3 may keep the DVT command alive after applying a
    // location. A short timeout still surfaces setup failures; route-grade
    // persistent sessions are the next provider layer.
    await run('pymobiledevice3', args, 12000, env)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timed out|ETIMEDOUT/i.test(message)) {
      return {
        ok: false,
        message: 'The iOS DVT location command did not complete. Ensure the phone is unlocked, trusted, Developer Mode is enabled, and pymobiledevice3 is up to date.'
      }
    }
    return { ok: false, message }
  }
}

async function clearPhysicalIosLocation(deviceId: string, version?: string): Promise<LocationResult> {
  const udid = deviceId.replace(IOS_PHYSICAL_PREFIX, '')
  const env = { PYMOBILEDEVICE3_UDID: udid }
  const major = parseIosMajor(version)
  const args = major >= 17
    ? ['developer', 'dvt', 'simulate-location', 'clear']
    : ['developer', 'simulate-location', 'clear']

  try {
    await run('pymobiledevice3', args, 12000, env)
    return { ok: true, message: 'Physical iOS location simulation cleared.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function setPhysicalAndroidLocation(deviceId: string, point: GeoPoint): Promise<LocationResult> {
  try {
    const { stdout } = await run('adb', [
      '-s', deviceId,
      'shell', 'am', 'broadcast',
      '-a', 'dev.simlocation.companion.SET_LOCATION',
      '-p', ANDROID_COMPANION_PACKAGE,
      '--ef', 'lat', String(point.lat),
      '--ef', 'lng', String(point.lng)
    ], 6000)

    if (!/result=0|Broadcast completed/i.test(stdout)) throw new Error(stdout.trim() || 'Companion broadcast failed')
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function clearPhysicalAndroidLocation(deviceId: string): Promise<LocationResult> {
  try {
    await run('adb', [
      '-s', deviceId,
      'shell', 'am', 'broadcast',
      '-a', 'dev.simlocation.companion.CLEAR_LOCATION',
      '-p', ANDROID_COMPANION_PACKAGE
    ], 6000)
    return { ok: true, message: 'Android mock location cleared.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function setLocation(platform: 'ios' | 'android', deviceId: string, point: GeoPoint, osVersion?: string): Promise<LocationResult> {
  try {
    if (platform === 'ios') {
      if (deviceId.startsWith(IOS_PHYSICAL_PREFIX)) return setPhysicalIosLocation(deviceId, point, osVersion)
      await run('xcrun', ['simctl', 'location', deviceId, 'set', `${point.lat},${point.lng}`])
      return { ok: true }
    }

    if (!deviceId.startsWith('emulator-')) return setPhysicalAndroidLocation(deviceId, point)

    await run('adb', ['-s', deviceId, 'emu', 'geo', 'fix', String(point.lng), String(point.lat)])
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function clearLocation(platform: 'ios' | 'android', deviceId: string, osVersion?: string): Promise<LocationResult> {
  try {
    if (platform === 'ios') {
      if (deviceId.startsWith(IOS_PHYSICAL_PREFIX)) return clearPhysicalIosLocation(deviceId, osVersion)
      await run('xcrun', ['simctl', 'location', deviceId, 'clear'])
      return { ok: true }
    }

    if (!deviceId.startsWith('emulator-')) return clearPhysicalAndroidLocation(deviceId)

    return { ok: true, message: 'Android Emulator keeps the last injected coordinate. Set a new point or restart the emulator to return to its default state.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
