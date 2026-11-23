import { randomUUID } from 'node:crypto'

const MAX_STEPS = 24_000
const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000
const PLAYBACK_RATES = [1, 2, 4]
const isDelay = (value) => Number.isInteger(value) && value >= 0 && value <= MAX_WAIT_MS

function reject(status, message) {
  throw Object.assign(new Error(message), { status })
}

function validStep(step) {
  if (!Array.isArray(step) || step.length !== 3) return false
  const [lat, lng, delay] = step
  return Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    Number.isFinite(lng) && Math.abs(lng) <= 180 && isDelay(delay)
}

function stepDistance([lat, lng], [nextLat, nextLng]) {
  const toRadians = Math.PI / 180
  const latDelta = (nextLat - lat) * toRadians
  const lngDelta = (nextLng - lng) * toRadians
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat * toRadians) * Math.cos(nextLat * toRadians) * Math.sin(lngDelta / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

function routeTotals(steps) {
  const msAfter = new Float64Array(steps.length)
  const metersAfter = new Float64Array(steps.length)
  for (let index = steps.length - 2; index >= 0; index--) {
    msAfter[index] = msAfter[index + 1] + steps[index + 1][2]
    metersAfter[index] = metersAfter[index + 1] + stepDistance(steps[index], steps[index + 1])
  }
  return { totalMs: steps[0][2] + msAfter[0], msAfter, metersAfter }
}

// Measure elapsed playback in the same units as the submitted 1× step delays.
function playedMs(job) {
  if (job.playingSince === undefined) return job.playedMs
  return job.playedMs + (performance.now() - job.playingSince) * job.rate
}

function freezeClock(job) {
  job.playedMs = playedMs(job)
  job.playingSince = undefined
}

function changeState(job, state) {
  freezeClock(job)
  job.state = state
  if (state === 'running') job.playingSince = performance.now()
}

function routeMetrics(job) {
  const countdown = job.countdown
  const elapsed = countdown ? Math.min(countdown.duration, playedMs(job) - countdown.started) : 0
  const remainingMs = Math.round(Math.max(0, job.remainingMs - elapsed) / job.rate)
  const index = job.completed ? job.completed - 1 : job.startIndex
  const estimating = job.state === 'running' || job.state === 'paused'
  return {
    totalMs: Math.round(job.totalMs / job.rate),
    remainingMs,
    remainingMeters: job.metersAfter[index],
    arrivalAt: job.arrivedAt ?? (estimating ? new Date(Date.now() + remainingMs).toISOString() : undefined)
  }
}

function confirmPoint(job, index) {
  job.completed = index + 1
  job.remainingMs = job.msAfter[index]
  job.arrivedAt = index === job.steps.length - 1 ? new Date().toISOString() : undefined
}

export function createPhoneRoutes({ writeLocation, readLocation }) {
  const jobs = new Map()
  const manualWrites = new Set()

  function status(deviceId, includePath = false) {
    const job = jobs.get(deviceId)
    return {
      id: job?.id,
      rate: job?.rate,
      state: job?.state ?? 'idle',
      completed: job?.completed ?? 0,
      total: job?.steps.length ?? 0,
      point: readLocation(deviceId),
      error: job?.error,
      metrics: job ? routeMetrics(job) : undefined,
      path: includePath && job ? job.steps.map(([lat, lng]) => ({ lat, lng })) : undefined
    }
  }

  function isBusy(deviceId) {
    return ['running', 'paused', 'stopping'].includes(jobs.get(deviceId)?.state)
  }

  async function write(deviceId, platform, point) {
    const { status, result } = await writeLocation(deviceId, platform, point)
    if (status < 200 || status >= 300 || !result?.ok) throw new Error(result?.message || 'L’iPhone a refusé la commande GPS.')
  }

  function sleep(job, milliseconds, onWake) {
    return new Promise((resolve) => {
      const timer = milliseconds === undefined ? undefined : setTimeout(wake, milliseconds)
      job.wake = wake
      function wake() {
        clearTimeout(timer)
        job.wake = undefined
        onWake?.()
        resolve()
      }
    })
  }

  async function wait(job, milliseconds, signal, onReady, msAfter) {
    let remaining = milliseconds
    const affectsArrival = msAfter !== undefined
    if (affectsArrival) job.remainingMs = remaining + msAfter
    while (job.state !== 'stopping' && !signal.aborted) {
      if (job.state === 'paused') {
        await sleep(job)
        continue
      }
      if (remaining <= 0) {
        onReady()
        return true
      }
      const started = playedMs(job)
      if (affectsArrival) job.countdown = { started, duration: remaining }
      await sleep(job, remaining / job.rate, () => {
        remaining = Math.max(0, remaining - (playedMs(job) - started))
        if (affectsArrival) {
          job.countdown = undefined
          job.remainingMs = remaining + msAfter
        }
      })
    }
    return false
  }

  async function run(job, startIndex, skipInitialDelay, signal) {
    try {
      let previousWriteMs = 0
      for (let index = startIndex; index < job.steps.length; index++) {
        const [lat, lng, delay] = job.steps[index]
        const waitMs = skipInitialDelay && index === startIndex ? 0 : Math.max(0, delay - previousWriteMs)
        let writeStartedAt = 0
        if (!await wait(job, waitMs, signal, () => {
          writeStartedAt = playedMs(job)
          job.inFlight = write(job.deviceId, job.platform, { lat, lng })
        }, job.msAfter[index])) return
        await job.inFlight
        previousWriteMs = playedMs(job) - writeStartedAt
        job.inFlight = undefined
        confirmPoint(job, index)
      }
      await wait(job, job.endWaitMs, signal, () => changeState(job, 'finished'))
    } catch (error) {
      if (job.state !== 'stopping' && !signal.aborted) {
        changeState(job, 'failed')
        job.error = error.message
      }
    } finally {
      job.inFlight = undefined
    }
  }

  function playFrom(job, index, skipInitialDelay = false) {
    job.playback = new AbortController()
    job.running = run(job, index, skipInitialDelay, job.playback.signal)
  }

  async function seek(job, index) {
    changeState(job, 'paused')
    job.playback.abort()
    job.wake?.()
    await job.running
    if (job.state === 'stopping') return
    try {
      const [lat, lng] = job.steps[index]
      await write(job.deviceId, job.platform, { lat, lng })
      confirmPoint(job, index)
      if (job.state !== 'stopping') playFrom(job, index + 1)
    } catch (error) {
      if (job.state !== 'stopping') {
        changeState(job, 'failed')
        job.error = error.message
      }
    }
  }

  async function command({ action, deviceId, platform, steps, endWaitMs = 0, index, rate }) {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 150) reject(400, 'Sélectionne un iPhone.')
    const job = jobs.get(deviceId)
    if (action === 'start') {
      if (isBusy(deviceId) || manualWrites.has(deviceId)) reject(409, 'Une commande GPS est déjà en cours sur cet iPhone.')
      if (platform !== 'ios' || !Array.isArray(steps) || steps.length < 2 ||
          steps.length > MAX_STEPS || !steps.every((step, index) => validStep(step) && (index === 0 || step[2] >= 250)) || !isDelay(endWaitMs)) {
        reject(400, 'Le trajet GPS est invalide ou dépasse la durée prise en charge à cette vitesse.')
      }
      if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= steps.length)) {
        reject(400, 'Choisis un point valide sur le trajet.')
      }
      const startIndex = index ?? 0
      const next = { id: randomUUID(), deviceId, platform, rate: 1, playedMs: 0, completed: 0, steps, endWaitMs, startIndex, ...routeTotals(steps) }
      changeState(next, 'running')
      jobs.set(deviceId, next)
      playFrom(next, startIndex, index !== undefined)
    } else if (action === 'pause' && job?.state === 'running') {
      changeState(job, 'paused')
      job.wake?.()
      // A location write that has already started is allowed to finish before
      // the pause is confirmed.
      await job.inFlight?.catch(() => undefined)
    } else if (action === 'resume' && job?.state === 'paused' && !job.seeking) {
      changeState(job, 'running')
      job.wake?.()
    } else if (action === 'rate' && (job?.state === 'running' || job?.state === 'paused')) {
      if (!PLAYBACK_RATES.includes(rate)) reject(400, 'Choisis une vitesse de 1×, 2× ou 4×.')
      if (rate !== job.rate) {
        const running = job.state === 'running'
        freezeClock(job)
        // Settle the current timer at the old rate before scheduling what remains.
        if (running) job.wake?.()
        job.rate = rate
        if (running) job.playingSince = performance.now()
      }
    } else if (action === 'seek' && ['running', 'paused', 'finished'].includes(job?.state)) {
      if (job.seeking) reject(409, 'Un déplacement est déjà en cours sur ce trajet.')
      if (!Number.isInteger(index) || index < 0 || index >= job.steps.length) {
        reject(400, 'Choisis un point valide sur le trajet.')
      }
      job.seeking = seek(job, index)
      try {
        await job.seeking
      } finally {
        job.seeking = undefined
      }
    } else if (action === 'stop' && job) {
      if (manualWrites.has(deviceId)) reject(409, 'Une commande GPS est déjà en cours sur cet iPhone.')
      if (job.state !== 'stopping') {
        changeState(job, 'stopping')
        job.wake?.()
        job.stopping = (async () => {
          await job.seeking
          await job.running
          try {
            await write(deviceId, job.platform)
            jobs.delete(deviceId)
          } catch (error) {
            changeState(job, 'failed')
            job.error = error.message
          }
        })()
      }
      await job.stopping
    } else {
      reject(409, 'Cette commande ne correspond plus à l’état du trajet.')
    }
    return status(deviceId)
  }

  async function manual(deviceId, platform, point) {
    if (isBusy(deviceId) || manualWrites.has(deviceId)) reject(409, 'Arrête le trajet de l’iPhone avant de régler sa position manuellement.')
    manualWrites.add(deviceId)
    try {
      const response = await writeLocation(deviceId, platform, point)
      if (response.result.ok) jobs.delete(deviceId)
      return response
    } finally {
      manualWrites.delete(deviceId)
    }
  }

  async function stopAll() {
    await Promise.allSettled([...jobs].filter(([id]) => isBusy(id) || readLocation(id)).map(([deviceId]) => command({ action: 'stop', deviceId })))
  }

  return { command, manual, status, stopAll }
}
