import { useEffect, useRef, useState, type FormEvent } from 'react'
import type RFB from '@novnc/novnc'
import './phone-control.css'

const HOST_KEY = 'sim-location-vnc-host'
const DEFAULT_RELAY = `http://${window.location.hostname}:25801`
const BUTTON_MASK = { power: 2, home: 4 } as const

type PhoneButton = keyof typeof BUTTON_MASK
type Connection = { socketUrl: string; viewerUrl: string }
type Phase = 'connecting' | 'password' | 'connected' | 'failed'

function initialHost() {
  try { return localStorage.getItem(HOST_KEY) || DEFAULT_RELAY }
  catch { return DEFAULT_RELAY }
}

function makeConnection(value: string): Connection {
  const address = value.trim()
  if (!address) throw new Error('Saisis l’adresse de TrollVNC sur le réseau local.')
  const base = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : `http://${address}`)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Utilise une adresse HTTP(S) sans identifiant.')
  }
  const localRelay = base.origin === DEFAULT_RELAY
  if (!base.port && base.protocol === 'http:') base.port = '5801'
  const rfbPort = localRelay ? '25902' : base.port === '5801' ? '5901' : base.port
  const socket = new URL('/websockify', base)
  socket.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  socket.port = rfbPort
  const proxy = new URL('/phone-vnc-ws', window.location.origin)
  proxy.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

  const viewer = new URL('/novnc/vnc.html', base)
  viewer.searchParams.set('autoconnect', 'true')
  viewer.searchParams.set('host', base.hostname)
  viewer.searchParams.set('port', rfbPort || '443')
  viewer.searchParams.set('path', 'websockify')
  viewer.searchParams.set('resize', 'scale')
  return { socketUrl: (localRelay ? proxy : socket).href, viewerUrl: viewer.href }
}

function PhoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/></svg>
}

