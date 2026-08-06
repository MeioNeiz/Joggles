#!/usr/bin/env python3
"""Scan for BLE devices and print anything that looks like LED glasses.

Usage:
    python tools/scan.py            # 10s scan, all devices
    python tools/scan.py 30         # 30s scan
"""
import asyncio
import sys

from bleak import BleakScanner

# Funky Glasses+ hardware advertises as GLASSES-{MAC}.
TARGET_PREFIX = "glasses-"

# Vendor service seen on this device family.
TARGET_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb"

# Wider net, in case this unit advertises differently.
HINTS = (
    "led", "glass", "mask", "display", "matrix", "magic", "light", "lamp",
    "chemion", "shining", "funky", "ble", "bt", "esp", "jdy", "hm-", "at-",
)


def looks_interesting(name: str, adv) -> str:
    if name.lower().startswith(TARGET_PREFIX):
        return " <-- THIS IS IT"
    if any(str(u).lower() == TARGET_SERVICE for u in (adv.service_uuids or ())):
        return " <-- MATCHING SERVICE UUID"
    if any(h in name.lower() for h in HINTS):
        return " <-- candidate"
    return ""


async def main() -> None:
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
    print(f"Scanning {seconds:.0f}s... (keep the glasses powered on and NOT")
    print("connected to the phone app - BLE allows only one connection at a time)\n")

    seen = await BleakScanner.discover(timeout=seconds, return_adv=True)

    if not seen:
        print("Nothing found. Check Bluetooth is on and the terminal has")
        print("Bluetooth permission in System Settings > Privacy & Security.")
        return

    rows = []
    for addr, (device, adv) in seen.items():
        name = device.name or adv.local_name or ""
        rows.append((adv.rssi, addr, name, adv))

    rows.sort(key=lambda r: -r[0])

    print(f"{'RSSI':>5}  {'ADDRESS':<38} NAME")
    print("-" * 78)
    for rssi, addr, name, adv in rows:
        flag = looks_interesting(name, adv)
        print(f"{rssi:>5}  {addr:<38} {name or '(no name)'}{flag}")
        if adv.manufacturer_data:
            for cid, data in adv.manufacturer_data.items():
                print(f"         mfr 0x{cid:04x}: {data.hex(' ')}")
        if adv.service_uuids:
            for u in adv.service_uuids:
                print(f"         svc: {u}")

    print("\nStrongest signal = closest. Move the glasses right next to the Mac")
    print("and rescan to confirm which entry is them.")


if __name__ == "__main__":
    asyncio.run(main())
