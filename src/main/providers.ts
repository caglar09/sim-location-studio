import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
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

let pythonPromise: Promise<string | null> | null = null

async function findPymobiledevicePython(): Promise<string | null> {
  if (!pythonPromise) {
    pythonPromise = (async () => {
      const candidates = process.platform === 'win32'
        ? ['python', 'py']
        : ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3', 'python']

      for (const candidate of candidates) {
        try {
          const args = candidate === 'py'
            ? ['-3', '-c', 'import pymobiledevice3; print("ok")']
            : ['-c', 'import pymobiledevice3; print("ok")']
          await run(candidate, args, 5000)
          return candidate
        } catch {
          // Try the next Python installation.
        }
      }

      // pipx/user installs commonly expose the CLI in ~/.local/bin while the
      // Python that owns the package is not one of the interpreters above.
      if (process.platform !== 'win32') {
        const cliCandidates = [
          join(homedir(), '.local', 'bin', 'pymobiledevice3'),
          '/opt/homebrew/bin/pymobiledevice3',
          '/usr/local/bin/pymobiledevice3',
          'pymobiledevice3'
        ]

        for (const candidate of cliCandidates) {
          try {
            await run(candidate, ['--help'], 5000)

            // pipx/uv/user installs expose a small executable script whose
            // shebang points at the virtualenv Python that owns pymobiledevice3.
            // Reuse that interpreter so the development bridge can import the
            // same package instead of merely detecting the CLI.
            if (candidate.startsWith('/')) {
              try {
                const firstLine = readFileSync(candidate, 'utf8').split('\\n', 1)[0]
                const shebang = firstLine.match(/^#!\\s*(.+)$/)?.[1]?.trim()
                if (shebang && existsSync(shebang)) {
                  await run(shebang, ['-c', 'import pymobiledevice3; print("ok")'], 5000)
                  return shebang
                }
              } catch {
                // Fall back to CLI-only detection below.
              }
            }

            return `cli:${candidate}`
          } catch {
            // Try the next CLI installation.
          }
        }
      }
      return null
    })()
  }
  return pythonPromise
}

export async function diagnostics(): Promise<ToolStatus[]> {
  const [xcrun, adb, python] = await Promise.all([
    commandVersion('xcrun', ['--version'], 'xcrun'),
    commandVersion('adb', ['version'], 'adb'),
    app.isPackaged ? Promise.resolve(null) : findPymobiledevicePython()
  ])

  let simctl: ToolStatus
  try {
    const { stdout } = await run('xcrun', ['simctl', 'help'], 5000)
    simctl = { id: 'simctl', label: 'simctl', available: true, version: stdout.split('\n')[0]?.trim() || 'Available' }
  } catch (error) {
    simctl = { id: 'simctl', label: 'simctl', available: false, detail: error instanceof Error ? error.message : String(error) }
  }

  let pymobiledevice3: ToolStatus
  if (app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')) {
    const bridge = await resolveIosBridgeCommand(['--list'])
    if (!bridge) {
      pymobiledevice3 = {
        id: 'pymobiledevice3',
        label: 'iOS physical bridge',
        available: false,
        detail: 'Bundled physical iOS bridge is missing from application resources.'
      }
    } else {
      try {
        await run(bridge.command, bridge.args, 12000)
        pymobiledevice3 = {
          id: 'pymobiledevice3',
          label: 'iOS physical bridge',
          available: true,
          version: 'Bundled'
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error)
        const windowsHint = process.platform === 'win32'
          ? ' Install Apple Devices or iTunes from Apple so Apple Mobile Device Support is available, then reconnect the iPhone.'
          : ' Unlock the iPhone, trust this Mac, reconnect USB, and refresh devices.'
        pymobiledevice3 = {
          id: 'pymobiledevice3',
          label: 'iOS physical bridge',
          available: false,
          detail: `${raw}${windowsHint}`
        }
      }
    }
  } else if (!python) {
    pymobiledevice3 = {
      id: 'pymobiledevice3',
      label: 'pymobiledevice3',
      available: false,
      detail: 'Development only: install pymobiledevice3 in your local Python environment.'
    }
  } else {
    try {
      if (python.startsWith('cli:')) {
        pymobiledevice3 = { id: 'pymobiledevice3', label: 'pymobiledevice3', available: true, version: 'Available' }
      } else {
        const versionArgs = python === 'py'
          ? ['-3', '-c', 'import importlib.metadata; print(importlib.metadata.version("pymobiledevice3"))']
          : ['-c', 'import importlib.metadata; print(importlib.metadata.version("pymobiledevice3"))']
        const { stdout } = await run(python, versionArgs, 5000)
        pymobiledevice3 = { id: 'pymobiledevice3', label: 'pymobiledevice3', available: true, version: stdout.trim() }
      }
    } catch {
      pymobiledevice3 = { id: 'pymobiledevice3', label: 'pymobiledevice3', available: true, version: 'Available' }
    }
  }

  return [xcrun, simctl, adb, pymobiledevice3]
}

export async function listIosSimulators(): Promise<DeviceInfo[]> {
  try {
    const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
    const parsed = JSON.parse(stdout) as { devices?: Record<string, Array<{ udid: string; name: string; state: string }>> }
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

async function resolveIosBridgeCommand(args: string[]): Promise<{ command: string; args: string[] } | null> {
  if (app.isPackaged) {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return null
    const executableName = process.platform === 'win32' ? 'ios-device-bridge.exe' : 'ios-device-bridge'
    const executable = join(process.resourcesPath, 'bin', executableName)
    return existsSync(executable) ? { command: executable, args } : null
  }

  const python = await findPymobiledevicePython()
  if (!python) return null
  if (python.startsWith('cli:')) {
    // The bridge itself imports pymobiledevice3, so a standalone CLI cannot
    // execute it. Keep diagnostics accurate, but require a matching Python
    // interpreter for physical-device bridge development.
    return null
  }

  const prefix = python === 'py' ? ['-3'] : []
  return {
    command: python,
    args: [...prefix, join(process.cwd(), 'scripts', 'ios_device_bridge.py'), ...args]
  }
}

async function listIosPhysicalDevicesViaCli(): Promise<PymobileDevice[]> {
  if (app.isPackaged || process.platform === 'win32') return []

  const candidates = [
    join(homedir(), '.local', 'bin', 'pymobiledevice3'),
    '/opt/homebrew/bin/pymobiledevice3',
    '/usr/local/bin/pymobiledevice3',
    'pymobiledevice3'
  ]

  for (const candidate of candidates) {
    try {
      const { stdout } = await run(candidate, ['usbmux', 'list'], 12000)
      const parsed = JSON.parse(stdout) as PymobileDevice[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // Try the next CLI location.
    }
  }

  return []
}

export async function listIosPhysicalDevices(): Promise<DeviceInfo[]> {
  const bridge = await resolveIosBridgeCommand(['--list'])

  let parsed: PymobileDevice[] = []
  if (bridge) {
    try {
      const { stdout } = await run(bridge.command, bridge.args, 12000)
      parsed = JSON.parse(stdout) as PymobileDevice[]
    } catch {
      // The source bridge can break when pymobiledevice3 changes internal APIs.
      // In development, fall back to the stable public CLI used by the user.
      parsed = await listIosPhysicalDevicesViaCli()
    }
  } else {
    parsed = await listIosPhysicalDevicesViaCli()
  }

  try {
    const byUdid = new Map<string, PymobileDevice>()

    for (const item of parsed) {
      const udid = item.Identifier || item.UniqueDeviceID
      if (!udid || (item.DeviceClass && item.DeviceClass !== 'iPhone' && item.DeviceClass !== 'iPad')) continue
      const existing = byUdid.get(udid)
      if (!existing || item.ConnectionType === 'USB') byUdid.set(udid, item)
    }

    return [...byUdid.entries()].map(([udid, item]) => {
      return {
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
      }
    })
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

type PendingCommand = {
  resolve: (result: LocationResult) => void
  timer: NodeJS.Timeout
}

type IosBridgeSession = {
  child: ChildProcessWithoutNullStreams
  ready: Promise<void>
  send: (action: 'set' | 'clear', point?: GeoPoint) => Promise<LocationResult>
  dispose: () => void
}

const iosBridgeSessions = new Map<string, IosBridgeSession>()

async function createIosBridgeSession(udid: string): Promise<IosBridgeSession> {
  const bridge = await resolveIosBridgeCommand(['--udid', udid])
  if (!bridge) {
    throw new Error(app.isPackaged
      ? 'The bundled physical iOS bridge is missing from this application build.'
      : 'pymobiledevice3 is not installed for development mode. Install it in your local Python environment.')
  }

  const child = spawn(bridge.command, bridge.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  }) as ChildProcessWithoutNullStreams

  let sequence = 0
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let readyResolve!: () => void
  let readyReject!: (error: Error) => void
  const pending = new Map<number, PendingCommand>()

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  const rejectAll = (message: string) => {
    for (const [, item] of pending) {
      clearTimeout(item.timer)
      item.resolve({ ok: false, message })
    }
    pending.clear()
  }

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    let newline = stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (line) {
        try {
          const message = JSON.parse(line) as { type?: string; id?: number; ok?: boolean; message?: string }
          if (message.type === 'ready') readyResolve()
          if (message.type === 'fatal') readyReject(new Error(message.message || 'iOS bridge failed'))
          if (message.type === 'result' && typeof message.id === 'number') {
            const item = pending.get(message.id)
            if (item) {
              clearTimeout(item.timer)
              pending.delete(message.id)
              item.resolve({ ok: Boolean(message.ok), message: message.message })
            }
          }
        } catch {
          // Ignore non-protocol stdout.
        }
      }
      newline = stdoutBuffer.indexOf('\n')
    }
  })

  child.stderr.on('data', (chunk: string) => {
    stderrBuffer = (stderrBuffer + chunk).slice(-8000)
  })

  child.once('error', (error) => {
    readyReject(error)
    rejectAll(error.message)
    iosBridgeSessions.delete(udid)
  })

  child.once('exit', (code) => {
    const message = stderrBuffer.trim() || `iOS bridge exited with code ${code ?? 'unknown'}`
    readyReject(new Error(message))
    rejectAll(message)
    iosBridgeSessions.delete(udid)
  })

  const readyTimer = setTimeout(() => {
    readyReject(new Error(process.platform === 'win32'
      ? 'Timed out connecting to the physical iOS device. Verify Trust, Developer Mode, and Apple Mobile Device Support on Windows.'
      : 'Timed out connecting to the physical iOS device. Verify Trust and Developer Mode.'))
    child.kill()
  }, 25000)
  ready.finally(() => clearTimeout(readyTimer)).catch(() => undefined)

  const session: IosBridgeSession = {
    child,
    ready,
    send: async (action, point) => {
      try {
        await ready
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }

      const id = ++sequence
      return new Promise<LocationResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve({ ok: false, message: 'Physical iOS location command timed out.' })
        }, 10000)

        pending.set(id, { resolve, timer })
        child.stdin.write(JSON.stringify({
          id,
          action,
          ...(point ? { lat: point.lat, lng: point.lng } : {})
        }) + '\n')
      })
    },
    dispose: () => {
      rejectAll('iOS bridge closed.')
      child.kill()
    }
  }

  return session
}