function ControlIcon({ name }: { name: 'power' | 'home' | 'external' | 'settings' | 'close' }) {
  const paths = {
    power: 'M12 3v9m5.3-6.4a8 8 0 1 1-10.6 0',
    home: 'm3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 21v-7h6v7',
    external: 'M14 3h7v7m0-7-10 10m8 0v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6',
    settings: 'M3 6h7m4 0h7M3 12h12m4 0h2M3 18h3m4 0h11M10 4v4m5 2v4m-9 2v4',
    close: 'm6 6 12 12M6 18 18 6'
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>
}

export default function PhoneControlPanel({ open, onClose, deviceName }: { open: boolean; onClose: () => void; deviceName?: string }) {
  const [host, setHost] = useState(initialHost)
  const [connection, setConnection] = useState(() => {
    try { return makeConnection(host) } catch { return null }
  })
  const [phase, setPhase] = useState<Phase>('connecting')
  const [addressError, setAddressError] = useState('')
  const [streamError, setStreamError] = useState('')
  const [command, setCommand] = useState<PhoneButton | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(!connection)
  const displayRef = useRef<HTMLDivElement>(null)
  const clientRef = useRef<RFB | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const pressTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const display = displayRef.current
    if (!open || !connection || !display) return
    let active = true
    let client: RFB | undefined
    let socket: WebSocket | undefined
    let timeout: number | undefined
    let authRejected = false
    setPhase('connecting')
    setStreamError('')
    setCommand(null)

    function fail(message: string) {
      if (!active) return
      window.clearTimeout(timeout)
      setStreamError(message)
      setPhase('failed')
    }

    timeout = window.setTimeout(() => {
      fail('TrollVNC ne répond pas. Vérifie le relais USB, puis réessaie.')
      client?.disconnect()
    }, 12000)

    void import('@novnc/novnc').then(({ default: VncClient }) => {
      if (!active) return
      socket = new WebSocket(connection.socketUrl, ['binary'])
      client = new VncClient(display, socket)
      socketRef.current = socket
      clientRef.current = client
      client.scaleViewport = true
      client.addEventListener('connect', () => {
        if (!active) return
        window.clearTimeout(timeout)
        setPhase('connected')
      })
      client.addEventListener('credentialsrequired', () => {
        if (!active) return
        window.clearTimeout(timeout)
        setPhase('password')
      })
      client.addEventListener('securityfailure', () => {
        authRejected = true
        fail('TrollVNC a refusé l’authentification. Vérifie le mot de passe VNC.')
      })
      client.addEventListener('disconnect', () => {
        if (!authRejected) fail('Connexion VNC interrompue. Vérifie le relais USB, puis réessaie.')
      })
    }).catch(() => {
      socket?.close()
      fail('Impossible de démarrer le contrôle VNC.')
    })

    return () => {
      active = false
      window.clearTimeout(timeout)
      if (pressTimer.current !== undefined) {
        window.clearTimeout(pressTimer.current)
        pressTimer.current = undefined
        if (socket?.readyState === WebSocket.OPEN) sendPointerMask(socket, 0)
      }
      clientRef.current = null
      socketRef.current = null
      client?.disconnect()
    }
  }, [open, connection])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (settingsOpen) setSettingsOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, settingsOpen])

  function reconnect(event?: FormEvent) {
    event?.preventDefault()
    try {
      setConnection(makeConnection(host))
      setAddressError('')
      setSettingsOpen(false)
      try { localStorage.setItem(HOST_KEY, host.trim()) } catch {}
    } catch (cause) {
      setAddressError(cause instanceof Error ? cause.message : 'Adresse TrollVNC invalide.')
    }
  }

  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = new FormData(event.currentTarget).get('password')
    if (typeof password !== 'string' || !password) return
    clientRef.current?.sendCredentials({ password, username: '', target: '' })
  }

  function pressButton(button: PhoneButton) {
    const socket = socketRef.current
    if (phase !== 'connected' || socket?.readyState !== WebSocket.OPEN || pressTimer.current !== undefined) return
    setCommand(button)
    sendPointerMask(socket, BUTTON_MASK[button])
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = undefined
      if (socket.readyState === WebSocket.OPEN) sendPointerMask(socket, 0)
      setCommand(null)
    }, 65)
  }

  if (!open) return null

  return <aside className="phone-control-drawer" id="phone-control-drawer" aria-label="Contrôle du téléphone">
    <header className="phone-drawer-header">
      <div className="phone-drawer-title"><span className="phone-drawer-icon"><PhoneIcon /></span><div><h2>Téléphone</h2><p>{deviceName || 'Contrôle distant via TrollVNC'}</p></div></div>
      <div className="phone-drawer-header-actions">
        {connection && <a className="phone-header-action" href={connection.viewerUrl} target="_blank" rel="noreferrer" aria-label="Ouvrir dans un nouvel onglet" title="Ouvrir dans un nouvel onglet"><ControlIcon name="external" /></a>}
        <button type="button" className="phone-header-action" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen} aria-controls="phone-vnc-settings" aria-label="Réglages VNC" title="Réglages VNC"><ControlIcon name="settings" /></button>
        <button type="button" className="phone-header-action" onClick={onClose} aria-label="Fermer le panneau du téléphone" title="Fermer le panneau"><ControlIcon name="close" /></button>
      </div>
    </header>
    {settingsOpen && <form id="phone-vnc-settings" className="phone-control-connect phone-vnc-settings" onSubmit={reconnect}>
      <label htmlFor="phone-vnc-address">Adresse TrollVNC ou relais USB</label>
      <input id="phone-vnc-address" type="text" inputMode="url" autoComplete="url" spellCheck={false} value={host} onChange={(event) => { setHost(event.target.value); setAddressError('') }} placeholder={DEFAULT_RELAY} />
      {addressError && <p className="phone-control-error" role="alert">{addressError}</p>}
      <button className="button-primary" type="submit">Reconnecter</button>
    </form>}
    <div className="phone-drawer-screen">
      <div ref={displayRef} className="phone-vnc-display" aria-label="Écran de l’iPhone" />
      {(!connection || phase !== 'connected') && <div className="phone-drawer-error">
        <PhoneIcon />
        {!connection ? <b>Configure l’adresse TrollVNC ci-dessous</b> : phase === 'password' ? <form className="phone-control-connect phone-vnc-auth" onSubmit={authenticate}>
          <label htmlFor="phone-vnc-password">Mot de passe VNC</label>
          <input id="phone-vnc-password" name="password" type="password" autoComplete="current-password" required />
          <button className="button-primary" type="submit">Connecter</button>
        </form> : phase === 'failed' ? <>
          <span role="alert">{streamError}</span>
          <button className="button-primary" type="button" onClick={() => reconnect()}>Réessayer</button>
        </> : <b role="status">Connexion à l’iPhone…</b>}
      </div>}
    </div>
    <footer className="phone-drawer-footer">
      <div className="phone-drawer-tools">
        <button type="button" className="phone-drawer-action" disabled={phase !== 'connected' || command !== null} onClick={() => pressButton('power')} title="Appui bref sur le bouton latéral"><ControlIcon name="power" /><b>Bouton latéral</b></button>
        <button type="button" className="phone-drawer-action" disabled={phase !== 'connected' || command !== null} onClick={() => pressButton('home')} title="Revenir à l’accueil de l’iPhone"><ControlIcon name="home" /><b>Accueil</b></button>
      </div>
    </footer>
  </aside>
}

function sendPointerMask(socket: WebSocket, mask: number) {
  // RFB PointerEvent with zero coordinates. TrollVNC interprets the middle
  // and right button edges as hardware button presses, independent of position.
  socket.send(new Uint8Array([5, mask, 0, 0, 0, 0]))
}
