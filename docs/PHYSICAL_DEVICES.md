# Physical device setup

## iOS / iPadOS

Requirements:

- macOS is the primary supported host for physical iOS testing.
- Python 3.9 or newer.
- `pymobiledevice3`.
- The iPhone/iPad must trust the computer.
- Developer Mode must be enabled for iOS 17+.

Install:

```bash
python3 -m pip install -U pymobiledevice3
pymobiledevice3 usbmux list
```

When a physical iOS device appears in `usbmux list`, refresh Sim Location Studio. It will appear as a **physical** iOS target using the `ios-pymobiledevice3` provider.

Sim Location Studio starts a persistent Python bridge for the selected device. On iOS 17+ the bridge uses a no-root RSD tunnel and DVT LocationSimulation. On older systems it uses the legacy simulate-location developer service.

The bridge stays open while coordinates are streamed, so Teleport and route playback can send frequent position updates without launching a new Python process for every point.

### Troubleshooting

If the device is not listed:

```bash
pymobiledevice3 usbmux list
```

If it is listed but location injection fails:

- unlock the phone;
- confirm **Trust This Computer**;
- enable **Settings → Privacy & Security → Developer Mode**;
- update pymobiledevice3;
- disconnect/reconnect USB and refresh devices.

## Android physical devices

Physical Android devices use the companion app under `android-companion/`.

GitHub Actions builds a debug APK named **sim-location-companion-android**.

After installing the APK:

1. Enable Developer options.
2. Enable USB debugging.
3. Open **Developer options → Select mock location app**.
4. Select **Sim Location Companion**.
5. Connect the device over ADB.
6. Refresh Sim Location Studio.

Check the connection:

```bash
adb devices -l
adb shell pm path dev.simlocation.companion
adb shell appops get dev.simlocation.companion android:mock_location
```

When setup is complete the device becomes selectable with provider `android-companion`.

The desktop app sends coordinates through an ADB broadcast that is protected with the Android `DUMP` sender permission, so ordinary third-party apps cannot issue the same exported receiver commands.

## Security and scope

Physical-device location simulation is intended for development and QA. Sim Location Studio does not root, jailbreak, or permanently modify the target device. Clearing location simulation restores normal location behavior where the platform API supports it.
