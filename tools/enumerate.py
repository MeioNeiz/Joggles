#!/usr/bin/env python3
"""Connect to a BLE device and dump its full GATT tree.

Usage:
    python tools/enumerate.py <address-or-name>

The write-without-response characteristic on a 0xFFE0/0xFFF0/0xAE00-style
vendor service is almost always where display frames go.
"""
import asyncio
import sys

from bleak import BleakClient, BleakScanner

# Characteristics worth trying to read. Skipping the rest avoids long stalls on
# devices that advertise readable handles they never actually serve.
SKIP_READ = {"2a05"}  # Service Changed: read always fails


async def resolve(target: str):
    if ":" in target or "-" in target and len(target) > 30:
        return target
    print(f"Looking for a device named like {target!r}...")
    dev = await BleakScanner.find_device_by_name(target, timeout=15.0)
    if dev is None:
        sys.exit(f"No device named {target!r} found.")
    print(f"Found {dev.name} at {dev.address}")
    return dev.address


def describe(props: list[str]) -> str:
    return ",".join(props)


async def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    address = await resolve(sys.argv[1])

    print(f"\nConnecting to {address}...")
    async with BleakClient(address, timeout=30.0) as client:
        print(f"Connected. MTU = {client.mtu_size}\n")

        candidates = []
        for service in client.services:
            print(f"SERVICE {service.uuid}")
            print(f"        {service.description}")
            for char in service.characteristics:
                props = describe(char.properties)
                print(f"  CHAR  {char.uuid}  [{props}]  handle={char.handle}")
                print(f"        {char.description}")

                if "write-without-response" in char.properties or "write" in char.properties:
                    candidates.append(char)

                if "read" in char.properties and char.uuid[4:8] not in SKIP_READ:
                    try:
                        val = await client.read_gatt_char(char)
                        printable = val.decode("utf-8", "replace").strip()
                        print(f"        value: {val.hex(' ')}   ascii: {printable!r}")
                    except Exception as exc:  # noqa: BLE001 - informational only
                        print(f"        value: <unreadable: {type(exc).__name__}>")

                for desc in char.descriptors:
                    print(f"    DESC {desc.uuid}  handle={desc.handle}")
            print()

        print("=" * 70)
        print("WRITABLE CHARACTERISTICS (protocol targets):")
        for char in candidates:
            print(f"  {char.uuid}  [{describe(char.properties)}]")
        print("\nNOTIFY characteristics are the device talking back - subscribe to")
        print("these while the official app runs to see responses.")


if __name__ == "__main__":
    asyncio.run(main())
