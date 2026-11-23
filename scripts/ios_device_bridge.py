#!/usr/bin/env python3
import argparse
import asyncio
import inspect
import json
import sys
from contextlib import AsyncExitStack


def emit(payload):
    print(json.dumps(payload), flush=True)


async def maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


async def list_connected_devices():
    from pymobiledevice3.usbmux import list_devices
    from pymobiledevice3.lockdown import create_using_usbmux

    mux_devices = await maybe_await(list_devices())
    output = []

    for device in mux_devices:
        serial = getattr(device, "serial", None)
        if not serial:
            continue

        item = {
            "Identifier": serial,
            "ConnectionType": getattr(device, "connection_type", None) or "USB",
            "DeviceName": None,
            "ProductType": None,
            "ProductVersion": None,
            "DeviceClass": None,
        }

        try:
            lockdown = await create_using_usbmux(serial=serial, autopair=False)
            async with lockdown:
                values = lockdown.all_values or {}
                item.update({
                    "DeviceName": values.get("DeviceName"),
                    "ProductType": values.get("ProductType"),
                    "ProductVersion": values.get("ProductVersion"),
                    "DeviceClass": values.get("DeviceClass"),
                })
        except Exception:
            # Device discovery should still succeed when the phone is locked,
            # not yet trusted, or lockdown metadata is temporarily unavailable.
            pass

        output.append(item)

    print(json.dumps(output), flush=True)


async def command_loop(location):
    emit({"type": "ready"})
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break

        command = None
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
            emit({
                "type": "result",
                "id": command.get("id") if isinstance(command, dict) else None,
                "ok": False,
                "message": str(exc),
            })


async def run_modern(udid):
    from pymobiledevice3.remote.rsd_tunnel import PreferredRsdTunnel
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
    from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

    async with PreferredRsdTunnel(serial=udid) as rsd:
        async with DvtProvider(rsd) as dvt:
            async with LocationSimulation(dvt) as location:
                await command_loop(location)


async def run_legacy(udid):
    from pymobiledevice3.exceptions import AlreadyMountedError, ConnectionTerminatedError, InvalidConnectionError
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.mobile_image_mounter import auto_mount_developer
    from pymobiledevice3.services.simulate_location import DtSimulateLocation

    async with AsyncExitStack() as connections:
        async def connect():
            return await connections.enter_async_context(await create_using_usbmux(serial=udid))

        lockdown = await connect()
        if int(lockdown.product_version.split(".", 1)[0]) >= 16 and not await lockdown.get_developer_mode_status():
            raise RuntimeError("Active le mode développeur dans les réglages de l’iPhone pour simuler sa position.")
        try:
            await auto_mount_developer(lockdown)
        except AlreadyMountedError:
            pass
        service = await lockdown.start_lockdown_developer_service(DtSimulateLocation.SERVICE_NAME)
        await service.close()

        class LegacyLocation:
            async def run(self, action, *args):
                nonlocal lockdown
                try:
                    await action(DtSimulateLocation(lockdown), *args)
                except (OSError, ConnectionTerminatedError, InvalidConnectionError):
                    await connections.aclose()
                    lockdown = await connect()
                    await action(DtSimulateLocation(lockdown), *args)

            async def set(self, latitude, longitude):
                await self.run(DtSimulateLocation.set, latitude, longitude)

            async def clear(self):
                await self.run(DtSimulateLocation.clear)

        await command_loop(LegacyLocation())


async def run_device(udid):
    from pymobiledevice3.lockdown import create_using_usbmux

    async with await create_using_usbmux(serial=udid) as lockdown:
        ios_major = int(lockdown.product_version.split(".", 1)[0])
    if ios_major < 17:
        await run_legacy(udid)
        return

    modern_error = None
    try:
        await run_modern(udid)
        return
    except Exception as exc:
        modern_error = exc

    try:
        await run_legacy(udid)
    except Exception as legacy_error:
        raise RuntimeError(
            f"Modern DVT connection failed: {modern_error}; "
            f"legacy location service failed: {legacy_error}"
        ) from legacy_error


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--udid")
    args = parser.parse_args()

    if args.list:
        await list_connected_devices()
        return

    if not args.udid:
        parser.error("--udid is required unless --list is used")

    await run_device(args.udid)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        emit({"type": "fatal", "message": str(exc)})
        raise
