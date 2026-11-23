import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const bridgeScript = join(projectRoot, 'scripts', 'ios_device_bridge.py')
const physicalPrefix = 'ios-physical:'
const sessions = new Map()
let pythonPromise
let nextCommandId = 0

async function run(command, args, timeout = 5000) {
  return execFileAsync(command, args, { timeout, maxBuffer: 1024 * 1024 * 4, encoding: 'utf8' })
}

async function findPython() {
  if (!pythonPromise) {
    pythonPromise = (async () => {
      const candidates = [process.env.PYMOBILEDEVICE3_PYTHON, join(projectRoot, '.venv', 'bin', 'python'), 'python3', 'python'].filter(Boolean)
      for (const command of candidates) {
        try {
          await run(command, ['-c', 'import pymobiledevice3'], 7000)
          return command
        } catch { /* try the next interpreter */ }
      }
      return null
    })()
  }
  return pythonPromise
}

export async function bridgeStatus() {
  const python = await findPython()
  return { available: Boolean(python), detail: python ? `USB iPhone bridge ready (${python})` : 'Install pymobiledevice3 in the project .venv to enable USB iPhone control.' }
}

function displayModel(productType) {
  if (productType === 'iPhone10,6' || productType === 'iPhone10,3') return 'iPhone X'
  return productType || 'iPhone'
}

export async function listDevices() {
  const python = await findPython()
  if (!python) return []
  const { stdout } = await run(python, [bridgeScript, '--list'], 15000)
  const connected = JSON.parse(stdout)
  return connected.map((phone) => {
    const serial = phone.Identifier
    const model = displayModel(phone.ProductType)
    const connection = String(phone.ConnectionType || 'USB').toLowerCase().includes('usb') ? 'usb' : 'network'
    return {
      id: `${physicalPrefix}${serial}`,
      name: phone.DeviceName || model,
      platform: 'ios',
      kind: 'physical',
      state: 'online',
      osVersion: phone.ProductVersion || undefined,
      model,
      supported: Boolean(serial),
      provider: 'ios-pymobiledevice3',
      connection,
      detail: `${model}${phone.ProductVersion ? ` · iOS ${phone.ProductVersion}` : ''} · ${connection.toUpperCase()}`
    }
  })
}

function makeSession(python, serial) {
  const child = spawn(python, [bridgeScript, '--udid', serial], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } })
  const session = { child, buffer: '', pending: new Map(), ready: false, startupError: '', stderr: '', readyTimer: null }
  let readyResolve, readyReject
  session.readyPromise = new Promise((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady })
  session.readyTimer = setTimeout(() => { session.startupError = 'Timed out while opening the iPhone location session'; readyReject(new Error(session.startupError)); child.kill('SIGTERM') }, 45000)

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    session.buffer += chunk
    const lines = session.buffer.split('\n')
    session.buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      if (message.type === 'ready') {
        session.ready = true
        clearTimeout(session.readyTimer)
        readyResolve()
      } else if (message.type === 'fatal') {
        session.startupError = message.message || 'The iPhone location bridge could not start'
        if (!session.ready) { clearTimeout(session.readyTimer); readyReject(new Error(session.startupError)) }
      } else if (message.type === 'result' && session.pending.has(message.id)) {
        const pending = session.pending.get(message.id)
        session.pending.delete(message.id)
        clearTimeout(pending.timer)
        pending.resolve(message)
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { session.stderr = `${session.stderr}${chunk}`.slice(-5000) })
  child.on('error', (error) => {
    session.startupError = error.message
    clearTimeout(session.readyTimer)
    readyReject(error)
  })
  child.on('exit', (code) => {
    clearTimeout(session.readyTimer)
    sessions.delete(serial)
    const reason = session.startupError || session.stderr.trim() || `iPhone bridge exited (${code ?? 'unknown'})`
    readyReject(new Error(reason))
    for (const pending of session.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)) }
    session.pending.clear()
  })
  return session
}

async function getSession(serial) {
  let session = sessions.get(serial)
  if (!session) {
    const python = await findPython()
    if (!python) throw new Error('pymobiledevice3 is not installed in the project environment')
    session = sessions.get(serial)
    if (!session) {
      session = makeSession(python, serial)
      sessions.set(serial, session)
    }
  }
  await session.readyPromise
  return session
}

async function send(serial, action, point) {
  const session = await getSession(serial)
  const id = ++nextCommandId
  const command = { id, action }
  if (point) { command.lat = point.lat; command.lng = point.lng }
  const response = new Promise((resolveResponse, rejectResponse) => {
    const timer = setTimeout(() => { session.pending.delete(id); rejectResponse(new Error('The iPhone did not respond to the location command')) }, 30000)
    session.pending.set(id, { resolve: resolveResponse, reject: rejectResponse, timer })
  })
  session.child.stdin.write(`${JSON.stringify(command)}\n`)
  const result = await response
  return { ok: Boolean(result.ok), message: result.message }
}

export async function setLocation(deviceId, point) {
  if (typeof deviceId !== 'string' || !deviceId.startsWith(physicalPrefix)) return { ok: false, message: 'Identifiant iPhone invalide.' }
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
    return { ok: false, message: 'Coordonnées GPS invalides.' }
  }
  return send(deviceId.slice(physicalPrefix.length), 'set', point)
}

export async function clearLocation(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.startsWith(physicalPrefix)) return { ok: false, message: 'Identifiant iPhone invalide.' }
  return send(deviceId.slice(physicalPrefix.length), 'clear')
}

export async function shutdown() {
  const commands = []
  for (const [serial, session] of sessions) {
    if (session.ready && !session.child.killed) commands.push(send(serial, 'quit').catch(() => undefined))
    else session.child.kill('SIGTERM')
  }
  await Promise.all(commands)
}
