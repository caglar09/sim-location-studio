# Physical device setup

## iOS / iPadOS

Release DMGs are self-contained for physical iOS support. End users do not install Python or pymobiledevice3.

Requirements for end users:

- macOS.
- The iPhone/iPad must trust the computer.
- Developer Mode must be enabled for iOS 17+.

Refresh Sim Location Studio after connecting the device. It will appear as a **physical** iOS target using the `ios-pymobiledevice3` provider.

For repository development only:

```bash
python3 -m pip install -U pymobiledevice3
npm run dev
```

For a distributable build:

```bash
npm run dist:mac
```

That command creates an isolated build environment, freezes the bridge together with Python and pymobiledevice3 using PyInstaller, and embeds `ios-device-bridge` under the app's Resources/bin directory.

Sim Location Studio starts a persistent Python bridge for the selected device. On iOS 17+ the bridge uses a no-root RSD tunnel and DVT LocationSimulation. On older systems it uses the legacy simulate-location developer service.

The bridge stays open while coordinates are streamed, so Teleport and route playback can send frequent position updates without launching a new Python process for every point.

### Troubleshooting

If a device is not listed in a release build, reconnect it, unlock it, confirm Trust, then refresh devices. Developers can additionally check `pymobiledevice3 usbmux list` in source mode.

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


## Windows physical iPhone

Windows release builds include `Resources/bin/ios-device-bridge.exe` and do not require end users to install Python, pip, Homebrew, or pymobiledevice3.

Requirements:

1. Install Apple's current **Apple Devices** app or an Apple iTunes distribution that includes **Apple Mobile Device Support**.
2. Connect the iPhone over USB.
3. Accept **Trust This Computer**.
4. Enable Developer Mode when required by the iOS version.
5. Open Sim Location Studio and refresh devices.

The bundled bridge handles device discovery and the persistent DVT location session. If Apple's USB/device service is unavailable, the Diagnostics panel reports the physical-iOS bridge as unavailable and suggests installing Apple Mobile Device Support.

Repository developers can create a Windows distributable with:

```powershell
npm run dist:win
```

The build machine needs Python only at build time because PyInstaller freezes the helper into `ios-device-bridge.exe`. The end user's machine does not need Python.
