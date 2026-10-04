# Third-party notices

Sim Location Studio's desktop application is licensed under the repository's MIT License.

## Physical iOS bridge

macOS release builds contain a separate helper executable named `ios-device-bridge`.
The helper communicates with the desktop application over stdin/stdout and is built from:

- `scripts/ios_device_bridge.py` in this repository.
- `pymobiledevice3 11.12.4`.
- Python, frozen into a standalone executable with PyInstaller 6.22.3.

pymobiledevice3 is licensed under GPL-3.0. Its upstream source for the exact bundled version is available at:

- https://github.com/doronz88/pymobiledevice3/tree/v11.12.4
- https://pypi.org/project/pymobiledevice3/11.12.4/

The bridge source and reproducible build inputs are kept in this repository under `scripts/`.
The bridge is distributed as a separate process and is intended only to provide physical iOS device communication.

PyInstaller is licensed under GPL-2.0-or-later with an exception that permits distribution of bundled applications; see the PyInstaller project for its complete terms.

For complete license texts and notices of transitive Python dependencies, refer to their installed package metadata and upstream source distributions.
