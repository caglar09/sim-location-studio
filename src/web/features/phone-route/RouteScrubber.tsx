import type { CSSProperties } from 'react'
import './route-scrubber.css'

type RouteScrubberProps = {
  value: number
  total: number
  disabled?: boolean
  dirty?: boolean
  stats?: { total: string; remaining: string; distance: string; arrival: string; arrivalLabel?: string }
  playbackRate?: { value: number; disabled?: boolean; onChange: (rate: number) => void }
  onChange: (index: number) => void
  onCommit?: () => void
}

export default function RouteScrubber({ value, total, disabled, dirty, stats, playbackRate, onChange, onCommit }: RouteScrubberProps) {
  const lastIndex = Math.max(0, total - 1)
  const index = Math.min(lastIndex, Math.max(0, value))
  const percent = lastIndex ? Math.round(index / lastIndex * 100) : 0
  const unavailable = disabled || !lastIndex
  const valueText = index === 0 ? 'Départ' : index === lastIndex ? 'Arrivée' : `${percent} % du trajet`

  return (
    <div className="route-scrubber" style={{ '--route-scrub-progress': `${percent}%` } as CSSProperties}>
      <div className="route-scrubber-heading">
        <span>Position sur le trajet <b aria-hidden="true">{percent} %</b></span>
        {dirty && onCommit && (
          <button type="button" className="route-scrubber-commit" disabled={unavailable} onClick={onCommit}>
            Aller à ce point
          </button>
        )}
      </div>
      {stats && (
        <dl className="route-scrubber-stats">
          <div><dt>Durée totale</dt><dd>{stats.total}</dd></div>
          <div><dt>Temps restant</dt><dd>{stats.remaining}</dd></div>
          <div><dt>Distance restante</dt><dd>{stats.distance}</dd></div>
          <div><dt>{stats.arrivalLabel || 'Arrivée prévue'}</dt><dd>{stats.arrival}</dd></div>
        </dl>
      )}
      <input
        type="range"
        min={0}
        max={lastIndex || 1}
        step={1}
        value={index}
        disabled={unavailable}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-label="Position sur le trajet"
        aria-valuetext={valueText}
      />
      <div className="route-scrubber-ends" aria-hidden="true"><span>Départ</span><span>Arrivée</span></div>
      {playbackRate && (
        <label className="route-scrubber-rate">
          <span>Vitesse sur l’iPhone</span>
          <select
            value={playbackRate.value}
            disabled={playbackRate.disabled}
            onChange={(event) => playbackRate.onChange(Number(event.currentTarget.value))}
            aria-label="Vitesse du trajet sur l’iPhone"
          >
            <option value={1}>1× · Temps réel</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
      )}
    </div>
  )
}
