# Architecture

Sim Location Studio deliberately separates four concerns:

```text
Renderer (React + MapLibre)
        |
        | IPC through context-isolated preload
        v
Electron main process
        |
        +-- Device discovery / diagnostics
        +-- Location providers
        +-- Network-backed route/search services
```

## Provider model

The first release implements two command-backed providers:

### iOS Simulator

- discovery: `xcrun simctl list devices available --json`
- set: `xcrun simctl location <UDID> set <lat>,<lng>`
- clear: `xcrun simctl location <UDID> clear`

### Android Emulator

- discovery: `adb devices -l`
- set: `adb -s <serial> emu geo fix <lng> <lat>`

The renderer only knows about normalized `DeviceInfo` records and invokes a platform-agnostic bridge.

## Why Electron?

The intended product surface is broader than macOS-only simulator control. Electron keeps the map and scenario tooling portable to macOS, Windows and Linux while the command providers stay platform-aware.

## Security model

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- renderer receives a narrow typed preload API
- external links are opened in the system browser
- command execution uses `execFile` with argument arrays instead of shell command strings

## Route engine

The renderer owns playback timing and interpolation. Providers only perform a single location mutation. This makes movement behavior reusable for every future target.

Potential future route behaviors:

- acceleration/deceleration curves
- random GPS accuracy/jitter
- dwell time at waypoints
- route reversal / ping-pong
- scripted geofence crossings
- network-condition hooks

## Future Android physical-device support

A physical Android device should not be treated like the emulator. A robust approach is a small companion Android mock-location provider app using Android's developer mock-location APIs. Sim Location Studio can then control that companion over ADB, WebSocket or a local protocol.

## Future headless mode

The same provider and route abstractions can be exposed through a CLI:

```text
sim-location devices
sim-location set --device ... --lat ... --lng ...
sim-location play route.json --device ...
```

That would enable Detox/Maestro/Appium/E2E pipelines to reuse scenarios created visually in the desktop app.
