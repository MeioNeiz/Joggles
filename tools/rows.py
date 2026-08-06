#!/usr/bin/env python3
"""Determine the row count, one unambiguous test at a time.

A reference line is always lit along the bottom row (bit 0). Each test then
blinks a single extra line higher up. The only question per test is: does a
SECOND line appear above the bottom one?

    bit 11 visible -> at least 12 rows
    bit 13 visible -> at least 14 rows
    bit 15 visible -> at least 16 rows
"""
import asyncio
import sys

sys.path.insert(0, __file__.rsplit("/tools/", 1)[0])

from bleak import BleakClient, BleakScanner  # noqa: E402

from joggles import protocol as p  # noqa: E402

DEFAULT_NAME = "GLASSES-12C3EF"
BULK = p.CHAR_BULK_B
COLS = 24

TESTS = [(11, 12), (13, 14), (15, 16)]


async def cmd(client: BleakClient, plaintext: bytes) -> None:
    await client.write_gatt_char(p.CHAR_COMMAND, p.encrypt(plaintext), response=False)
    await asyncio.sleep(0.25)


async def push(client: BleakClient, bits: int) -> None:
    b = bits.to_bytes(3, "big")
    for c in range(COLS):
        await client.write_gatt_char(BULK, p.encrypt(p.column(c, b)), response=False)
        await asyncio.sleep(0.015)


async def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_NAME
    dev = await BleakScanner.find_device_by_name(target, timeout=20.0)
    if dev is None:
        sys.exit(f"Could not find {target!r}")

    async with BleakClient(dev.address, timeout=30.0) as client:
        print(f"Connected to {dev.name}\n")
        await cmd(client, p.enter_diy())
        await cmd(client, p.leds(True))

        print("A single line will stay lit along the BOTTOM as a reference.\n")
        await push(client, 1)
        await asyncio.sleep(3.0)

        for i, (bit, rows) in enumerate(TESTS, 1):
            print(f"=== TEST {i}: blinking a line for a {rows}-row panel (bit {bit})")
            print("    Does a SECOND line appear above the bottom one?")
            for _ in range(6):
                await push(client, 1 | (1 << bit))
                await asyncio.sleep(0.6)
                await push(client, 1)
                await asyncio.sleep(0.4)
            print("    ...test complete\n")
            await asyncio.sleep(1.5)

        await push(client, 0)
        await cmd(client, p.exit_diy(save=False))
        print("Done. Which tests showed a second line?")


if __name__ == "__main__":
    asyncio.run(main())
