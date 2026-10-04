#!/usr/bin/env python3
import argparse
import asyncio
import json
import sys


def emit(payload):
    print(json.dumps(payload), flush=True)


async def command_loop(location):
    emit({"type": "ready"})
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        try:
            command = json.loads(line)
            command_id = command.get("id")
            action = command.get("action")
            if action == "set":
                await location.set(float(command["lat"]), float(command["lng"]))
                emit({"type": "result", "id": command_id, "ok": True})
            elif action == "clear":
                await location.clear()
                emit({"type": "result", "id": command_id, "ok": True})
            elif action == "quit":
                try:
                    await location.clear()
                except Exception:
                    pass
                emit({"type": "result", "id": command_id, "ok": True})
                return
            else:
                emit({"type": "result", "id": command_id, "ok": False, "message": "Unknown action"})
        except Exception as exc:
            emit({"type": "result", "id": command.get("id") if "command" in locals() else None, "ok": False, "message": str(exc)})


async def run_modern(udid):
    from pymobiledevice3.remote.rsd_tunnel import PreferredRsdTunnel
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

    async with PreferredRsdTunnel(serial=udid) as rsd:
        async with DvtProvider(rsd) as dvt:
            async with LocationSimulation(dvt) as location:
                await command_loop(location)


async def run_legacy(udid):
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.simulate_location import DtSimulateLocation

    async with await create_using_usbmux(serial=udid) as lockdown:
        location = DtSimulateLocation(lockdown)
        await command_loop(location)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--udid", required=True)
    parser.add_argument("--ios-major", type=int, required=True)
    args = parser.parse_args()

    if args.ios_major >= 17:
        await run_modern(args.udid)
    else:
        await run_legacy(args.udid)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        emit({"type": "fatal", "message": str(exc)})
        raise
