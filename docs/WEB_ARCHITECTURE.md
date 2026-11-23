# Web app architecture

The web interface is a separate browser client. The existing Electron desktop app remains in `src/renderer` and uses its original preload bridge.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/web/App.tsx` | Route planning screen, map actions, mode selection, preview playback controls |
| `src/web/studio.css` | Web app visual system, responsive layout, map overlays |
| `src/web/bridge.ts` | Browser implementation of the shared typed app bridge |
| `src/web/features/phone-control/` | TrollVNC/noVNC browser viewer and local connection preference; the VNC stream stays between the browser and iPhone |
| `src/renderer/components/MapCanvas.tsx` | MapLibre map, path and draggable endpoints |
| `server/index.mjs` | Authenticated API, geocoding, walking/driving and transit router clients, static production server |
| `scripts/dev-web.mjs` | Starts Vite HMR and the API server for development |

## Development and production

`npm run dev` starts Vite on port `4173` and the local API on `3101`. Vite proxies `/api` to the API server. Development binds the API to `127.0.0.1`; only the Vite server is exposed on the LAN. The API port can be changed with `SIM_LOCATION_API_PORT`. A random 192-bit bearer token is printed on startup and entered once in the browser. The browser stores it in local storage. A production run should set a stable private `SIM_LOCATION_TOKEN` and serve the application only over a trusted network or HTTPS reverse proxy.

`npm run build:web` writes the static client to `web-dist`. `npm run start:web` serves those files and the API from port `4173`. It accepts `HOST` and `PORT` environment variables.

### VM services

On the studio VM, `sim-location-web.service` runs Vite on LAN port `4173` and `sim-location-api.service` runs the API on loopback port `3101`. The API reads its stable settings from `/etc/sim-location-studio/api.env`. The `phone-vnc-forward.service` and `phone-vnc-rfb-forward.service` units provide the USB VNC relays. Systemd enables the four units at boot and restarts their processes after exit.

```sh
systemctl status sim-location-web.service sim-location-api.service phone-vnc-forward.service phone-vnc-rfb-forward.service
journalctl -u sim-location-api.service -u sim-location-web.service -n 50
```

Route jobs live in the API process. Stop a job before restarting that service. VNC requires the phone to be connected and TrollVNC to be running on iOS.

## API

Except for `GET /api/health`, every endpoint requires `Authorization: Bearer <SIM_LOCATION_TOKEN>`.

| Endpoint | Use |
| --- | --- |
| `GET /api/devices` | Lists trusted USB devices through the local `pymobiledevice3` bridge, or the configured agent |
| `GET /api/diagnostics` | Reports API, local/remote phone bridge, and train router availability |
| `GET /api/search?q=...` | Place search through OpenStreetMap Nominatim |
| `POST /api/routes` | Builds road/walk routes through Valhalla or transit through OTP |
| `POST /api/location/set` | Sends one coordinate to the location agent |
| `POST /api/location/clear` | Clears simulated location through the agent |

Route requests contain `{ points, mode, legModes, departureAt, stopDurationsMinutes, snapToRoads }`. The web UI sends the start, ordered stops, and destination, with a mode for each segment and a planned local departure time. Road/walk geometry comes from Valhalla. When OTP is configured, transit requests include the planned date/time and use its GTFS timetable; otherwise a train segment is a clearly marked direct-line estimate. Leg boundaries and segment schedules are returned so the UI can show expected departures, arrivals, and waits. Route geometry is rendered as a bright line with a dark casing for visibility.

Playback is a map-only preview. It samples the route by total distance, animates the cursor, supports pause/resume/stop, and waits at configured stops using the selected acceleration. It never calls the phone location endpoints, even when a USB iPhone is detected.

## Remote iPhone screen control

The phone panel runs noVNC inside the app. For the default USB connection, `/phone-vnc-ws` proxies to the relay on VM port `25902`, which forwards to TrollVNC's RFB port `5901`. Set `VITE_VNC_WS_TARGET` if the relay listens at another address. VM port `25801` forwards to the standalone viewer on the phone's HTTP port `5801`. Users can also enter the phone's LAN address with port `5801` to connect directly. The saved address lives in browser local storage. The VNC password is entered for each connection. The side button and Home send the middle and right RFB button presses that TrollVNC maps to iOS controls.

## Train itineraries

Exact train planning requires an OpenTripPlanner instance configured with transit timetable data. Set `OTP_BASE_URL` to its base URL. The server asks its OTP 1.x-compatible planning endpoint for `TRANSIT,WALK` itineraries at the planned time, then uses the returned duration and geometry. Without OTP/GTFS, the app still allows a multimodal preview but marks train geometry and timing as estimates. This repository does not bundle transit feeds; route coverage and timetables depend on the data configured in OTP.

## iPhone location agent contract

By default, the API uses the local `scripts/ios_device_bridge.py` helper and the project `.venv` Python interpreter to discover and control a trusted USB-connected iPhone. Install the pinned dependency with `python3 -m venv .venv && .venv/bin/pip install 'pymobiledevice3==11.12.4'`. Unlock the phone, accept the Trust prompt, and allow any required Developer Mode prompt. The bridge reads standard Lockdown metadata such as product model and iOS version; that metadata does not reveal whether the device is jailbroken.

Alternatively, set `LOCATION_AGENT_URL` to a trusted service reachable by the VM. The location agent must implement:

```text
GET  /devices
POST /location/set
POST /location/clear
```

`GET /devices` returns an array of shared `DeviceInfo` records. Set sends `{ deviceId, platform, point: { lat, lng } }`; clear sends `{ deviceId, platform }`. Both return `{ ok: boolean, message?: string }`.

The **Position GPS sur l’iPhone** controls in the planner send a point to the selected device over USB or clear that override. The bridge mounts the Developer Disk Image on iOS 16 and earlier as needed and uses the DVT tunnel on iOS 17 and later. Device discovery and route preview leave device location alone. The bridge clears the override on a clean shutdown.

The server only proxies the device bridge when `LOCATION_AGENT_URL` is explicitly set. Keep that endpoint on a trusted private network; add agent authentication when the concrete bridge is selected.

## Extending the playback model

Playback samples the routable geometry and updates the map cursor each second, with sample spacing derived from the itinerary duration and selected acceleration multiplier. At stop boundaries it waits for the configured dwell duration, respecting pause and stop controls. Itinerary speed estimates come from the routing provider. Playback acceleration changes elapsed wall-clock time.

The separate **Trajet sur l’iPhone** controls send these samples and their timing to `POST /api/location/route`. The server runs one job per iPhone, including planned stops and the stay at arrival. The browser reads the confirmed position and playback state from `GET /api/location/route?deviceId=…`. It requests the route geometry once per job using `includePath=1`. Pause holds the last position and resumes the remaining delay. A seek applies a selected sample and leaves the job paused, ready to continue at the following sample. Stop drains any in-flight write before clearing the override. The job continues across browser reloads and holds the destination after completion until the override is cleared.

On mobile, Accueil contains the planner, Trajet contains the map and playback controls, and Phone expands the VNC panel to fill the workspace. The route slider shows a proposed point until the user confirms or resumes from it.

Each iPhone run starts at 1×. Simulation speeds are configured in `src/shared/simulation-speeds.json`, with 40 km/h in town, 105 km/h on highways, and 98 km/h on rail. The route API accepts a `rate` action with 1, 2, or 4 for a running or paused job. This changes the rate of GPS updates and the duration of the remaining waits. The estimated total and remaining durations use the selected rate. The local preview has its own speed control. GTFS schedule data still determines the rail itinerary and connection times. Live route metrics include intermediate waits through arrival and exclude the stay after arrival. A paused route shows the ETA if resumed now.
