import { useEffect, useMemo, useState } from 'react'
import type { AppLogEntry, AppLogLevel } from '../../shared/types'

type Filter = 'all' | AppLogLevel

export default function LogPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const refresh = async () => {
      const next = await window.simLocation.getLogs()
      if (!cancelled) setLogs(next)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 800)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open])

  const visibleLogs = useMemo(
    () => filter === 'all' ? logs : logs.filter((entry) => entry.level === filter),
    [filter, logs]
  )

  if (!open) return null

  const clear = async () => {
    await window.simLocation.clearLogs()
    setLogs(await window.simLocation.getLogs())
  }

  return (
    <div className="log-panel">
      <div className="log-panel-head">
        <div><strong>Application logs</strong><span>{logs.length} entries · live</span></div>
        <div className="log-panel-actions">
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </select>
          <button onClick={clear}>Clear</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="log-list">
        {visibleLogs.length === 0 ? <div className="log-empty">No log entries for this filter.</div> : visibleLogs.map((entry) => (
          <div className={`log-entry ${entry.level}`} key={entry.id}>
            <span className="log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="log-level">{entry.level.toUpperCase()}</span>
            <span className="log-source">{entry.source}</span>
            <div className="log-message"><span>{entry.message}</span>{entry.detail && <pre>{entry.detail}</pre>}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
