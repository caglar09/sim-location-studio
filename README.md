# Sim Location Studio

A developer-focused desktop app for visually simulating GPS/location on **iOS Simulator, Android Emulator, physical iPhone/iPad, and physical Android devices**.

Instead of manually juggling `simctl`, `adb`, mock-location apps, and physical-device tooling, Sim Location Studio provides one interactive map, route editor, device selector, diagnostics panel, and playback engine for location-based application testing.

## Highlights

- 🗺️ Interactive OpenStreetMap / MapLibre map
- 🍎 iOS Simulator discovery through `xcrun simctl`
- 📱 Physical iPhone/iPad support through the bundled `pymobiledevice3` bridge
- 🤖 Android Emulator discovery and injection through `adb`
- 📱 Physical Android support through the Sim Location Companion mock-location app
- 📍 One-click teleport to any coordinate
- 🚶 Walking, 🚲 cycling, 🚗 driving and custom speed profiles
- 🛣️ Real routable pedestrian / bicycle / driving paths through Valhalla
- ▶ Route playback with pause, resume, stop, reverse and loop
- 🧷 Draggable numbered waypoints
- 🔎 Place/address search via OpenStreetMap Nominatim
- ⭐ Favorite test locations
- 💾 Route import/export as JSON and GPX
- 🧪 Environment diagnostics for Xcode, simctl, ADB and the physical-iOS bridge
- 🖥️ macOS, Windows and Linux desktop builds
- 🧱 Provider-oriented architecture for adding new location backends

## Supported targets

| Target | Discover | Set location | Clear location | Provider |
| --- | --- | --- | --- | --- |
| iOS Simulator | ✅ | ✅ | ✅ | `ios-simctl` |
| Android Emulator | ✅ | ✅ | ⚠️ Last injected coordinate remains until replaced/restarted | `android-emulator` |
| Physical iPhone / iPad on macOS | ✅ | ✅ | ✅ | `ios-pymobiledevice3` |
| Physical iPhone / iPad on Windows | ✅ | ✅ | ✅ | `ios-pymobiledevice3` |
| Physical Android | ✅ | ✅ | ✅ | `android-companion` |

> Physical-device support is intended for development and QA. Sim Location Studio does not root or jailbreak the target device.

## Requirements

### macOS + iOS Simulator

- Xcode / Xcode Command Line Tools
- A booted iOS Simulator

The app uses Apple's simulator CLI:

```bash
xcrun simctl location <UDID> set <latitude>,<longitude>
xcrun simctl location <UDID> clear
```

### Android Emulator

- Android SDK Platform Tools (`adb` available on `PATH`)
- A running Android Emulator

The app injects emulator coordinates with:

```bash
adb -s emulator-5554 emu geo fix <longitude> <latitude>
```

### Physical iPhone / iPad — macOS

Release DMGs include a **self-contained physical-iOS bridge**. End users do **not** need to install Python, pip, Homebrew or `pymobiledevice3`.

Requirements:

1. Connect the iPhone/iPad over USB.
2. Unlock the device and accept **Trust This Computer**.
3. Enable **Developer Mode** when required by the iOS version.
4. Open Sim Location Studio and click **Refresh devices**.

The packaged app keeps a persistent DVT/CoreDevice location session open while route playback is running.

### Physical iPhone / iPad — Windows

Windows release builds also contain a self-contained `ios-device-bridge.exe`; Python and `pymobiledevice3` are not required on the end-user machine.

Windows still needs Apple's official device/USB stack:

1. Install **Apple Devices** (preferred on current Windows) or an Apple iTunes distribution that includes **Apple Mobile Device Support**.
2. Connect the iPhone over USB.
3. Accept **Trust This Computer**.
4. Enable Developer Mode when required.
5. Open Sim Location Studio and refresh devices.

If Apple's device service is unavailable, the Diagnostics panel reports the physical-iOS bridge as unavailable and shows the setup hint.

### Physical Android

Physical Android devices use the companion app under `android-companion/`.

1. Enable Developer options.
2. Enable USB debugging.
3. Install the **Sim Location Companion** APK.
4. Open **Developer options → Select mock location app**.
5. Select **Sim Location Companion**.
6. Connect the device over ADB and refresh devices.

GitHub Actions builds the companion APK as the `sim-location-companion-android` artifact.

See [docs/PHYSICAL_DEVICES.md](docs/PHYSICAL_DEVICES.md) for detailed setup and troubleshooting.

## Development

```bash
git clone https://github.com/caglar09/sim-location-studio.git
cd sim-location-studio
npm install
npm run dev
```

Source-mode physical iPhone development uses your local Python environment:

```bash
python3 -m pip install -U pymobiledevice3
```

Build production assets:

```bash
npm run build
```

Build a self-contained macOS distributable:

```bash
npm run dist:mac
```

Build a self-contained Windows distributable:

```powershell
npm run dist:win
```

Both release builds freeze the physical-iOS bridge with PyInstaller and bundle it with the Electron application. Python is required only on the **build machine**, not on the end-user machine.

## How route playback works

1. Select a simulator, emulator, or configured physical device.
2. Switch to **Draw route**.
3. Click multiple waypoints on the map.
4. Choose Walk / Bike / Drive / Custom.
5. Leave **Follow routable paths** enabled to use the appropriate routing profile.
6. Click **Build**, then **Play**.
7. Sim Location Studio interpolates the returned path and continuously injects coordinates into the selected target.

Routing profiles:

| Mode | Valhalla costing |
| --- | --- |
| Walk | `pedestrian` |
| Bike | `bicycle` |
| Drive | `auto` |
| Custom | `auto` route geometry + custom playback speed |

If the routing service cannot produce a path, Sim Location Studio falls back to the manually drawn waypoint line and displays a warning.

## Network services

The current UI uses public community services for convenience:

- OpenStreetMap map tiles
- Nominatim place search
- Valhalla public routing service for pedestrian / bicycle / driving paths

These endpoints are not intended for high-volume production use. Teams that need guaranteed availability should configure or self-host their own map, geocoding and routing infrastructure.

## Physical-device architecture

```text
Sim Location Studio
├── iOS Simulator
│   └── xcrun simctl
├── Physical iPhone / iPad
│   └── bundled ios-device-bridge
│       └── pymobiledevice3 / DVT / CoreDevice
├── Android Emulator
│   └── adb emu geo fix
└── Physical Android
    └── ADB
        └── Sim Location Companion
            └── Android Mock Location API
```

The physical-iOS bridge is packaged as a separate helper process. macOS ships `ios-device-bridge`; Windows ships `ios-device-bridge.exe`.

## Roadmap

- Speed curves / acceleration simulation
- GPS jitter and configurable accuracy degradation
- Geofence scenario runner
- Configurable/self-hosted map, geocoder and router providers
- Multi-device synchronized playback
- CLI / headless mode for CI and automated E2E tests
- Recorded scenario assertions / hooks
- Release signing and notarization automation
- In-app Android Companion installation workflow

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the extension model.

## Responsible use

This project is designed for application development, QA and automated testing. A simulated coordinate can affect apps running on the selected simulator, emulator, or configured physical device.

## Third-party notices

The desktop application is MIT licensed. macOS and Windows releases bundle a separate physical-iOS helper that includes `pymobiledevice3`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled component notices.

## License

MIT