async function getIosBridgeSession(deviceId: string): Promise<IosBridgeSession> {
  const udid = deviceId.replace(IOS_PHYSICAL_PREFIX, '')
  const existing = iosBridgeSessions.get(udid)
  if (existing && !existing.child.killed) return existing
  const session = await createIosBridgeSession(udid)
  iosBridgeSessions.set(udid, session)
  return session
}

export function disposePhysicalDeviceSessions() {
  for (const [, session] of iosBridgeSessions) session.dispose()
  iosBridgeSessions.clear()
}

async function setPhysicalIosLocation(deviceId: string, point: GeoPoint): Promise<LocationResult> {
  try {
    return await (await getIosBridgeSession(deviceId)).send('set', point)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function clearPhysicalIosLocation(deviceId: string): Promise<LocationResult> {
  try {
    return await (await getIosBridgeSession(deviceId)).send('clear')
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
      '--es', 'lat', String(point.lat),
      '--es', 'lng', String(point.lng)
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

export async function setLocation(platform: 'ios' | 'android', deviceId: string, point: GeoPoint): Promise<LocationResult> {
  try {
    if (platform === 'ios') {
      if (deviceId.startsWith(IOS_PHYSICAL_PREFIX)) return setPhysicalIosLocation(deviceId, point)
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

export async function clearLocation(platform: 'ios' | 'android', deviceId: string): Promise<LocationResult> {
  try {
    if (platform === 'ios') {
      if (deviceId.startsWith(IOS_PHYSICAL_PREFIX)) return clearPhysicalIosLocation(deviceId)
      await run('xcrun', ['simctl', 'location', deviceId, 'clear'])
      return { ok: true }
    }

    if (!deviceId.startsWith('emulator-')) return clearPhysicalAndroidLocation(deviceId)

    return { ok: true, message: 'Android Emulator keeps the last injected coordinate. Set a new point or restart the emulator to return to its default state.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
