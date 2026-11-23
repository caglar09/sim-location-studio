import React from 'react'
import ReactDOM from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../src/renderer/styles.css'
import '../src/web/studio.css'
import App from '../src/web/App'
import { createWebBridge } from '../src/web/bridge'

let currentToken = localStorage.getItem('sim-location-token') || ''
window.simLocation = createWebBridge(() => currentToken)

function Root() {
  const [token, setToken] = React.useState(currentToken)
  const updateToken = React.useCallback((next: string) => {
    currentToken = next
    if (next) localStorage.setItem('sim-location-token', next)
    else localStorage.removeItem('sim-location-token')
    window.simLocation = createWebBridge(() => currentToken)
    setToken(next)
  }, [])
  return <App token={token} onTokenChange={updateToken} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Root /></React.StrictMode>)
