#!/usr/bin/env python3
"""Light only the panel's edge pixels, tracing its true physical silhouette.

Accounts for both gaps: the missing middle of the top row, and the triangular
nose-bridge notch at the bottom.
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import display as d  # noqa: E402
from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.25)


async def push(client: BleakClient, grid: d.Grid) -> None:
    for block in grid.to_frames():
        await client.write_gatt_char(BULK, p.encrypt(block), response=False)
        await asyncio.sleep(0.015)


def outline() -> d.Grid:
    g = d.Grid()
    for r, c in d.edge_pixels():
        g.set(r, c)
    return g


def solid() -> d.Grid:
    g = d.Grid()
    for r in range(d.ROWS):
        for c in range(d.COLS):
            if d.alive(r, c):
                g.set(r, c)
    return g


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME

    edge = outline()
    print("Edge trace (top row first, as seen on the lens):")
    print(edge.render())
    print(f"\n{len(d.edge_pixels())} edge pixels\n")

    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"Connected to {dev.name}")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))

        print("\n--- EDGE ONLY (held 20s)")
        print("    Does the outline hug the panel exactly, notches included?")
        await push(client, edge)
        await asyncio.sleep(20.0)

        print("\n--- SOLID FILL for comparison (10s)")
        await push(client, solid())
        await asyncio.sleep(10.0)

        print("\n--- back to EDGE (held 30s)")
        await push(client, edge)
        await asyncio.sleep(30.0)

        await push(client, d.Grid())
        await cmd(client, p.exit_diy(save=False))
        print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
