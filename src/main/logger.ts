import type { AppLogEntry, AppLogLevel } from '../shared/types'

const MAX_LOGS = 800
const logs: AppLogEntry[] = []
let sequence = 0

function stringifyDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null || detail === '') return undefined
  if (detail instanceof Error) return detail.stack || detail.message
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

export function addLog(level: AppLogLevel, source: string, message: string, detail?: unknown): AppLogEntry {
  const entry: AppLogEntry = {
    id: ++sequence,
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    detail: stringifyDetail(detail)
  }

  logs.push(entry)
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)

  const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${source}]`
  if (level === 'error') console.error(prefix, message, entry.detail || '')
  else if (level === 'warn') console.warn(prefix, message, entry.detail || '')
  else console.log(prefix, message, entry.detail || '')

  return entry
}

export function getLogs(): AppLogEntry[] {
  return [...logs].reverse()
}

export function clearLogs(): void {
  logs.length = 0
  addLog('info', 'app', 'Log history cleared')
}
