import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceInfo, GeoPoint, LocationResult, ToolStatus } from '../shared/types'

const execFileAsync = promisify(execFile)

async function run(command: string, args: string[], timeout = 10000) {
  return execFileAsync(command, args, {
    timeout,
    maxBuffer: 1024 * 1024 * 4,
    encoding: 'utf8'
  })
}

async function commandVersion(command: string, args: string[], label: string): Promise<ToolStatus> {
  try {
    const { stdout, stderr } = await run(command, args, 5000)
    return { id: label as ToolStatus['id'], label, available: true, version: (stdout || stderr).trim().split('\n')[0] }
  } catch (error) {
    return { id: label as ToolStatus['id'], label, available: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

export async function diagnostics(): Promise<ToolStatus[]> {
  const [xcrun, adb] = await Promise.all([
    commandVersion('xcrun', ['--version'], 'xcrun'),
    commandVersion('adb', ['version'], 'adb')
  ])

  let simctl: ToolStatus
  try {
    const { stdout } = await run('xcrun', ['simctl', 'help'], 5000)
    simctl = { id: 'simctl', label: 'simctl', available: true, version: stdout.split('\n')[0]?.trim() || 'Available' }
  } catch (error) {
    simctl = { id: 'simctl', label: 'simctl', available: false, detail: error instanceof Error ? error.message : String(error) }
  }

  return [xcrun, simctl, adb]
}

export async function listIosDevices(): Promise<DeviceInfo[]> {
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
          detail: item.state
        })
      }
    }

    return devices.sort((a, b) => (a.state === 'booted' ? -1 : b.state === 'booted' ? 1 : a.name.localeCompare(b.name)))
  } catch {
    return []
  }
}

function parseAdbDevices(output: string): DeviceInfo[] {
  const lines = output.trim().split('\n').slice(1).map((line) => line.trim()).filter(Boolean)
  return lines.map((line) => {
    const [id, stateRaw, ...rest] = line.split(/\s+/)
    const meta = Object.fromEntries(rest.filter((item) => item.includes(':')).map((item) => item.split(':', 2)))
    const emulator = id.startsWith('emulator-')
    const online = stateRaw === 'device'
    return {
      id,
      name: meta.model?.replaceAll('_', ' ') || (emulator ? `Android Emulator ${id}` : id),
      platform: 'android' as const,
      kind: emulator ? 'emulator' as const : 'physical' as const,
      state: online ? 'online' as const : stateRaw === 'offline' ? 'offline' as const : 'unknown' as const,
      model: meta.model,
      supported: emulator && online,
      detail: emulator ? 'ADB emulator geo injection' : 'Physical Android devices require a mock-location app and are not injected directly.'
    }
  })
}

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
  try {
    const { stdout } = await run('adb', ['devices', '-l'])
    return parseAdbDevices(stdout)
  } catch {
    return []
  }
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const [ios, android] = await Promise.all([listIosDevices(), listAndroidDevices()])
  return [...ios, ...android]
}

export async function setLocation(platform: 'ios' | 'android', deviceId: string, point: GeoPoint): Promise<LocationResult> {
  try {
    if (platform === 'ios') {
      await run('xcrun', ['simctl', 'location', deviceId, 'set', `${point.lat},${point.lng}`])
      return { ok: true }
    }

    if (!deviceId.startsWith('emulator-')) {
      return { ok: false, message: 'Direct location injection is currently limited to Android Emulator instances.' }
    }

    await run('adb', ['-s', deviceId, 'emu', 'geo', 'fix', String(point.lng), String(point.lat)])
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function clearLocation(platform: 'ios' | 'android', deviceId: string): Promise<LocationResult> {
  try {
    if (platform === 'ios') {
      await run('xcrun', ['simctl', 'location', deviceId, 'clear'])
      return { ok: true }
    }

    if (!deviceId.startsWith('emulator-')) {
      return { ok: false, message: 'Physical Android devices are not directly controlled.' }
    }

    // Android Emulator has no universal "clear mock location" command. Restarting or setting a new location replaces it.
    return { ok: true, message: 'Android Emulator keeps the last injected coordinate. Set a new point or restart the emulator to return to its default state.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
