# Sim Location Studio

A developer-focused desktop app for visually simulating location on **iOS Simulator** and **Android Emulator**.

Instead of manually typing `simctl` / `adb` commands, Sim Location Studio gives you an interactive map, route editor and playback controls for realistic location-based app testing.

## Highlights

- 🗺️ Interactive OpenStreetMap / MapLibre map
- 🍎 iOS Simulator discovery through `xcrun simctl`
- 🤖 Android Emulator discovery through `adb`
- 📍 One-click teleport to any coordinate
- 🚶 Walking, 🚲 cycling, 🚗 driving and custom speed profiles
- ▶ Route playback with pause, resume, stop and loop
- 🛣️ Optional road snapping for driving routes (OSRM)
- 🔎 Place/address search via OpenStreetMap Nominatim
- ⭐ Favorite test locations
- 💾 Route import/export as JSON and GPX
- 🧪 Environment diagnostics for Xcode / simctl / ADB
- 🧱 Provider-oriented architecture designed for future platforms and physical-device strategies

## Supported targets

| Target | Discover | Set location | Clear location |
| --- | --- | --- | --- |
| iOS Simulator | ✅ | ✅ | ✅ |
| Android Emulator | ✅ | ✅ | ⚠️ Last injected coordinate remains until replaced/restarted |
| Physical iPhone/iPad | ❌ | ❌ | ❌ |
| Physical Android | 👀 visible via ADB | ❌ direct injection | ❌ |

Physical Android is intentionally not spoofed directly because Android requires an approved mock-location app/provider. The architecture leaves room for a companion provider later.

## Requirements

### macOS + iOS Simulator

- Xcode / Xcode Command Line Tools
- A booted iOS Simulator

The app executes Apple's official simulator CLI:

```bash
xcrun simctl location <UDID> set <latitude>,<longitude>
xcrun simctl location <UDID> clear
```

### Android Emulator

- Android SDK Platform Tools (`adb` available on `PATH`)
- A running Android Emulator

The app injects coordinates with:

```bash
adb -s emulator-5554 emu geo fix <longitude> <latitude>
```

## Development

```bash
git clone https://github.com/caglar09/sim-location-studio.git
cd sim-location-studio
npm install
npm run dev
```

Build production assets:

```bash
npm run build
```

Build a macOS distributable:

```bash
npm run dist:mac
```

## How route playback works

1. Select a simulator/emulator.
2. Switch to **Draw route**.
3. Click points on the map.
4. Choose Walk / Bike / Drive / Custom.
5. Optionally use road snapping for driving.
6. Click **Build**, then **Play**.
7. Sim Location Studio interpolates the route and continuously injects coordinates at a cadence derived from the selected speed.

## Network services

The current UI uses public community services for convenience:

- OpenStreetMap raster tiles
- Nominatim place search
- OSRM demo server for optional driving-route snapping

These endpoints are not intended for high-volume production use. A future version should expose configurable tile/geocoder/router providers for teams that need guaranteed availability or self-hosted infrastructure.

## Roadmap

- Drag-and-drop waypoint editing
- Route presets and test suites
- Speed curves / acceleration simulation
- GPS jitter and low-accuracy simulation
- Geofence scenario runner
- Configurable map/geocoder/router providers
- Android companion mock-location app for physical devices
- Multi-device synchronized playback
- CLI / headless mode for CI and automated E2E tests
- Recorded scenario files with assertions/hooks
- Release signing/notarization automation

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the extension model.

## Responsible use

This project is designed for application development, QA and automated testing. A simulated coordinate is visible to apps running inside the selected simulator/emulator, not just your own app.

## License

MIT
