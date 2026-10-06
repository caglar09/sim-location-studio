#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv


ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / ".build" / "ios-bridge-venv"
OUT = ROOT / "build" / "bin"
WORK = ROOT / ".build" / "ios-bridge-work"
SPEC = ROOT / "scripts" / "ios_bridge.spec"
REQUIREMENTS = ROOT / "scripts" / "ios_bridge_requirements.txt"


def run(args: list[str], **kwargs) -> None:
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(args, check=True, cwd=ROOT, **kwargs)


def main() -> int:
    if sys.platform not in {"darwin", "win32"}:
        print("Physical iOS bridge is supported only on macOS and Windows release builds.")
        return 0

    if VENV.exists():
        shutil.rmtree(VENV)

    venv.EnvBuilder(with_pip=True, clear=True).create(VENV)

    scripts_dir = VENV / ("Scripts" if os.name == "nt" else "bin")
    python = scripts_dir / ("python.exe" if os.name == "nt" else "python")
    pyinstaller = scripts_dir / ("pyinstaller.exe" if os.name == "nt" else "pyinstaller")

    run([str(python), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(python), "-m", "pip", "install", "-r", str(REQUIREMENTS)])

    if WORK.exists():
        shutil.rmtree(WORK)
    OUT.mkdir(parents=True, exist_ok=True)

    run([
        str(pyinstaller),
        "--clean",
        "--noconfirm",
        "--distpath", str(OUT),
        "--workpath", str(WORK),
        str(SPEC),
    ])

    executable = OUT / ("ios-device-bridge.exe" if os.name == "nt" else "ios-device-bridge")
    if not executable.exists():
        raise FileNotFoundError(f"PyInstaller did not create {executable}")

    if os.name != "nt":
        executable.chmod(executable.stat().st_mode | 0o111)

    run([str(executable), "--help"], stdout=subprocess.DEVNULL)
    print(f"Built {executable}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
