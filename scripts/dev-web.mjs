import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const token = process.env.SIM_LOCATION_TOKEN || randomBytes(24).toString('base64url')
const apiPort = process.env.SIM_LOCATION_API_PORT || '3101'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = []

console.log(`\nSim Location Studio — access token\n${token}\n`)
console.log('Open http://localhost:4173 and enter the token above. For another device on your LAN, use the VM IP on port 4173.\n')

function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' })
  children.push(child)
  child.on('exit', (code) => {
    if (code && code !== 0) process.exitCode = code
    shutdown()
  })
}

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start(process.execPath, ['server/index.mjs'], { HOST: '127.0.0.1', PORT: apiPort, SIM_LOCATION_TOKEN: token })
start(npm, ['exec', '--', 'vite', '--config', 'vite.web.config.ts'], { VITE_API_TARGET: `http://127.0.0.1:${apiPort}` })
